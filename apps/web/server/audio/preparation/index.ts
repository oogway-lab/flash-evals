import { readFile } from "fs/promises";
import {
    VOLUME_LEVELLING_FILTER,
    VOLUME_LEVELLING_VERSION,
} from "@flash-evals/llm-core/transcript-identity";
import {
    AudioToolUnavailableError,
    detectSilences,
    LEVELLED_AUDIO_OUTPUTS,
    PREPARED_AUDIO_BITRATE_BPS,
    encodeSpeechMp3,
    levelVolume,
    probeAudio,
    withAudioWorkspace,
    withHeavyAudioSlot,
    type IAudioProbe,
    type LevelledAudioFormat,
} from "./ffmpeg";
import { planChunkSpans, type IChunkSpan } from "./plan";

export { PREPARED_AUDIO_BITRATE_BPS, type LevelledAudioFormat } from "./ffmpeg";

/**
 * Bump when the encoding or chunking changes so transcripts made from older
 * prepared audio are not reused. Untransformed audio never carries a version.
 */
export const AUDIO_PREPARATION_VERSION = "speech-mp3-16k-mono-48k.v1";

/**
 * Preparation version of audio levelled before transcription. v2 writes FLAC
 * for routes that accept it (v1 wrote WAV everywhere), so chunks prepared
 * under v1 are not reused. VOLUME_LEVELLING_VERSION is part of the transcript
 * identity hash and stays fixed: the levelled samples are the same.
 */
export const LEVELLED_AUDIO_PREPARATION_VERSION = `${VOLUME_LEVELLING_VERSION}+levelled-flac.v2+${AUDIO_PREPARATION_VERSION}`;

/**
 * Version recorded on transcripts levelled before FLAC output. Their text came
 * from the same levelled samples, so whole cached transcripts stay current.
 */
export const PREVIOUS_LEVELLED_AUDIO_PREPARATION_VERSION = `${VOLUME_LEVELLING_VERSION}+${AUDIO_PREPARATION_VERSION}`;

export { VOLUME_LEVELLING_FILTER };

export interface IAudioPreparationPolicy {
    /** Largest raw audio payload one provider request may carry. */
    maxBytes: number;
    /** Longest audio one request may carry (timeouts and output token limits). */
    maxDurationMs: number;
    acceptedMimeTypes: ReadonlySet<string>;
}

export interface IPreparedAudioChunk {
    index: number;
    startMs: number;
    endMs: number;
    bytes: Buffer;
    mimeType: string;
    hardCut: boolean;
    /** Entirely silent; transcribed as empty text without a provider call. */
    silent: boolean;
}

export type PreparedAudio =
    | { kind: "original"; probe?: IAudioProbe }
    | {
          kind: "prepared";
          version: string;
          probe: IAudioProbe;
          chunks: IPreparedAudioChunk[];
          /** The audio was loudness-levelled before chunking. */
          volumeLevelled?: boolean;
      };

/**
 * Decide whether stored audio can go to the provider unchanged, and otherwise
 * produce a compressed copy, split into ordered chunks when it is still above
 * the policy's size or duration budget. The original upload is never modified.
 */
export async function prepareAudioForTranscription(input: {
    bytes: Buffer;
    mimeType: string;
    policy: IAudioPreparationPolicy | undefined;
    /** Level loudness first; applies to every provider route. */
    levelVolume?: boolean;
    /** Container the route accepts for the levelled copy; WAV when absent. */
    levelledFormat?: LevelledAudioFormat;
    /** Upload budget for the levelled copy on routes without a policy. */
    levelledMaxBytes?: number;
    /** Longest levelled request on routes without a policy. */
    levelledMaxDurationMs?: number;
}): Promise<PreparedAudio> {
    const { bytes, mimeType, policy } = input;
    if (input.levelVolume === true)
        return prepareLevelledAudio(
            bytes,
            mimeType,
            policy ?? levelledUploadPolicy(input),
            input.levelledFormat ?? "wav",
        );
    if (!policy) return { kind: "original" };
    const fitsAsIs =
        policy.acceptedMimeTypes.has(mimeType) &&
        bytes.byteLength <= policy.maxBytes;
    try {
        return await withAudioWorkspace(bytes, async (workspace) => {
            const probe = await probeAudio(workspace.inputPath);
            if (fitsAsIs && probe.durationMs <= policy.maxDurationMs)
                return { kind: "original" as const, probe };
            const chunks = await withHeavyAudioSlot(() =>
                encodeChunks(workspace, probe.durationMs, policy),
            );
            return {
                kind: "prepared" as const,
                version: AUDIO_PREPARATION_VERSION,
                probe,
                chunks,
            };
        });
    } catch (error) {
        // Audio the provider already accepts keeps its previous behavior when
        // FFmpeg is missing or cannot read it; the provider decides.
        if (fitsAsIs) return { kind: "original" };
        if (error instanceof AudioToolUnavailableError)
            throw new Error(
                `Audio is ${formatMb(bytes.byteLength)} MB${policy.acceptedMimeTypes.has(mimeType) ? "" : ` (${mimeType})`}, outside the provider budget of ${formatMb(policy.maxBytes)} MB WAV/MP3, and ${error.message}`,
            );
        throw error;
    }
}

