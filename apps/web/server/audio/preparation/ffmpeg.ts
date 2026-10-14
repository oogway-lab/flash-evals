import { spawn } from "child_process";
import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { createSemaphore } from "../../lib/concurrency";
import type { ISilenceInterval } from "./plan";

/** FFmpeg or FFprobe is not installed on this worker. */
export class AudioToolUnavailableError extends Error {
    constructor(tool: string) {
        super(
            `${tool} is not available on this worker; set FFMPEG_PATH and FFPROBE_PATH or install FFmpeg.`,
        );
        this.name = "AudioToolUnavailableError";
    }
}

export interface IAudioProbe {
    durationMs: number;
    codec?: string;
    channels?: number;
    sampleRate?: number;
    bitRate?: number;
}

// Retain at most this much tool output; silencedetect logs one line per gap.
const MAX_TOOL_OUTPUT_BYTES = 4 * 1024 * 1024;

function ffmpegPath(): string {
    return process.env.FFMPEG_PATH?.trim() || "ffmpeg";
}

function ffprobePath(): string {
    return process.env.FFPROBE_PATH?.trim() || "ffprobe";
}

function toolTimeoutMs(): number {
    const parsed = Number.parseInt(
        process.env.STT_AUDIO_PREP_TIMEOUT_MS ?? "",
        10,
    );
    return Number.isSafeInteger(parsed) && parsed >= 5_000 ? parsed : 120_000;
}

function prepConcurrency(): number {
    const parsed = Number.parseInt(
        process.env.STT_AUDIO_PREP_CONCURRENCY ?? "",
        10,
    );
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

const heavySteps = createSemaphore(prepConcurrency);

/**
 * Run `fn` with the audio written to a private temporary directory, removed
 * afterwards even when setup fails part-way.
 */
export async function withAudioWorkspace<T>(
    bytes: Buffer,
    fn: (workspace: { dir: string; inputPath: string }) => Promise<T>,
): Promise<T> {
    let dir: string | undefined;
    try {
        dir = await mkdtemp(join(tmpdir(), "mosaic-audio-"));
        const inputPath = join(dir, "source");
        await writeFile(inputPath, bytes);
        return await fn({ dir, inputPath });
    } finally {
        if (dir) await rm(dir, { recursive: true, force: true });
    }
}

/**
 * Run CPU-heavy FFmpeg work (silence detection, encoding) with at most
 * STT_AUDIO_PREP_CONCURRENCY jobs per process. Probing stays outside this
 * limit so small recordings are not queued behind a long conversion.
 */
export async function withHeavyAudioSlot<T>(fn: () => Promise<T>): Promise<T> {
    const release = await heavySteps.acquire();
    try {
        return await fn();
    } finally {
        release();
    }
}

function runTool(
    command: string,
    toolName: string,
    args: string[],
): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["ignore", "pipe", "pipe"],
        });
        let stdout = "";
        let stderr = "";
        const append = (current: string, chunk: Buffer) =>
            current.length >= MAX_TOOL_OUTPUT_BYTES
                ? current
                : current + chunk.toString("utf8");
        child.stdout.on("data", (chunk: Buffer) => {
            stdout = append(stdout, chunk);
        });
        child.stderr.on("data", (chunk: Buffer) => {
            stderr = append(stderr, chunk);
        });
        const timeout = setTimeout(() => {
            child.kill("SIGKILL");
            reject(
                new Error(
                    `${toolName} audio preparation exceeded ${toolTimeoutMs()} ms.`,
                ),
            );
        }, toolTimeoutMs());
        child.on("error", (error: NodeJS.ErrnoException) => {
            clearTimeout(timeout);
            reject(
                error.code === "ENOENT"
                    ? new AudioToolUnavailableError(toolName)
                    : error,
            );
        });
        child.on("close", (code) => {
            clearTimeout(timeout);
            if (code === 0) resolve({ stdout, stderr });
            else
                reject(
                    new Error(
                        `${toolName} could not read the audio (exit ${code}): ${lastLine(stderr)}`,
                    ),
                );
        });
    });
}

