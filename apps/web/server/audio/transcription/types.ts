import type { ISttModelIdentity } from "@flash-evals/api-contract";
import type {
    IAudioTranscriptMetadata,
    ITranscriptSegment,
    ITranscriptSpeaker,
} from "../../db/jsonTypes";

/** Provider keys a transcription call may need, one per STT provider. */
export interface ISttProviderCallKeys {
    openaiApiKey?: string;
    aiGatewayApiKey?: string;
    sonioxApiKey?: string;
    elevenlabsApiKey?: string;
    geminiApiKey?: string;
    openrouterApiKey?: string;
}

export interface ITranscribeAudioInput extends ISttProviderCallKeys {
    datasetItemId: string;
    storageKey: string;
    mimeType: string;
    modelId: string;
    language?: string;
    config?: Record<string, unknown>;
    /** Level loudness with FFmpeg before transcription (ISttRunConfig.levelVolume). */
    levelVolume?: boolean;
    /** New provider spend, checkpointed after each completed part; never called for cache hits. */
    onCostIncurred?: (costUsd: number | undefined) => Promise<void>;
}

export interface ITranscriptArtifact {
    text: string;
    segments: ITranscriptSegment[];
    speakers: ITranscriptSpeaker[];
    detectedLanguage?: string;
    /** Audio length as reported by the provider; the billing unit for async STT. */
    durationMs?: number;
    providerMetadata?: IAudioTranscriptMetadata;
    warnings: string[];
}

export interface ITranscriptIdentity extends ISttModelIdentity {
    configHash: string;
    configJson: Record<string, unknown>;
}

export interface ITranscriptionProviderInput extends ISttProviderCallKeys {
    bytes: Buffer;
    mimeType: string;
    modelId: string;
    canonicalModelId: string;
    providerId: ISttModelIdentity["providerId"];
    language: string | undefined;
    config?: Record<string, unknown>;
    /** Per-request timeout; providers without a policy keep their default. */
    timeoutMs?: number;
    /** Largest raw audio payload the adapter may send. */
    maxAudioBytes?: number;
}

/**
 * The provider answered (and billed the call) but the transcript is empty.
 * Carries what the reply said about the charge, so it can be recorded
 * before the request fails.
 */
export class EmptyTranscriptError extends Error {
    readonly durationMs?: number;
    readonly costUsd?: number;

    constructor(
        message: string,
        billing: { durationMs?: number; costUsd?: number } = {},
    ) {
        super(message);
        this.name = "EmptyTranscriptError";
        if (billing.durationMs !== undefined)
            this.durationMs = billing.durationMs;
        if (billing.costUsd !== undefined) this.costUsd = billing.costUsd;
    }
}
