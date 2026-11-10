import { writeFile } from "fs/promises";
import { join } from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as Ffmpeg from "./ffmpeg";

vi.mock("./ffmpeg", async (importOriginal) => {
    const actual = await importOriginal<typeof Ffmpeg>();
    return {
        ...actual,
        probeAudio: vi.fn(async () => ({ durationMs: 30_000 })),
        levelVolume: vi.fn(
            async (
                workspace: { dir: string; inputPath: string },
                format: "flac" | "wav",
            ) => {
                const path = join(workspace.dir, `levelled.${format}`);
                await writeFile(
                    path,
                    Buffer.from(
                        format === "flac" ? "fLaC-levelled" : "RIFF-levelled",
                    ),
                );
                return path;
            },
        ),
        detectSilences: vi.fn(async () => []),
        encodeSpeechMp3: vi.fn(async () => Buffer.from("ID3-mp3")),
    };
});

import {
    LEVELLED_AUDIO_PREPARATION_VERSION,
    PREVIOUS_LEVELLED_AUDIO_PREPARATION_VERSION,
    prepareAudioForTranscription,
} from ".";
import { VOLUME_LEVELLING_VERSION } from "@flash-evals/llm-core/transcript-identity";
import {
    AudioToolUnavailableError,
    encodeSpeechMp3,
    levelVolume,
    levellingTimeoutMs,
    probeAudio,
    volumeLevellingArgs,
} from "./ffmpeg";

const WAV_OR_MP3 = new Set(["audio/wav", "audio/mpeg"]);

afterEach(() => vi.clearAllMocks());

describe("volumeLevellingArgs", () => {
    const at = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

    it("levels loudness and writes 16 kHz mono 16-bit FLAC", () => {
        const args = volumeLevellingArgs("/tmp/in", "/tmp/out.flac", "flac");
        expect(args.slice(args.indexOf("-i"), args.indexOf("-i") + 2)).toEqual([
            "-i",
            "/tmp/in",
        ]);
        expect(at(args, "-af")).toBe("loudnorm=I=-23:TP=-2:LRA=11");
        expect(at(args, "-ac")).toBe("1");
        expect(at(args, "-ar")).toBe("16000");
        expect(at(args, "-c:a")).toBe("flac");
        expect(at(args, "-sample_fmt")).toBe("s16");
        expect(at(args, "-f")).toBe("flac");
        expect(args.at(-1)).toBe("/tmp/out.flac");
        expect(args).toContain("-vn");
    });

    it("keeps 16 kHz mono 16-bit WAV for routes that need it", () => {
        const args = volumeLevellingArgs("/tmp/in", "/tmp/out.wav", "wav");
        expect(at(args, "-af")).toBe("loudnorm=I=-23:TP=-2:LRA=11");
        expect(at(args, "-c:a")).toBe("pcm_s16le");
        expect(at(args, "-f")).toBe("wav");
        expect(args).not.toContain("flac");
    });
});

describe("levellingTimeoutMs", () => {
    afterEach(() => vi.unstubAllEnvs());

    it("keeps the step limit for short audio and scales it for long calls", () => {
        vi.stubEnv("STT_AUDIO_PREP_TIMEOUT_MS", "");
        expect(levellingTimeoutMs(undefined)).toBe(120_000);
        expect(levellingTimeoutMs(60_000)).toBe(120_000);
        // A two-hour call gets 24 minutes instead of 2.
        expect(levellingTimeoutMs(2 * 60 * 60_000)).toBe(24 * 60_000);
        vi.stubEnv("STT_AUDIO_PREP_TIMEOUT_MS", "900000");
        expect(levellingTimeoutMs(60 * 60_000)).toBe(900_000);
    });
});