/**
 * Budget for a route that takes the levelled copy in its own format up to an
 * upload size: the whole file when it fits, otherwise speech MP3 chunks sized
 * so each one fits (5% headroom, as for OpenRouter) and is no longer than the
 * route's duration limit.
 */
function levelledUploadPolicy(input: {
    levelledFormat?: LevelledAudioFormat;
    levelledMaxBytes?: number;
    levelledMaxDurationMs?: number;
}): IAudioPreparationPolicy | undefined {
    const maxBytes = input.levelledMaxBytes;
    if (maxBytes === undefined) return undefined;
    return {
        maxBytes,
        maxDurationMs: Math.min(
            Math.floor(
                ((maxBytes * 8) / PREPARED_AUDIO_BITRATE_BPS) * 1000 * 0.95,
            ),
            input.levelledMaxDurationMs ?? Number.POSITIVE_INFINITY,
        ),
        acceptedMimeTypes: new Set([
            LEVELLED_AUDIO_OUTPUTS[input.levelledFormat ?? "wav"].mimeType,
        ]),
    };
}

/**
 * Level the recording with FFmpeg and send the levelled copy: whole (FLAC or
 * WAV, as the route accepts) when it fits, otherwise compressed and chunked
 * from the levelled audio so silence detection also sees the raised level.
 * Never falls back to the original, so levelled and unlevelled transcripts
 * are not mixed.
 */
async function prepareLevelledAudio(
    bytes: Buffer,
    mimeType: string,
    policy: IAudioPreparationPolicy | undefined,
    format: LevelledAudioFormat,
): Promise<PreparedAudio> {
    const output = LEVELLED_AUDIO_OUTPUTS[format];
    try {
        return await withAudioWorkspace(bytes, async (workspace) => {
            const probe = await probeAudio(workspace.inputPath);
            const levelledPath = await withHeavyAudioSlot(() =>
                levelVolume(workspace, format, probe.durationMs),
            );
            const levelled = { dir: workspace.dir, inputPath: levelledPath };
            const whole = await readFile(levelledPath);
            const fits =
                !policy ||
                (policy.acceptedMimeTypes.has(output.mimeType) &&
                    whole.byteLength <= policy.maxBytes &&
                    probe.durationMs <= policy.maxDurationMs);
            const chunks: IPreparedAudioChunk[] = fits
                ? [
                      {
                          index: 0,
                          startMs: 0,
                          endMs: probe.durationMs,
                          bytes: whole,
                          mimeType: output.mimeType,
                          hardCut: false,
                          silent: false,
                      },
                  ]
                : await withHeavyAudioSlot(() =>
                      encodeChunks(levelled, probe.durationMs, policy),
                  );
            return {
                kind: "prepared" as const,
                version: LEVELLED_AUDIO_PREPARATION_VERSION,
                probe,
                chunks,
                volumeLevelled: true,
            };
        });
    } catch (error) {
        if (error instanceof AudioToolUnavailableError)
            throw new Error(
                `Level volume first needs FFmpeg (${mimeType}, ${formatMb(bytes.byteLength)} MB): ${error.message}`,
            );
        throw error;
    }
}

async function encodeChunks(
    workspace: { dir: string; inputPath: string },
    durationMs: number,
    policy: IAudioPreparationPolicy,
): Promise<IPreparedAudioChunk[]> {
    const spans: IChunkSpan[] =
        durationMs <= policy.maxDurationMs
            ? [
                  {
                      index: 0,
                      startMs: 0,
                      endMs: durationMs,
                      hardCut: false,
                      silent: false,
                  },
              ]
            : planChunkSpans({
                  durationMs,
                  silences: await detectSilences(
                      workspace.inputPath,
                      durationMs,
                  ),
                  maxChunkMs: policy.maxDurationMs,
              });
    const chunks: IPreparedAudioChunk[] = [];
    for (const span of spans) {
        // Silent spans are kept for ordering and offsets but never sent.
        const chunkBytes = span.silent
            ? Buffer.alloc(0)
            : await encodeSpeechMp3(
                  workspace,
                  spans.length === 1 ? { index: 0 } : span,
              );
        if (!span.silent) validateChunk(chunkBytes, policy, span.index);
        chunks.push({ ...span, bytes: chunkBytes, mimeType: "audio/mpeg" });
    }
    return chunks;
}

function validateChunk(
    bytes: Buffer,
    policy: IAudioPreparationPolicy,
    index: number,
): void {
    if (!isMp3(bytes))
        throw new Error(`Prepared audio chunk ${index + 1} is not valid MP3.`);
    if (bytes.byteLength > policy.maxBytes)
        throw new Error(
            `Prepared audio chunk ${index + 1} is ${formatMb(bytes.byteLength)} MB, above the ${formatMb(policy.maxBytes)} MB provider budget.`,
        );
}

function isMp3(bytes: Buffer): boolean {
    if (bytes.byteLength < 4) return false;
    if (bytes.subarray(0, 3).toString("latin1") === "ID3") return true;
    return bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0;
}

function formatMb(bytes: number): string {
    return (bytes / (1024 * 1024)).toFixed(1);
}
