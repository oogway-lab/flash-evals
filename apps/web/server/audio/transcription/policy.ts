import { OPENROUTER_AUDIO_DEFAULT_MAX_BYTES } from "@mosaic/llm-core";
import {
    PREPARED_AUDIO_BITRATE_BPS,
    type IAudioPreparationPolicy,
} from "../preparation";
import { isOpenRouterChatAudioModel } from "./providers/openrouter";
import type { ITranscriptIdentity } from "./types";

export interface ISttExecutionPolicy {
    maxAttempts: number;
    timeoutMs?: number;
    maxAudioBytes?: number;
    preparation?: IAudioPreparationPolicy;
}

const WAV_OR_MP3 = new Set([
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
]);

/**
 * Request budget per provider route. Only OpenRouter routes opt into retries,
 * a configurable timeout, and audio preparation; other providers keep their
 * existing single-attempt behavior.
 */
export function sttExecutionPolicy(
    identity: Pick<ITranscriptIdentity, "providerId" | "canonicalModelId">,
    env: Record<string, string | undefined> = process.env,
): ISttExecutionPolicy {
    if (identity.providerId !== "openrouter") return { maxAttempts: 1 };
    const base = {
        maxAttempts: intEnv(env.STT_MAX_ATTEMPTS, 3, 1, 5),
        timeoutMs: intEnv(env.STT_REQUEST_TIMEOUT_MS, 180_000, 10_000, 600_000),
    };
    if (!isOpenRouterChatAudioModel(identity.canonicalModelId)) return base;
    const maxAudioBytes = intEnv(
        env.STT_OPENROUTER_AUDIO_MAX_BYTES,
        OPENROUTER_AUDIO_DEFAULT_MAX_BYTES,
        1024 * 1024,
        100 * 1024 * 1024,
    );
    return {
        ...base,
        maxAudioBytes,
        preparation: {
            maxBytes: maxAudioBytes,
            // A chunk must also fit the byte budget once encoded; keep 5% headroom.
            maxDurationMs: Math.min(
                intEnv(env.STT_AUDIO_MAX_CHUNK_MS, 600_000, 60_000, 3_600_000),
                Math.floor(
                    ((maxAudioBytes * 8) / PREPARED_AUDIO_BITRATE_BPS) *
                        1000 *
                        0.95,
                ),
            ),
            acceptedMimeTypes: WAV_OR_MP3,
        },
    };
}

function intEnv(
    value: string | undefined,
    fallback: number,
    min: number,
    max: number,
): number {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isSafeInteger(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
}
