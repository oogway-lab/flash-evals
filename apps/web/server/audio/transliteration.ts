import { createHash } from "crypto";
import { and, eq } from "drizzle-orm";
import {
    bifrostModelIdFor,
    bifrostModelInfo,
    bifrostModelListKeyFor,
    completionCostFields,
    getEvalProvider,
    hasDataPolicy,
    type ApiKeys,
    type CompletionResult,
    type ICompletionDataPolicy,
} from "@flash-evals/llm-core";
import type { ISttTransliterationConfig } from "@flash-evals/api-contract";
import { db } from "../db/client";
import type { IAudioTranscriptVariantMetadata } from "../db/jsonTypes";
import { audioTranscriptVariants } from "../db/schema";
import { errorMessage } from "../lib/errors";
import { resolvePricingFor } from "../llm/pricing";
import { normalizedDataPolicy } from "../runs/dataPolicyReuse";

export interface IGetOrCreateTransliterationInput {
    datasetItemId: string;
    storageKey: string;
    sourceTranscript: string;
    config: ISttTransliterationConfig;
    apiKeys: ApiKeys;
    /** The run's data rules; a variant made under other rules is not reused. */
    dataPolicy?: ICompletionDataPolicy;
}

export interface ITransliterationResult {
    text: string;
    /** What making this variant cost, also on a cache hit, when known. */
    costUsd?: number;
    /** Spent by this call: 0 on a cache hit, undefined when not known. */
    incurredCostUsd?: number;
    cacheHit: boolean;
}

/**
 * A transliteration call that was paid for but failed (cut off or empty).
 * Callers add `incurredCostUsd` to their spend before failing the item.
 */
export class TransliterationFailedError extends Error {
    constructor(
        message: string,
        readonly incurredCostUsd: number | undefined,
    ) {
        super(message);
        this.name = "TransliterationFailedError";
    }
}

/** What a failed transliteration call cost, when it was paid and known. */
export function transliterationFailureCostUsd(
    error: unknown,
): number | undefined {
    return error instanceof TransliterationFailedError
        ? error.incurredCostUsd
        : undefined;
}

/**
 * Output budget for one transliteration: about one token per source
 * character (the Latin text is usually shorter in tokens), at least 4,000.
 * 16,000 is a conservative cap most current models can give; a reply that
 * reaches the limit is treated as cut off and fails instead of being cached.
 * Never more than the model's own output limit, when that is known.
 */
const MIN_OUTPUT_TOKENS = 4_000;
const MAX_OUTPUT_TOKENS = 16_000;
/** The fixed output limit older cached variants were made with. */
const LEGACY_OUTPUT_TOKENS = 4_000;

export function transliterationMaxTokens(
    sourceTranscript: string,
    modelMaxOutputTokens?: number,
): number {
    const budget = Math.min(
        MAX_OUTPUT_TOKENS,
        Math.max(MIN_OUTPUT_TOKENS, sourceTranscript.length + 1_000),
    );
    return modelMaxOutputTokens !== undefined && modelMaxOutputTokens > 0
        ? Math.min(budget, modelMaxOutputTokens)
        : budget;
}

/**
 * The model's output limit where this repo knows it: only Bifrost's model
 * list (for that same Bifrost and key) records one.
 */
function modelMaxOutputTokens(
    apiKeys: ApiKeys,
    config: ISttTransliterationConfig,
): number | undefined {
    if (config.providerMode !== "bifrost") return undefined;
    return bifrostModelInfo(
        bifrostModelListKeyFor(apiKeys),
        bifrostModelIdFor(config.modelId),
    )?.maxOutputTokens;
}

const DEFAULT_PROMPT =
    "Transliterate the transcript into Latin script. Keep existing English words as English. Preserve meaning, punctuation, numbers, and line breaks. Return only the transliterated transcript.";

export async function getOrCreateTransliteration(
    input: IGetOrCreateTransliterationInput,
): Promise<ITransliterationResult> {
    validateTransliterationConfig(input.config);
    const identity = variantIdentity(
        input.sourceTranscript,
        input.config,
        input.dataPolicy,
    );
    const cached = await readCachedVariant({
        datasetItemId: input.datasetItemId,
        storageKey: input.storageKey,
        identity,
    });
    // Variants saved before replies were checked for a cut-off carry no
    // costSource: they may be cut, so they are made again (and replaced).
    if (cached?.providerMetadata?.costSource)
        return {
            text: cached.transcript,
            ...(cached.providerMetadata?.costUsd !== undefined
                ? { costUsd: cached.providerMetadata.costUsd }
                : {}),
            incurredCostUsd: 0,
            cacheHit: true,
        };

    let transcript: string;
    let metadata: IAudioTranscriptVariantMetadata;
    let costUsd: number | undefined;
    try {
        const result = await transliterateTranscript({
            sourceTranscript: input.sourceTranscript,
            config: input.config,
            apiKeys: input.apiKeys,
            dataPolicy: input.dataPolicy,
        });
        transcript = result.text;
        costUsd = result.costUsd;
        metadata = {
            ...variantProviderMetadata(
                input.config,
                identity.sourceTranscriptHash,
            ),
            ...(costUsd !== undefined ? { costUsd } : {}),
            costSource: costUsd !== undefined ? "computed" : "unavailable",
            ...(result.servedBy ? { servedBy: result.servedBy } : {}),
        };
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
            providerMetadata: metadata,
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
                providerMetadata: metadata,
                status: "completed",
                error: null,
            },
        });

    return {
        text: transcript,
        ...(costUsd !== undefined ? { costUsd, incurredCostUsd: costUsd } : {}),
        cacheHit: false,
    };
}

