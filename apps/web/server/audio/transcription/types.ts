import type { ISttModelIdentity } from "@flash-evals/api-contract";
import type {
    IAudioTranscriptMetadata,
    ITranscriptSegment,
    ITranscriptSpeaker,
} from "../../db/jsonTypes";

export interface ITranscribeAudioInput {
    datasetItemId: string;
    storageKey: string;
    mimeType: string;
    modelId: string;
    language?: string;
    config?: Record<string, unknown>;
    openaiApiKey?: string;
    aiGatewayApiKey?: string;
    sonioxApiKey?: string;
    geminiApiKey?: string;
    openrouterApiKey?: string;
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

export interface ITranscriptionProviderInput {
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
    openaiApiKey?: string;
    aiGatewayApiKey?: string;
    sonioxApiKey?: string;
    geminiApiKey?: string;
    openrouterApiKey?: string;
}