describe("prepareAudioForTranscription volume levelling", () => {
    it("bumps the prepared-audio version for FLAC but not the identity version", () => {
        expect(PREVIOUS_LEVELLED_AUDIO_PREPARATION_VERSION).toBe(
            "loudnorm-i23-tp2-lra11-wav16k-mono.v1+speech-mp3-16k-mono-48k.v1",
        );
        expect(LEVELLED_AUDIO_PREPARATION_VERSION).toBe(
            "loudnorm-i23-tp2-lra11-wav16k-mono.v1+levelled-flac.v2+speech-mp3-16k-mono-48k.v1",
        );
        // Part of the transcript identity hash; changing it re-bills every
        // levelled transcript.
        expect(VOLUME_LEVELLING_VERSION).toBe(
            "loudnorm-i23-tp2-lra11-wav16k-mono.v1",
        );
    });

    it("does not level when the option is off", async () => {
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: undefined,
        });
        expect(result).toEqual({ kind: "original" });
        expect(levelVolume).not.toHaveBeenCalled();
        expect(probeAudio).not.toHaveBeenCalled();
    });

    it("sends the levelled FLAC whole to routes without a budget", async () => {
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: undefined,
            levelVolume: true,
            levelledFormat: "flac",
        });
        expect(levelVolume).toHaveBeenCalledTimes(1);
        expect(vi.mocked(levelVolume).mock.calls[0]![1]).toBe("flac");
        // The recording's length sets the levelling time limit.
        expect(vi.mocked(levelVolume).mock.calls[0]![2]).toBe(30_000);
        expect(encodeSpeechMp3).not.toHaveBeenCalled();
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.version).toBe(LEVELLED_AUDIO_PREPARATION_VERSION);
        expect(result.volumeLevelled).toBe(true);
        expect(result.chunks).toEqual([
            {
                index: 0,
                startMs: 0,
                endMs: 30_000,
                bytes: Buffer.from("fLaC-levelled"),
                mimeType: "audio/flac",
                hardCut: false,
                silent: false,
            },
        ]);
    });

    it("sends the levelled FLAC whole when it fits the route's upload budget", async () => {
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: undefined,
            levelVolume: true,
            levelledFormat: "flac",
            levelledMaxBytes: 1024 * 1024,
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.chunks.map((chunk) => chunk.mimeType)).toEqual([
            "audio/flac",
        ]);
        expect(encodeSpeechMp3).not.toHaveBeenCalled();
    });

    it("re-encodes levelled FLAC over the upload budget as speech MP3", async () => {
        // A 10-byte budget allows about 1 ms per MP3 chunk; keep one chunk.
        vi.mocked(probeAudio).mockResolvedValueOnce({ durationMs: 1 });
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: undefined,
            levelVolume: true,
            levelledFormat: "flac",
            // "fLaC-levelled" is 13 bytes.
            levelledMaxBytes: 10,
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.volumeLevelled).toBe(true);
        expect(result.chunks.map((chunk) => chunk.mimeType)).toEqual([
            "audio/mpeg",
        ]);
        const [workspace] = vi.mocked(encodeSpeechMp3).mock.calls[0]!;
        expect(workspace.inputPath.endsWith("levelled.flac")).toBe(true);
    });

    it("splits levelled audio too long for one MP3 within the upload budget", async () => {
        vi.mocked(probeAudio).mockResolvedValueOnce({
            durationMs: 3 * 60 * 60_000,
        });
        // 24 MiB at 48 kbps with 5% headroom is about 66 minutes per chunk.
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: undefined,
            levelVolume: true,
            levelledFormat: "flac",
            levelledMaxBytes: 24 * 1024 * 1024,
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.chunks.length).toBeGreaterThan(1);
        expect(
            result.chunks.every((chunk) => chunk.mimeType === "audio/mpeg"),
        ).toBe(true);
    });

    it("splits levelled audio longer than the route's duration limit, even when it fits by size", async () => {
        // 40 minutes; the FLAC mock is tiny, so only the duration limit applies.
        vi.mocked(probeAudio).mockResolvedValueOnce({ durationMs: 2_400_000 });
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: undefined,
            levelVolume: true,
            levelledFormat: "flac",
            levelledMaxBytes: 23 * 1024 * 1024,
            levelledMaxDurationMs: 1_400_000,
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.chunks.length).toBeGreaterThan(1);
        for (const chunk of result.chunks) {
            expect(chunk.mimeType).toBe("audio/mpeg");
            expect(chunk.endMs - chunk.startMs).toBeLessThanOrEqual(1_400_000);
        }
    });

    it("fails clearly when the levelled MP3 is still over the upload budget", async () => {
        vi.mocked(probeAudio).mockResolvedValueOnce({ durationMs: 1 });
        vi.mocked(encodeSpeechMp3).mockResolvedValueOnce(
            Buffer.from(`ID3${"x".repeat(64)}`),
        );
        await expect(
            prepareAudioForTranscription({
                bytes: Buffer.from("mp3"),
                mimeType: "audio/mpeg",
                policy: undefined,
                levelVolume: true,
                levelledFormat: "flac",
                levelledMaxBytes: 10,
            }),
        ).rejects.toThrow(/above the .* MB provider budget/);
    });

    it("sends WAV whole to a WAV/MP3 route when it fits the budget", async () => {
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: {
                maxBytes: 1024,
                maxDurationMs: 60_000,
                acceptedMimeTypes: WAV_OR_MP3,
            },
            levelVolume: true,
            levelledFormat: "wav",
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.chunks.map((chunk) => chunk.mimeType)).toEqual([
            "audio/wav",
        ]);
        expect(encodeSpeechMp3).not.toHaveBeenCalled();
    });

    it("does not send FLAC to a route whose budget lists only WAV/MP3", async () => {
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("mp3"),
            mimeType: "audio/mpeg",
            policy: {
                maxBytes: 1024,
                maxDurationMs: 60_000,
                acceptedMimeTypes: WAV_OR_MP3,
            },
            levelVolume: true,
            levelledFormat: "flac",
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.chunks.map((chunk) => chunk.mimeType)).toEqual([
            "audio/mpeg",
        ]);
    });

    it("compresses the levelled audio when the WAV is over the route budget", async () => {
        const result = await prepareAudioForTranscription({
            bytes: Buffer.from("small-mp3"),
            mimeType: "audio/mpeg",
            policy: {
                maxBytes: 10,
                maxDurationMs: 60_000,
                acceptedMimeTypes: WAV_OR_MP3,
            },
            levelVolume: true,
        });
        if (result.kind !== "prepared") throw new Error("expected levelled");
        expect(result.volumeLevelled).toBe(true);
        expect(result.chunks).toHaveLength(1);
        expect(result.chunks[0]!.mimeType).toBe("audio/mpeg");
        // The MP3 is encoded from the levelled copy, not the upload.
        const [workspace] = vi.mocked(encodeSpeechMp3).mock.calls[0]!;
        expect(workspace.inputPath.endsWith("levelled.wav")).toBe(true);
    });

    it("fails instead of sending unlevelled audio when FFmpeg is missing", async () => {
        vi.mocked(levelVolume).mockRejectedValueOnce(
            new AudioToolUnavailableError("FFmpeg"),
        );
        await expect(
            prepareAudioForTranscription({
                bytes: Buffer.from("wav"),
                mimeType: "audio/wav",
                policy: {
                    maxBytes: 1024,
                    maxDurationMs: 60_000,
                    acceptedMimeTypes: WAV_OR_MP3,
                },
                levelVolume: true,
            }),
        ).rejects.toThrow(/Level volume first needs FFmpeg/);
    });
});