function validateTransliterationConfig(
    config: ISttTransliterationConfig,
): void {
    if (
        config.temperature !== undefined &&
        (typeof config.temperature !== "number" ||
            !Number.isFinite(config.temperature) ||
            config.temperature < 0 ||
            config.temperature > 2)
    ) {
        throw new Error(
            "Transliteration temperature must be a number between 0 and 2.",
        );
    }
}

async function readCachedVariant(input: {
    datasetItemId: string;
    storageKey: string;
    identity: IVariantIdentity;
}): Promise<
    | {
          transcript: string;
          providerMetadata: IAudioTranscriptVariantMetadata | null;
      }
    | undefined
> {
    const rows = await db
        .select({
            transcript: audioTranscriptVariants.transcript,
            providerMetadata: audioTranscriptVariants.providerMetadata,
        })
        .from(audioTranscriptVariants)
        .where(
            and(
                eq(audioTranscriptVariants.datasetItemId, input.datasetItemId),
                eq(audioTranscriptVariants.storageKey, input.storageKey),
                eq(
                    audioTranscriptVariants.sourceTranscriptHash,
                    input.identity.sourceTranscriptHash,
                ),
                eq(
                    audioTranscriptVariants.variantKind,
                    "latin_transliteration",
                ),
                eq(
                    audioTranscriptVariants.targetScript,
                    input.identity.targetScript,
                ),
                eq(
                    audioTranscriptVariants.targetLanguage,
                    input.identity.targetLanguage,
                ),
                eq(audioTranscriptVariants.modelId, input.identity.modelId),
                eq(
                    audioTranscriptVariants.promptHash,
                    input.identity.promptHash,
                ),
                eq(audioTranscriptVariants.status, "completed"),
            ),
        )
        .limit(1);
    return rows[0];
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
    dataPolicy?: ICompletionDataPolicy;
}): Promise<{ text: string; costUsd?: number; servedBy?: string }> {
    const apiKeys = input.apiKeys;
    assertRecordedBaseUrl(apiKeys, input.config);
    const provider = getEvalProvider(apiKeys, {
        // "auto" when unset, as the cached variant records it (never the
        // FLASH_EVALS_LLM_PROVIDER default).
        provider: input.config.providerMode ?? "auto",
    });
    const maxTokens = transliterationMaxTokens(
        input.sourceTranscript,
        modelMaxOutputTokens(apiKeys, input.config),
    );
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
        maxTokens,
        temperature: input.config.temperature,
        ...(hasDataPolicy(input.dataPolicy)
            ? { dataPolicy: input.dataPolicy }
            : {}),
    });
    // The call is paid even when its reply is unusable: cost first.
    const { costUsd } = completionCostFields(
        result,
        await resolvePricingFor(input.config.modelId, input.apiKeys),
    );
    assertNotTruncated(result, maxTokens, costUsd);
    const text = result.text.trim();
    if (!text)
        throw new TransliterationFailedError(
            "Transliteration returned empty text.",
            costUsd,
        );
    const servedBy = result.providerMetadata?.servedBy;
    return {
        text,
        ...(costUsd !== undefined ? { costUsd } : {}),
        ...(servedBy ? { servedBy } : {}),
    };
}

/**
 * OpenAI-compatible routes already fail on finish_reason "length"; other
 * routes report usage, so a reply that used the whole budget counts as cut.
 */
function assertNotTruncated(
    result: Pick<CompletionResult, "usage">,
    maxTokens: number,
    costUsd: number | undefined,
): void {
    const outputTokens = result.usage.completionTokens;
    if (outputTokens !== undefined && outputTokens >= maxTokens)
        throw new TransliterationFailedError(
            `Transliteration reached the ${maxTokens.toLocaleString("en-US")}-token output limit, so the Latin transcript would be cut off.`,
            costUsd,
        );
}

/**
 * The key goes only to the base URL resolved with it (a team's saved URL
 * with its saved key, else .env with .env). A run recorded with another
 * address (made before this check, or Settings changed since) fails rather
 * than send the key there.
 */
function assertRecordedBaseUrl(
    apiKeys: ApiKeys,
    config: ISttTransliterationConfig,
): void {
    const recorded = config.providerBaseUrl;
    if (!recorded) return;
    const label =
        config.providerMode === "openrouter"
            ? "OpenRouter"
            : config.providerMode === "bifrost"
              ? "Bifrost"
              : undefined;
    if (!label) return;
    // A saved URL that failed its re-check: say why, not "another address".
    const unusable =
        config.providerMode === "openrouter"
            ? apiKeys.unusable?.openrouter
            : apiKeys.unusable?.bifrost;
    if (unusable) throw new Error(unusable);
    const current =
        config.providerMode === "openrouter"
            ? apiKeys.openrouterBaseUrl
            : apiKeys.bifrostBaseUrl;
    if (withoutTrailingSlash(recorded) !== withoutTrailingSlash(current ?? ""))
        throw new Error(
            `This run's transliteration was set up for another ${label} address than the key now in use. Start a new run to use the current ${label} settings.`,
        );
}

function withoutTrailingSlash(url: string): string {
    return url.replace(/\/+$/, "");
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
    dataPolicy: ICompletionDataPolicy | undefined,
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
                // Variants were once cut at a fixed 4,000 output tokens. A
                // transcript whose budget is now larger gets a new variant,
                // so a possibly cut one is not reused; short ones stay.
                ...(transliterationMaxTokens(sourceTranscript) !==
                LEGACY_OUTPUT_TOKENS
                    ? {
                          outputTokens:
                              transliterationMaxTokens(sourceTranscript),
                      }
                    : {}),
                // Only set rules change the hash, so earlier variants stay.
                ...(normalizedDataPolicy(dataPolicy)
                    ? { dataPolicy: normalizedDataPolicy(dataPolicy) }
                    : {}),
            }),
        ),
    };
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}
