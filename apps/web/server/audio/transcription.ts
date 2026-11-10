import {
    invalidSttConfigMessagesForModelId,
    sttPayloadConfigFieldsForModelId,
    sttCostUsdForDuration,
    sttModelSupportsLanguage,
    unsupportedSttConfigKeysForFields,
} from "@flash-evals/api-contract";
import { loadAudioBytes } from "./source";
import {
    cachedPreparationIsCurrent,
    executeTranscription,
} from "./transcription/execute";
import { sttExecutionPolicy } from "./transcription/policy";
import { TranscriptionAttemptsError } from "./transcription/retry";
import {
    readCachedTranscript,
    transcriptIdentity,
    writeCompletedTranscriptArtifact,
    writeFailedTranscriptArtifact,
} from "./transcription/store";
import {
    EmptyTranscriptError,
    type ITranscriptArtifact,
    type ITranscriptIdentity,
    type ITranscribeAudioInput,
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
    /**
     * New provider spend for this call: zero on a cache hit, and excluding
     * chunks reused from an earlier attempt. Undefined when not reported.
     */
    incurredCostUsd: number | undefined;
}

export async function getOrCreateAudioTranscriptArtifactWithProvenance(
    input: ITranscribeAudioInput,
): Promise<ITranscriptArtifactProvenance> {
    const result = await resolveAudioTranscriptArtifact(input);
    return {
        artifact: result.artifact,
        cacheHit: result.cacheHit,
        lookupLatencyMs: result.lookupLatencyMs,
        incurredCostUsd: result.incurredCostUsd,
    };
}

interface IResolvedTranscriptArtifact extends ITranscriptArtifactProvenance {
    legacyArtifact: ITranscriptArtifact;
}

async function resolveAudioTranscriptArtifact(
    input: ITranscribeAudioInput,
): Promise<IResolvedTranscriptArtifact> {
    const language = normalizeLanguage(input.language);
    const identity = transcriptIdentity(input.modelId, input.config, {
        levelVolume: input.levelVolume,
    });
    validateConfigForExecution(input.modelId, language, input.config, identity);
    const lookupStartedAt = Date.now();
    const cached = await readCachedTranscript({
        datasetItemId: input.datasetItemId,
        storageKey: input.storageKey,
        identity,
        language,
    });
    const lookupLatencyMs = Date.now() - lookupStartedAt;
    if (cached && cachedPreparationIsCurrent(cached))
        return {
            artifact: cached,
            legacyArtifact: cached,
            cacheHit: true,
            lookupLatencyMs,
            incurredCostUsd: 0,
        };

    validateCredentialsForExecution(input, identity);
    const startedAt = Date.now();
    const bytes = await loadAudioBytes(input.storageKey);
    const persisted = {
        datasetItemId: input.datasetItemId,
        modelId: input.modelId,
        language,
        identity,
    };
    let artifact: ITranscriptArtifact;
    try {
        artifact = await executeTranscription({
            request: {
                modelId: input.modelId,
                canonicalModelId: identity.canonicalModelId,
                providerId: identity.providerId,
                language,
                config: input.config,
                openaiApiKey: input.openaiApiKey,
                aiGatewayApiKey: input.aiGatewayApiKey,
                sonioxApiKey: input.sonioxApiKey,
                elevenlabsApiKey: input.elevenlabsApiKey,
                geminiApiKey: input.geminiApiKey,
                openrouterApiKey: input.openrouterApiKey,
            },
            storageKey: input.storageKey,
            bytes,
            mimeType: input.mimeType,
            policy: sttExecutionPolicy(identity),
            ...(input.levelVolume === true ? { levelVolume: true } : {}),
            chunkStore: {
                read: (storageKey) =>
                    readCachedTranscript({
                        datasetItemId: input.datasetItemId,
                        storageKey,
                        identity,
                        language,
                    }),
                write: async (storageKey, chunkArtifact, latencyMsTotal) => {
                    const stored = await writeCompletedTranscriptArtifact({
                        ...persisted,
                        storageKey,
                        artifact: chunkArtifact,
                        latencyMsTotal,
                    });
                    await input.onCostIncurred?.(
                        stored.providerMetadata?.costUsd,
                    );
                    return stored;
                },
            },
        });
    } catch (error) {
        // A billed reply with no text still costs: record it, then fail.
        const empty = emptyTranscriptError(error);
        if (empty)
            await input.onCostIncurred?.(
                empty.costUsd ??
                    sttCostUsdForDuration(
                        input.modelId,
                        empty.durationMs,
                        identity.configJson,
                    ),
            );
        await writeFailedTranscriptArtifact({
            ...persisted,
            storageKey: input.storageKey,
            error,
        });
        throw error;
    }
    const persistedArtifact = await writeCompletedTranscriptArtifact({
        ...persisted,
        storageKey: input.storageKey,
        artifact,
        latencyMsTotal: Date.now() - startedAt,
    });
    const metadata = persistedArtifact.providerMetadata;
    // Prepared chunks report their charges individually above. Unchanged audio
    // has one charge, including duration-based pricing added by persistence.
    if (!metadata?.audioPreparation)
        await input.onCostIncurred?.(
            metadata?.incurredCostUsd ?? metadata?.costUsd,
        );
    return {
        artifact: persistedArtifact,
        legacyArtifact: artifact,
        cacheHit: false,
        lookupLatencyMs,
        incurredCostUsd: metadata?.incurredCostUsd ?? metadata?.costUsd,
    };
}

function emptyTranscriptError(
    error: unknown,
): EmptyTranscriptError | undefined {
    const cause =
        error instanceof TranscriptionAttemptsError ? error.lastError : error;
    return cause instanceof EmptyTranscriptError ? cause : undefined;
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
            "Add your AI Gateway API key in Settings (or AI_GATEWAY_API_KEY in the app's .env) to run Vercel Gateway transcription.",
        );
    }
    if (identity.providerId === "soniox" && !input.sonioxApiKey) {
        throw new Error(
            "Add your Soniox API key in Settings (or SONIOX_API_KEY in the app's .env) to run Soniox transcription.",
        );
    }
    if (identity.providerId === "elevenlabs" && !input.elevenlabsApiKey) {
        throw new Error(
            "Add your ElevenLabs API key in Settings (or ELEVENLABS_API_KEY in the app's .env) to run ElevenLabs transcription.",
        );
    }
    if (identity.providerId === "openai" && !input.openaiApiKey) {
        throw new Error(
            "Add your OpenAI API key in Settings (or OPENAI_API_KEY in the app's .env) to run audio transcription.",
        );
    }
    if (identity.providerId === "gemini" && !input.geminiApiKey) {
        throw new Error(
            "Add your Gemini API key in Settings (or GEMINI_API_KEY in the app's .env) to run Gemini transcription.",
        );
    }
    if (identity.providerId === "openrouter" && !input.openrouterApiKey) {
        throw new Error(
            "Add your OpenRouter API key in Settings (or OPENROUTER_API_KEY in the app's .env) to run OpenRouter transcription.",
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
        identity.providerId === "elevenlabs" ||
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
