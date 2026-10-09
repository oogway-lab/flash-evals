import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import { getEvalProvider, type ApiKeys } from "@mosaic/llm-core";
import type { ISttTransliterationConfig } from "@mosaic/api-contract";
import { db } from "../db/client";
import { audioTranscriptVariants } from "../db/schema";
import { errorMessage } from "../lib/errors";

export interface IGetOrCreateTransliterationInput {
    datasetItemId: string;
    storageKey: string;
    sourceTranscript: string;
    config: ISttTransliterationConfig;
    apiKeys: ApiKeys;
}

const DEFAULT_PROMPT =
    "Transliterate the transcript into Latin script. Keep existing English words as English. Preserve meaning, punctuation, numbers, and line breaks. Return only the transliterated transcript.";

export async function getOrCreateTransliteration(
    input: IGetOrCreateTransliterationInput,
): Promise<string> {
    validateTransliterationConfig(input.config);
    const identity = variantIdentity(input.sourceTranscript, input.config);
    const cached = await readCachedVariant({
        datasetItemId: input.datasetItemId,
        storageKey: input.storageKey,
        identity,
    });
    if (cached) return cached;

    let transcript: string;
    try {
        transcript = await transliterateTranscript({
            sourceTranscript: input.sourceTranscript,
            config: input.config,
            apiKeys: input.apiKeys,
        });
    } catch (error) {
        await writeFailedVariant({
            input,
            identity,
            error,
        });
        throw error;
    }

    await db
        .insert(audioTranscriptVariants)
        .values({
            datasetItemId: input.datasetItemId,
            storageKey: input.storageKey,
            sourceTranscriptHash: identity.sourceTranscriptHash,
            variantKind: "latin_transliteration",
            targetScript: input.config.targetScript,
            targetLanguage: input.config.targetLanguage?.trim() ?? "",
            modelId: input.config.modelId,
            promptHash: identity.promptHash,
            prompt: input.config.prompt?.trim() || DEFAULT_PROMPT,
            transcript,
            providerMetadata: {
                model: input.config.modelId,
                providerMode: input.config.providerMode ?? "auto",
                providerBaseUrl: input.config.providerBaseUrl ?? "",
                sourceHash: identity.sourceTranscriptHash,
            },
            status: "completed",
            error: null,
        })
        .onConflictDoUpdate({
            target: [
                audioTranscriptVariants.datasetItemId,
                audioTranscriptVariants.storageKey,
                audioTranscriptVariants.sourceTranscriptHash,
                audioTranscriptVariants.variantKind,
                audioTranscriptVariants.targetScript,
                audioTranscriptVariants.targetLanguage,
                audioTranscriptVariants.modelId,
                audioTranscriptVariants.promptHash,
            ],
            set: {
                transcript,
                providerMetadata: {
                    model: input.config.modelId,
                    providerMode: input.config.providerMode ?? "auto",
                    providerBaseUrl: input.config.providerBaseUrl ?? "",
                    sourceHash: identity.sourceTranscriptHash,
                },
                status: "completed",
                error: null,
            },
        });

    return transcript;
}

function validateTransliterationConfig(config: ISttTransliterationConfig): void {
    if (
        config.temperature !== undefined &&
        (typeof config.temperature !== "number" ||
            !Number.isFinite(config.temperature) ||
            config.temperature < 0 ||
            config.temperature > 2)
    ) {
        throw new Error("Transliteration temperature must be a number between 0 and 2.");
    }
}

async function readCachedVariant(input: {
    datasetItemId: string;
    storageKey: string;
    identity: IVariantIdentity;
}): Promise<string | undefined> {
    const rows = await db
        .select({ transcript: audioTranscriptVariants.transcript })
        .from(audioTranscriptVariants)
        .where(
            and(
                eq(audioTranscriptVariants.datasetItemId, input.datasetItemId),
                eq(audioTranscriptVariants.storageKey, input.storageKey),
                eq(
                    audioTranscriptVariants.sourceTranscriptHash,
                    input.identity.sourceTranscriptHash,
                ),
                eq(audioTranscriptVariants.variantKind, "latin_transliteration"),
                eq(
                    audioTranscriptVariants.targetScript,
                    input.identity.targetScript,
                ),
                eq(
                    audioTranscriptVariants.targetLanguage,
                    input.identity.targetLanguage,
                ),
                eq(audioTranscriptVariants.modelId, input.identity.modelId),
                eq(audioTranscriptVariants.promptHash, input.identity.promptHash),
                eq(audioTranscriptVariants.status, "completed"),
            ),
        )
        .limit(1);
    return rows[0]?.transcript;
}