function lastLine(value: string): string {
    const lines = value.trim().split("\n");
    return (lines[lines.length - 1] ?? "").slice(0, 300);
}

export async function probeAudio(inputPath: string): Promise<IAudioProbe> {
    const { stdout } = await runTool(ffprobePath(), "FFprobe", [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        "-select_streams",
        "a:0",
        inputPath,
    ]);
    const parsed = JSON.parse(stdout) as {
        format?: { duration?: string; bit_rate?: string };
        streams?: Array<{
            codec_name?: string;
            channels?: number;
            sample_rate?: string;
            duration?: string;
        }>;
    };
    const stream = parsed.streams?.[0];
    if (!stream) throw new Error("The recording has no audio stream.");
    const seconds = Number(parsed.format?.duration ?? stream.duration);
    if (!Number.isFinite(seconds) || seconds <= 0)
        throw new Error("The recording has no measurable audio duration.");
    const sampleRate = Number(stream.sample_rate);
    const bitRate = Number(parsed.format?.bit_rate);
    return {
        durationMs: Math.round(seconds * 1000),
        ...(stream.codec_name ? { codec: stream.codec_name } : {}),
        ...(stream.channels ? { channels: stream.channels } : {}),
        ...(Number.isFinite(sampleRate) ? { sampleRate } : {}),
        ...(Number.isFinite(bitRate) ? { bitRate } : {}),
    };
}

/** Silence intervals FFmpeg detects; used only to place chunk boundaries. */
export async function detectSilences(
    inputPath: string,
    durationMs: number,
): Promise<ISilenceInterval[]> {
    const { stderr } = await runTool(ffmpegPath(), "FFmpeg", [
        "-hide_banner",
        "-nostats",
        "-threads",
        "1",
        "-i",
        inputPath,
        "-af",
        "silencedetect=noise=-35dB:d=0.4",
        "-f",
        "null",
        "-",
    ]);
    return parseSilenceDetect(stderr, durationMs);
}

/** A silence still open at end of input runs to `durationMs` when given. */
export function parseSilenceDetect(
    stderr: string,
    durationMs?: number,
): ISilenceInterval[] {
    const silences: ISilenceInterval[] = [];
    let start: number | undefined;
    for (const match of stderr.matchAll(
        /silence_(start|end): (-?\d+(?:\.\d+)?)/g,
    )) {
        const ms = Math.max(0, Math.round(Number(match[2]) * 1000));
        if (match[1] === "start") start = ms;
        else if (start !== undefined) {
            silences.push({ startMs: start, endMs: ms });
            start = undefined;
        }
    }
    if (start !== undefined && durationMs !== undefined && durationMs > start)
        silences.push({ startMs: start, endMs: durationMs });
    return silences;
}

/** Bitrate of prepared audio; budgets derive chunk length from it. */
export const PREPARED_AUDIO_BITRATE_BPS = 48_000;

/**
 * Encode a span as mono 16 kHz MP3. Speech models resample to 16 kHz mono, so
 * this keeps the content the model hears while bounding payload size. No
 * denoising or loudness filters are applied.
 */
export async function encodeSpeechMp3(
    workspace: { dir: string; inputPath: string },
    span: { index: number; startMs?: number; endMs?: number },
): Promise<Buffer> {
    const outputPath = join(workspace.dir, `chunk-${span.index}.mp3`);
    await runTool(ffmpegPath(), "FFmpeg", [
        "-hide_banner",
        "-nostats",
        "-loglevel",
        "error",
        "-threads",
        "1",
        ...(span.startMs !== undefined
            ? ["-ss", (span.startMs / 1000).toFixed(3)]
            : []),
        ...(span.endMs !== undefined
            ? ["-to", (span.endMs / 1000).toFixed(3)]
            : []),
        "-i",
        workspace.inputPath,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "libmp3lame",
        "-b:a",
        String(PREPARED_AUDIO_BITRATE_BPS),
        "-y",
        outputPath,
    ]);
    return readFile(outputPath);
}
