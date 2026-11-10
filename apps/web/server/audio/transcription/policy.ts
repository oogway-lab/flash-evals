import { OPENROUTER_AUDIO_DEFAULT_MAX_BYTES } from "@flash-evals/llm-core";
import {
    PREPARED_AUDIO_BITRATE_BPS,
    type IAudioPreparationPolicy,
    type LevelledAudioFormat,
} from "../preparation";
import { isOpenRouterChatAudioModel } from "./providers/openrouter";
import type { ITranscriptIdentity } from "./types";

export interface ISttExecutionPolicy {
    maxAttempts: number;
    timeoutMs?: number;
    maxAudioBytes?: number;
    preparation?: IAudioPreparationPolicy;
    /** Container for audio levelled before transcription (levelVolume). */
    levelledAudioFormat: LevelledAudioFormat;
    /**
     * Largest levelled upload the route takes when it has no preparation
     * budget. A bigger levelled FLAC is re-encoded as speech MP3 from the
     * levelled audio, and split when the MP3 is still too big.
     */
    levelledAudioMaxBytes: number;
    /**
     * Longest levelled audio one request may carry on routes without a
     * preparation budget; longer audio is split as speech MP3. Undefined
     * when the route has no known duration limit.
     */
    levelledAudioMaxDurationMs?: number;
}

/*
 * Provider limits for one levelled upload, from each provider's official
 * documentation (checked 2026-11-10). Docs write MB and GB; budgets below
 * are in MiB and stay under the documented figure read as decimal MB.
 *
 * - OpenAI transcriptions: "Files can be up to 25 MB."
 *   https://developers.openai.com/api/docs/guides/speech-to-text
 * - OpenRouter transcriptions: "Multipart uploads are limited to 25 MB, the
 *   same cap OpenAI enforces."
 *   https://openrouter.ai/docs/guides/overview/multimodal/stt
 * - Vercel AI Gateway: no size or duration limit documented
 *   (https://vercel.com/docs/ai-gateway/modalities/speech-to-text,
 *   https://vercel.com/docs/ai-gateway/inputs-and-tools/audio-input); it
 *   carries OpenAI's models, so OpenAI's 25 MB is assumed.
 * - ElevenLabs Speech-to-Text: "The file size must be less than 5.0GB"; no
 *   maximum duration documented.
 *   https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 * - Soniox async: 300 minutes per file, "fixed and cannot be increased"; no
 *   per-file size limit documented (10 GB of stored files in total).
 *   https://docs.soniox.com/stt/async/limits-and-quotas
 * - Gemini API: "Max length: 9.5 hours of audio per prompt"; files over the
 *   20 MB inline request go through the Files API, "per-file maximum size of
 *   2 GB". https://aistudio.google.com/docs/audio and
 *   https://aistudio.google.com/docs/files (where ai.google.dev redirects)
 */
const MIB = 1024 * 1024;
/** 23 MiB (24.1 MB) keeps a margin under a 25 MB upload limit. */
const UNDER_25_MB = 23 * MIB;
const LEVELLED_UPLOAD_MAX_BYTES: Record<string, number> = {
    openai: UNDER_25_MB,
    openrouter: UNDER_25_MB,
    "vercel-gateway": UNDER_25_MB,
};
/**
 * ElevenLabs (5 GB), Gemini (2 GB) and Soniox (no stated limit) take far
 * larger files, but the whole upload is held in memory, so 100 MiB (about
 * 100 minutes of levelled FLAC) stays the app's own ceiling for them.
 */
const APP_LEVELLED_UPLOAD_MAX_BYTES = 100 * MIB;

export function levelledAudioMaxBytesFor(providerId: string): number {
    return (
        LEVELLED_UPLOAD_MAX_BYTES[providerId] ?? APP_LEVELLED_UPLOAD_MAX_BYTES
    );
}

/**
 * Longest levelled upload, by model family. OpenAI's gpt-4o-transcribe
 * models (mini and diarize included) refuse audio longer than about 1,500 s.
 * OpenAI's docs do not state this limit (the speech-to-text guide, the
 * transcription API reference and the gpt-4o-transcribe model page, checked
 * 2026-11-10), so 1,400 s is kept as a conservative margin. It follows the
 * model on every route (OpenAI, OpenRouter, Vercel Gateway, with or without
 * the `openai/` prefix); whisper-1 has only the size limit. Dated snapshots
 * ("gpt-4o-mini-transcribe-2025-03-20") belong to the same family.
 */
const GPT_4O_TRANSCRIBE_FAMILY =
    /^(?:openai\/)?gpt-4o(?:-mini)?-transcribe(?:-diarize)?(?:-\d{4}-\d{2}-\d{2})?$/;
const GPT_4O_TRANSCRIBE_MAX_DURATION_MS = 1_400_000;

/**
 * Documented duration limits by provider, with a margin: Soniox async takes
 * 300 minutes per file (kept to 290), Gemini 9.5 hours per prompt (kept to
 * 9). ElevenLabs, OpenRouter and Vercel Gateway document none.
 */
const PROVIDER_MAX_DURATION_MS: Record<string, number> = {
    soniox: 290 * 60_000,
    gemini: 9 * 3_600_000,
};

export function levelledAudioMaxDurationMsFor(
    canonicalModelId: string,
    providerId?: string,
): number | undefined {
    if (GPT_4O_TRANSCRIBE_FAMILY.test(canonicalModelId))
        return GPT_4O_TRANSCRIBE_MAX_DURATION_MS;
    return providerId === undefined
        ? undefined
        : PROVIDER_MAX_DURATION_MS[providerId];
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
    const levelledAudioFormat = levelledAudioFormatFor(identity);
    const levelledAudioMaxBytes = levelledAudioMaxBytesFor(identity.providerId);
    const levelledAudioMaxDurationMs = levelledAudioMaxDurationMsFor(
        identity.canonicalModelId,
        identity.providerId,
    );
    const levelled = {
        levelledAudioFormat,
        levelledAudioMaxBytes,
        ...(levelledAudioMaxDurationMs !== undefined
            ? { levelledAudioMaxDurationMs }
            : {}),
    };
    if (identity.providerId !== "openrouter")
        return { maxAttempts: 1, ...levelled };
    const base = {
        maxAttempts: intEnv(env.STT_MAX_ATTEMPTS, 3, 1, 5),
        timeoutMs: intEnv(env.STT_REQUEST_TIMEOUT_MS, 180_000, 10_000, 600_000),
        ...levelled,
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

/**
 * FLAC for every route that takes it: the OpenAI and OpenRouter transcription
 * uploads, ElevenLabs, Soniox, Gemini and Vercel Gateway. Gemini on
 * OpenRouter chat audio only takes WAV or MP3 here (llm-core
 * openrouterAudio), so it keeps WAV and its over-budget MP3 path.
 */
export function levelledAudioFormatFor(
    identity: Pick<ITranscriptIdentity, "providerId" | "canonicalModelId">,
): LevelledAudioFormat {
    return identity.providerId === "openrouter" &&
        isOpenRouterChatAudioModel(identity.canonicalModelId)
        ? "wav"
        : "flac";
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