async function writeFailedVariant(input: {
    input: IGetOrCreateTransliterationInput;
    identity: IVariantIdentity;
    error: unknown;
}): Promise<void> {
    const config = input.input.config;
    await db
        .insert(audioTranscriptVariants)
        .values({
            datasetItemId: input.input.datasetItemId,
            storageKey: input.input.storageKey,
            sourceTranscriptHash: input.identity.sourceTranscriptHash,
            variantKind: "latin_transliteration",
            targetScript: config.targetScript,
            targetLanguage: config.targetLanguage?.trim() ?? "",
            modelId: config.modelId,
            promptHash: input.identity.promptHash,
            prompt: config.prompt?.trim() || DEFAULT_PROMPT,
            transcript: "",
            providerMetadata: variantProviderMetadata(
                config,
                input.identity.sourceTranscriptHash,
            ),
            status: "failed",
            error: errorMessage(input.error),
        })
        .onConflictDoUpdate({
            target: [
                audioTranscriptVariants.datasetItemId,
                audioTranscriptVariants.storageKey,
                audioTranscriptVariants.sourceTranscriptHash,
                audioTranscriptVariants.variantKind,
                audioTranscriptVariants.targetScript,
                audioTranscriptVariants.targetLanguage,
                audioTranscriptVariants.modelId,
                audioTranscriptVariants.promptHash,
            ],
            set: {
                transcript: "",
                providerMetadata: variantProviderMetadata(
                    config,
                    input.identity.sourceTranscriptHash,
                ),
                status: "failed",
                error: errorMessage(input.error),
            },
        });
}

async function transliterateTranscript(input: {
    sourceTranscript: string;
    config: ISttTransliterationConfig;
    apiKeys: ApiKeys;
}): Promise<string> {
    const provider = getEvalProvider(providerApiKeys(input.apiKeys, input.config), {
        provider: input.config.providerMode,
    });
    const result = await provider.complete({
        model: input.config.modelId,
        system: input.config.prompt?.trim() || DEFAULT_PROMPT,
        prompt: [
            `Target script: ${input.config.targetScript}`,
            input.config.targetLanguage
                ? `Target language: ${input.config.targetLanguage}`
                : undefined,
            "",
            "<transcript>",
            input.sourceTranscript,
            "</transcript>",
        ]
            .filter((part): part is string => part !== undefined)
            .join("\n"),
        maxTokens: 4_000,
        temperature: input.config.temperature,
    });
    const text = result.text.trim();
    if (!text) throw new Error("Transliteration returned empty text.");
    return text;
}

function providerApiKeys(
    apiKeys: ApiKeys,
    config: ISttTransliterationConfig,
): ApiKeys {
    if (!config.providerBaseUrl) return apiKeys;
    if (config.providerMode === "openrouter") {
        return { ...apiKeys, openrouterBaseUrl: config.providerBaseUrl };
    }
    if (config.providerMode === "bifrost") {
        return { ...apiKeys, bifrostBaseUrl: config.providerBaseUrl };
    }
    return apiKeys;
}

function variantProviderMetadata(
    config: ISttTransliterationConfig,
    sourceHash: string,
) {
    return {
        model: config.modelId,
        providerMode: config.providerMode ?? "auto",
        providerBaseUrl: config.providerBaseUrl ?? "",
        sourceHash,
    };
}

interface IVariantIdentity {
    sourceTranscriptHash: string;
    targetScript: string;
    targetLanguage: string;
    modelId: string;
    promptHash: string;
}

function variantIdentity(
    sourceTranscript: string,
    config: ISttTransliterationConfig,
): IVariantIdentity {
    const prompt = config.prompt?.trim() || DEFAULT_PROMPT;
    return {
        sourceTranscriptHash: hash(sourceTranscript),
        targetScript: config.targetScript,
        targetLanguage: config.targetLanguage?.trim() ?? "",
        modelId: config.modelId,
        promptHash: hash(
            JSON.stringify({
                prompt,
                providerMode: config.providerMode ?? "auto",
                providerBaseUrl: config.providerBaseUrl ?? "",
                temperature: config.temperature ?? null,
            }),
        ),
    };
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
