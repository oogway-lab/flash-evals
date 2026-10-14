import {
    AudioToolUnavailableError,
    detectSilences,
    encodeSpeechMp3,
    probeAudio,
    withAudioWorkspace,
    type IAudioProbe,
} from "./ffmpeg";
import { planChunkSpans } from "./plan";

/**
 * Bump when the encoding or chunking changes so transcripts made from older
 * prepared audio are not reused. Untransformed audio never carries a version.
 */
export const AUDIO_PREPARATION_VERSION = "speech-mp3-16k-mono-48k.v1";

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
}

export type PreparedAudio =
    | { kind: "original"; probe?: IAudioProbe }
    | {
          kind: "prepared";
          version: string;
          probe: IAudioProbe;
          chunks: IPreparedAudioChunk[];
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
}): Promise<PreparedAudio> {
    const { bytes, mimeType, policy } = input;
    if (!policy) return { kind: "original" };
    const fitsAsIs =
        policy.acceptedMimeTypes.has(mimeType) &&
        bytes.byteLength <= policy.maxBytes;
    try {
        return await withAudioWorkspace(bytes, async (workspace) => {
            const probe = await probeAudio(workspace.inputPath);
            if (fitsAsIs && probe.durationMs <= policy.maxDurationMs)
                return { kind: "original" as const, probe };
            const spans =
                probe.durationMs <= policy.maxDurationMs
                    ? [
                          {
                              index: 0,
                              startMs: 0,
                              endMs: probe.durationMs,
                              hardCut: false,
                          },
                      ]
                    : planChunkSpans({
                          durationMs: probe.durationMs,
                          silences: await detectSilences(workspace.inputPath),
                          maxChunkMs: policy.maxDurationMs,
                      });
            const chunks: IPreparedAudioChunk[] = [];
            for (const span of spans) {
                const chunkBytes = await encodeSpeechMp3(
                    workspace,
                    spans.length === 1 ? { index: 0 } : span,
                );
                validateChunk(chunkBytes, policy, span.index);
                chunks.push({
                    ...span,
                    bytes: chunkBytes,
                    mimeType: "audio/mpeg",
                });
            }
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
