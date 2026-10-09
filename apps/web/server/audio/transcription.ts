import {
    invalidSttConfigMessagesForModelId,
    sttPayloadConfigFieldsForModelId,
    sttModelSupportsLanguage,
    unsupportedSttConfigKeysForFields,
} from "@mosaic/api-contract";
import { loadAudioBytes } from "./source";
import { dispatchTranscription } from "./transcription/dispatcher";
import {
    readCachedTranscript,
    transcriptIdentity,
    writeCompletedTranscriptArtifact,
    writeFailedTranscriptArtifact,
} from "./transcription/store";
import type {
    ITranscriptArtifact,
    ITranscriptIdentity,
    ITranscribeAudioInput,
} from "./transcription/types";

export type {
    ITranscriptArtifact,
    ITranscribeAudioInput,
} from "./transcription/types";

export async function getOrCreateAudioTranscript(
    input: ITranscribeAudioInput,
): Promise<string> {
    const artifact = await getOrCreateAudioTranscriptArtifact(input);
    return artifact.text;
}

export async function getOrCreateAudioTranscriptArtifact(
    input: ITranscribeAudioInput,
): Promise<ITranscriptArtifact> {
    const result = await resolveAudioTranscriptArtifact(input);
    return result.legacyArtifact;
}

export interface ITranscriptArtifactProvenance {
    artifact: ITranscriptArtifact;
    cacheHit: boolean;
    lookupLatencyMs: number;
}

export async function getOrCreateAudioTranscriptArtifactWithProvenance(
    input: ITranscribeAudioInput,
): Promise<ITranscriptArtifactProvenance> {
    const result = await resolveAudioTranscriptArtifact(input);
    return {
        artifact: result.artifact,
        cacheHit: result.cacheHit,
        lookupLatencyMs: result.lookupLatencyMs,
    };
}

interface IResolvedTranscriptArtifact extends ITranscriptArtifactProvenance {
    legacyArtifact: ITranscriptArtifact;
}

async function resolveAudioTranscriptArtifact(
    input: ITranscribeAudioInput,
): Promise<IResolvedTranscriptArtifact> {
    const language = normalizeLanguage(input.language);
    const identity = transcriptIdentity(input.modelId, input.config);
    validateConfigForExecution(input.modelId, language, input.config, identity);
    const lookupStartedAt = Date.now();
    const cached = await readCachedTranscript({
        datasetItemId: input.datasetItemId,
        storageKey: input.storageKey,
        identity,
        language,
    });
    const lookupLatencyMs = Date.now() - lookupStartedAt;
    if (cached)
        return {
            artifact: cached,
            legacyArtifact: cached,
            cacheHit: true,
            lookupLatencyMs,
        };

    validateCredentialsForExecution(input, identity);
    const startedAt = Date.now();
    const bytes = await loadAudioBytes(input.storageKey);
    let artifact: ITranscriptArtifact;
    try {
        artifact = await dispatchTranscription({
            bytes,
            mimeType: input.mimeType,
            modelId: input.modelId,
            canonicalModelId: identity.canonicalModelId,
            providerId: identity.providerId,
            language,
            config: input.config,
            openaiApiKey: input.openaiApiKey,
            aiGatewayApiKey: input.aiGatewayApiKey,
            sonioxApiKey: input.sonioxApiKey,
            geminiApiKey: input.geminiApiKey,
            openrouterApiKey: input.openrouterApiKey,
        });
    } catch (error) {
        await writeFailedTranscriptArtifact({
            datasetItemId: input.datasetItemId,
            storageKey: input.storageKey,
            modelId: input.modelId,
            language,
            identity,
            error,
        });
        throw error;
    }
    const persistedArtifact = await writeCompletedTranscriptArtifact({
        datasetItemId: input.datasetItemId,
        storageKey: input.storageKey,
        modelId: input.modelId,
        language,
        identity,
        artifact,
        latencyMsTotal: Date.now() - startedAt,
    });
    return {
        artifact: persistedArtifact,
        legacyArtifact: artifact,
        cacheHit: false,
        lookupLatencyMs,
    };
}

function validateConfigForExecution(
    modelId: string,
    language: string | undefined,
    config: Record<string, unknown> | undefined,
    identity: ITranscriptIdentity,
): void {
    if (identity.providerId === "bifrost") {
        throw new Error(
            "Bifrost uploaded-audio transcription is not enabled until its STT route and response shape are verified.",
        );
    }
    if (!isExecutableModelId(modelId, identity)) {
        throw new Error(
            `STT model ${modelId} is not enabled for uploaded-audio transcription.`,
        );
    }
    if (language && !sttModelSupportsLanguage(modelId)) {
        throw new Error(
            `STT model ${modelId} does not support an audio language override.`,
        );
    }
    if (!config) return;
    const fields = sttPayloadConfigFieldsForModelId(modelId);
    const unknownKeys = unsupportedSttConfigKeysForFields(fields, config);
    if (unknownKeys.length > 0) {
        throw new Error(
            `Unsupported STT config for ${modelId}: ${unknownKeys.join(", ")}.`,
        );
    }
    const invalidMessages = invalidSttConfigMessagesForModelId(modelId, config);
    if (invalidMessages.length > 0) {
        throw new Error(
            `Invalid STT config for ${modelId}: ${invalidMessages.join(" ")}`,
        );
    }
}

function validateCredentialsForExecution(
    input: ITranscribeAudioInput,
    identity: ITranscriptIdentity,
): void {
    if (identity.providerId === "vercel-gateway" && !input.aiGatewayApiKey) {
        throw new Error(
            "Add AI_GATEWAY_API_KEY to run Vercel Gateway transcription.",
        );
    }
    if (identity.providerId === "soniox" && !input.sonioxApiKey) {
        throw new Error("Add SONIOX_API_KEY to run Soniox transcription.");
    }
    if (identity.providerId === "openai" && !input.openaiApiKey) {
        throw new Error("Add OPENAI_API_KEY to run audio transcription.");
    }
    if (identity.providerId === "gemini" && !input.geminiApiKey) {
        throw new Error("Add GEMINI_API_KEY to run Gemini transcription.");
    }
    if (identity.providerId === "openrouter" && !input.openrouterApiKey) {
        throw new Error(
            "Add OPENROUTER_API_KEY to run OpenRouter transcription.",
        );
    }
}

function isExecutableModelId(
    modelId: string,
    identity: ITranscriptIdentity,
): boolean {
    if (
        identity.providerId === "vercel-gateway" ||
        identity.providerId === "soniox" ||
        identity.providerId === "gemini" ||
        identity.providerId === "openrouter"
    ) {
        return true;
    }
    if (identity.providerId !== "openai") return false;
    if (modelId !== identity.canonicalModelId) return true;
    return [
        "gpt-4o-transcribe",
        "gpt-4o-mini-transcribe",
        "whisper-1",
        "gpt-4o-transcribe-diarize",
    ].includes(identity.canonicalModelId);
}

function normalizeLanguage(language: string | undefined): string | undefined {
    const trimmed = language?.trim().toLowerCase();
    return trimmed || undefined;
}
