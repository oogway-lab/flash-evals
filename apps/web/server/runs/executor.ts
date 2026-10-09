import { eq } from "drizzle-orm";
import { getBareModelName, type ApiKeys } from "@mosaic/llm-core";
import { redactSecrets, redactedErrorDetail } from "@mosaic/secrets";
import {
    canonicalJsonString,
    isSttMetricsModelId,
    parseSttMetricsModelId,
    type ISttRunConfig,
    type ProviderTransport,
} from "@mosaic/api-contract";
import { db } from "../db/client";
import {
    runs,
    runCells,
    cellScores,
    datasetItems,
    judgeConfigs,
} from "../db/schema";
import type { runModels } from "../db/schema";
import type {
    IAudioTranscriptMetadata,
    FieldRule,
    ITranscriptSegment,
    IPipelineFieldConfig,
    JsonSchemaObject,
    LabelJson,
    OutputJson,
    RunConfigSnapshot,
} from "../db/jsonTypes";
import {
    getRun,
    getRunModels,
    getRunCells,
    getScoredRunCellIds,
    findCachedCell,
    claimRunCells,
    contentFingerprintForItem,
} from "./service";
import { getPromptSchemaVersion, getPromptVersion } from "../prompts/service";
import { validateDataAgainstSchema } from "../prompts/schemaValidation";
import { getDatasetSchema, getLabelsForItems } from "../datasets/service";
import {
    getPipeline,
    getPipelineForDataset,
    fieldConfigsFromSchema,
} from "../pipelines/service";
import { loadImage } from "../images/source";
import { getOrCreateAudioTranscriptArtifactWithProvenance } from "../audio/transcription";
import { getOrCreateTransliteration } from "../audio/transliteration";
import { scoreTranscriptMetrics } from "../audio/metrics";
import {
    runTranscriptEvaluator,
    type ITranscriptEvaluatorResult,
} from "../audio/customEvaluators";
import { executeCell } from "../jobs/runOrchestrator";
import { resolveApiKeys } from "../secrets/resolveApiKeys";
import { resolveReasoningEffort } from "../llm/reasoningConfig";
import { resolvePricingFor } from "../llm/pricing";
import { scoreOutput } from "../scoring/scoreOutput";
import { runJudge, type JudgeOutcome } from "../scoring/judge";
import {
    getJudgePromptVersion,
    type IJudgePromptOption,
} from "../judges/service";
import { isRecord } from "../lib/objects";
import { errorMessage } from "../lib/errors";
import { forEachPool } from "../lib/concurrency";

const CONCURRENCY = Math.max(1, Number(process.env.EVAL_CONCURRENCY ?? 5) || 1);

export async function executeRun(runId: string): Promise<void> {
    const run = await getRun(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    const maxTokens = run.configSnapshot.maxTokens;

    const { apiKeys, sttProviderKeys } = await resolveApiKeys(run.teamId);

    const pipeline = run.pipelineId
        ? await getPipeline(run.pipelineId)
        : await getPipelineForDataset(run.datasetId);
    let responseSchema:
        { name: string; schema: Record<string, unknown> } | undefined;
    let datasetSchema:
        { jsonSchema: JsonSchemaObject; fieldRules: FieldRule[] } | undefined;
    if (pipeline) {
        responseSchema = { name: "output", schema: pipeline.outputSchema };
    } else {
        datasetSchema = await getDatasetSchema(run.datasetId);
        if (datasetSchema) {
            responseSchema = {
                name: "output",
                schema: datasetSchema.jsonSchema,
            };
        }
    }
    const fieldConfigs = fieldConfigsForRunScoring({
        snapshotFieldConfigs: run.configSnapshot.fieldConfigs,
        pipelineFieldConfigs: pipeline?.fieldConfigs,
        datasetSchema,
    });

    const runModelRows = await getRunModels(runId);
    const transportByModel = new Map(
        (run.configSnapshot.models ?? []).flatMap((model) =>
            model.transport ? [[model.modelId, model.transport] as const] : [],
        ),
    );
    const modelById = new Map(runModelRows.map((rm) => [rm.id, rm]));
    const referenceModel = runModelRows.find((rm) => rm.isReference);

    let judge: typeof judgeConfigs.$inferSelect | undefined;
    if (run.judgeConfigId) {
        const [j] = await db
            .select()
            .from(judgeConfigs)
            .where(eq(judgeConfigs.id, run.judgeConfigId))
            .limit(1);
        judge = j;
    }
    const judgePrompt = await loadJudgePromptForRun(run);

    const itemRows = await db
        .select()
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, run.datasetId));
    const itemById = new Map(itemRows.map((i) => [i.id, i]));
    const labelsByItemId = await getLabelsForItems(
        itemRows.map((item) => item.id),
    );

    const promptCache = new Map<string, Promise<string>>();
    const promptContent = (pvId: string): Promise<string> =>
        memoizedPromise(promptCache, pvId, async () => {
            const pv = await getPromptVersion(pvId);
            return pv?.content ?? "";
        });
    const schemaCache = new Map<
        string,
        Promise<{ name: string; schema: Record<string, unknown> } | undefined>
    >();
    const responseSchemaForRunModel = async (
        rm: typeof runModels.$inferSelect,
    ): Promise<
        { name: string; schema: Record<string, unknown> } | undefined
    > => {
        const schemaVersionId = rm.schemaVersionId;
        if (!schemaVersionId) return responseSchema;
        return memoizedPromise(schemaCache, schemaVersionId, async () => {
            const schemaVersion = await getPromptSchemaVersion(schemaVersionId);
            return schemaVersion
                ? { name: "output", schema: schemaVersion.jsonSchema }
                : undefined;
        });
    };
    const inputCache = new Map<string, Promise<IResolvedItemInput>>();
    const resolvedInputFor = (
        item: typeof datasetItems.$inferSelect,
        runModel: typeof runModels.$inferSelect,
    ): Promise<IResolvedItemInput> => {
        const cacheKey = variantAwareCacheKey(runModel, item.id);
        let cached = inputCache.get(cacheKey);
        if (!cached) {
            const sttConfig = sttConfigForRunModel(
                run.configSnapshot,
                runModel.modelId,
            );
            cached = inputTextForItem({
                item,
                sttConfig,
                openaiApiKey: sttProviderKeys.openai ?? apiKeys.openai,
                aiGatewayApiKey:
                    sttProviderKeys.vercelGateway ?? apiKeys.gateway,
                sonioxApiKey: sttProviderKeys.soniox,
                geminiApiKey: sttProviderKeys.gemini,
                openrouterApiKey: sttProviderKeys.openrouter,
                apiKeys,
            });
            inputCache.set(cacheKey, cached);
        }
        return cached;
    };

    await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));

    // Atomic claim: flips pending/failed cells to 'running' and returns only the
    // rows this call won, so a concurrent retry can't double-execute or double-bill.
    const claimed = await claimRunCells(runId);

    // Phase 1: generation — every cell calls the model (or reuses a cache hit).
    try {
        await forEachPool(claimed, CONCURRENCY, async (cell) => {
            const rm = modelById.get(cell.runModelId);
            const item = itemById.get(cell.datasetItemId);
            if (!rm || !item) {
                await db
                    .update(runCells)
                    .set({ status: "failed", error: "missing model or item" })
                    .where(eq(runCells.id, cell.id));
                return;
            }

            try {
                const sttConfig = sttConfigForRunModel(
                    run.configSnapshot,
                    rm.modelId,
                );
                await generateCellOutput({
                    cell,
                    runModel: rm,
                    item,
                    sttConfig,
                    maxTokens,
                    apiKeys,
                    transport: transportByModel.get(rm.modelId),
                    promptContent,
                    resolvedInputFor,
                    responseSchemaForRunModel,
                });
            } catch (err) {
                await markCellFailed(cell.id, errorMessage(err));
            }
        });
    } catch (genErr) {
        // Log but continue to scoring + final status so we don't leave the run in limbo
        console.error(
            `generation phase error for run ${runId}:`,
            redactedErrorDetail(genErr),
        );
    }

    // Phase 2: scoring — runs after all generations so the judge sees reference outputs.
    const claimedIds = new Set(claimed.map((c) => c.id));
    const generatedCells = await getRunCells(runId);
    const scoredCellIds = await getScoredRunCellIds(runId);
    const toScore = generatedCells.filter(
        (c) =>
            (claimedIds.has(c.id) || !scoredCellIds.has(c.id)) &&
            (c.status === "succeeded" || c.status === "cached"),
    );
    const referenceByItemId = new Map(
        generatedCells
            .filter(
                (cell) =>
                    cell.runModelId === referenceModel?.id &&
                    (cell.status === "succeeded" || cell.status === "cached"),
            )
            .map((cell) => [cell.datasetItemId, cell.outputJson ?? undefined]),
    );
    const transcriptJudgeCache = new Map<
        string,
        Promise<ITranscriptEvaluatorResult | undefined>
    >();

    try {
        await forEachPool(toScore, CONCURRENCY, async (cell) => {
            const item = itemById.get(cell.datasetItemId);
            const rm = modelById.get(cell.runModelId);
            if (!item || !rm) return;
            try {
                const sttConfig = sttConfigForRunModel(
                    run.configSnapshot,
                    rm.modelId,
                );
                const resolvedInput = await resolvedInputFor(item, rm);
                const label = labelsByItemId.get(item.id);
                const transcriptEvaluator =
                    transcriptEvaluatorForConfig(sttConfig);
                const transcriptJudge = await memoizedPromise(
                    transcriptJudgeCache,
                    variantAwareCacheKey(rm, item.id),
                    () =>
                        runTranscriptEvaluator({
                            config: transcriptEvaluator
                                ? {
                                      ...transcriptEvaluator,
                                      reasoningEffort: resolveReasoningEffort(
                                          transcriptEvaluator.modelId,
                                          transcriptEvaluator.reasoningEffort,
                                      ),
                                  }
                                : undefined,
                            transcript: transcriptCandidateText(
                                resolvedInput.text ?? undefined,
                            ),
                            label,
                            apiKeys,
                            maxTokens,
                        }),
                );
                await scoreCell({
                    cellId: cell.id,
                    inputText: resolvedInput.text ?? undefined,
                    transcriptSegments: resolvedInput.transcriptSegments,
                    transcriptMetricContext:
                        resolvedInput.transcriptMetricContext,
                    hasImage: isImageItem(item),
                    outputJson: cell.outputJson,
                    label,
                    reference: referenceByItemId.get(item.id),
                    fieldConfigs,
                    judge,
                    judgePrompt,
                    runJudgeTransport: run.configSnapshot.judgeTransport,
                    apiKeys,
                    maxTokens,
                    transcriptVariant: transcriptVariantForConfig(sttConfig),
                    transcriptJudge,
                });
            } catch (scoreErr) {
                console.error(
                    `scoring failed for cell ${cell.id}:`,
                    redactedErrorDetail(scoreErr),
                );
                await markCellFailed(
                    cell.id,
                    `scoring failed: ${errorMessage(scoreErr)}`,
                );
            }
        });
    } catch (scorePhaseErr) {
        console.error(
            `scoring phase error for run ${runId}:`,
            redactedErrorDetail(scorePhaseErr),
        );
    }

    const final = await getRunCells(runId);
    const stillBusy = final.some(
        (c) => c.status === "running" || c.status === "pending",
    );
    if (!stillBusy && final.length > 0) {
        const done = final.filter(
            (c) => c.status === "succeeded" || c.status === "cached",
        ).length;
        const failed = final.filter((c) => c.status === "failed").length;
        const status =
            failed === 0 ? "completed" : done > 0 ? "partial" : "failed";
        await db.update(runs).set({ status }).where(eq(runs.id, runId));
    }
}

async function markCellFailed(cellId: string, error: string): Promise<void> {
    try {
        await db
            .update(runCells)
            // Provider errors can echo request headers or keys; persist the
            // redacted text since cell errors are shown in the UI.
            .set({ status: "failed", error: redactSecrets(error) })
            .where(eq(runCells.id, cellId));
    } catch (markError) {
        console.error(
            `failed to mark cell ${cellId} as failed:`,
            redactedErrorDetail(markError),
        );
    }
}

function memoizedPromise<K, V>(
    cache: Map<K, Promise<V>>,
    key: K,
    load: () => Promise<V>,
): Promise<V> {
    const cached = cache.get(key);
    if (cached) return cached;
    const pending = load().catch((error) => {
        cache.delete(key);
        throw error;
    });
    cache.set(key, pending);
    return pending;
}

export function sttConfigForRunModel(
    snapshot: Pick<RunConfigSnapshot, "sttConfig" | "sttVariants">,
    syntheticModelId: string,
): ISttRunConfig | undefined {
    const parsed = parseSttMetricsModelId(syntheticModelId);
    if (parsed?.variantKey) {
        return snapshot.sttVariants?.[parsed.variantKey]?.config;
    }
    return snapshot.sttConfig;
}

function variantAwareCacheKey(
    runModel: typeof runModels.$inferSelect,
    itemId: string,
): string {
    return isSttMetricsModelId(runModel.modelId)
        ? `${runModel.id}:${itemId}`
        : itemId;
}

async function generateCellOutput({
    cell,
    runModel,
    item,
    sttConfig,
    maxTokens,
    apiKeys,
    transport,
    promptContent,
    resolvedInputFor,
    responseSchemaForRunModel,
}: {
    cell: typeof runCells.$inferSelect;
    runModel: typeof runModels.$inferSelect;
    item: typeof datasetItems.$inferSelect;
    sttConfig: ISttRunConfig | undefined;
    maxTokens: number;
    apiKeys: ApiKeys;
    transport?: ProviderTransport;
    promptContent: (promptVersionId: string) => Promise<string>;
    resolvedInputFor: (
        item: typeof datasetItems.$inferSelect,
        runModel: typeof runModels.$inferSelect,
    ) => Promise<IResolvedItemInput>;
    responseSchemaForRunModel: (
        runModel: typeof runModels.$inferSelect,
    ) => Promise<{ name: string; schema: Record<string, unknown> } | undefined>;
}): Promise<void> {
    const resolvedInput = await resolvedInputFor(item, runModel);
    const contentFingerprint = contentFingerprintForItem(
        resolvedInput.text,
        audioFingerprintStorageKey(item, sttConfig),
    );
    if (isSttMetricsModelId(runModel.modelId)) {
        await markSttMetricsCellSucceeded({
            cellId: cell.id,
            resolvedInput,
            maxTokens,
            contentFingerprint,
        });
        return;
    }

    if (!runModel.promptVersionId) {
        throw new Error("Run model is missing a prompt version.");
    }

    const cached = await findCachedCell(
        item.id,
        runModel.modelId,
        runModel.promptVersionId,
        maxTokens,
        contentFingerprint,
        runModel.promptSnapshot?.schemaHash,
        transport,
    );

    if (cached) {
        await markCellCached({
            cellId: cell.id,
            cached,
            maxTokens,
            contentFingerprint,
            schemaHash: runModel.promptSnapshot?.schemaHash,
        });
        return;
    }

    const content = await promptContent(runModel.promptVersionId);
    const prompt = inputPrompt(content, resolvedInput.text);
    const images = isImageItem(item)
        ? [await loadImage(item.storageKey, item.mimeType)]
        : [];
    const resolvedResponseSchema = await responseSchemaForRunModel(runModel);
    const pricing = await resolvePricingFor(runModel.modelId, apiKeys);
    const exec = await executeCell(
        runModel.modelId,
        {
            prompt,
            images,
            responseSchema: resolvedResponseSchema,
            maxTokens,
            reasoningEffort: runModel.reasoningConfig
                ? resolveReasoningEffort(
                      runModel.modelId,
                      runModel.reasoningConfig.effort,
                  )
                : undefined,
        },
        apiKeys,
        pricing,
        transport,
    );
    const obj = isRecord(exec.parsed) ? exec.parsed : undefined;
    const schemaResult =
        resolvedResponseSchema && obj
            ? validateDataAgainstSchema(resolvedResponseSchema.schema, obj)
            : { ok: true as const };
    const schemaViolation =
        exec.schemaViolation ||
        !schemaResult.ok ||
        Boolean(resolvedResponseSchema && !obj);
    const structuredFailureReason = structuredOutputFailureReason({
        expectsStructuredOutput: Boolean(resolvedResponseSchema),
        parsedObject: obj,
        schemaViolation,
        outputText: exec.outputText,
        schemaError: schemaResult.ok
            ? undefined
            : schemaResult.errors[0]?.message,
    });

    await db
        .update(runCells)
        .set({
            status: structuredFailureReason ? "failed" : "succeeded",
            outputJson: obj ?? { text: exec.outputText },
            latencyMs: exec.latencyMs,
            costUsd: exec.costUsd,
            costSource: exec.costSource,
            promptTokens: exec.usage.promptTokens,
            completionTokens: exec.usage.completionTokens,
            providerMetadata: exec.providerMetadata,
            schemaViolation,
            maxTokens,
            contentFingerprint,
            schemaHash: runModel.promptSnapshot?.schemaHash,
            error: structuredFailureReason ?? null,
        })
        .where(eq(runCells.id, cell.id));
}

async function markSttMetricsCellSucceeded({
    cellId,
    resolvedInput,
    maxTokens,
    contentFingerprint,
}: {
    cellId: string;
    resolvedInput: IResolvedItemInput;
    maxTokens: number;
    contentFingerprint: string;
}): Promise<void> {
    const transcript =
        transcriptCandidateText(resolvedInput.text ?? undefined) ?? "";
    await db
        .update(runCells)
        .set({
            status: "succeeded",
            outputJson: {
                transcript,
                segments: resolvedInput.transcriptSegments,
                sttModelId: resolvedInput.transcriptMetricContext?.sttModelId,
            },
            latencyMs:
                resolvedInput.transcriptMetricContext?.latencyMsTotal ?? null,
            costUsd: resolvedInput.transcriptMetricContext?.costUsd ?? null,
            costSource:
                resolvedInput.transcriptMetricContext?.costSource ?? null,
            promptTokens:
                resolvedInput.transcriptProviderMetadata?.usage?.inputTokens ??
                null,
            completionTokens:
                resolvedInput.transcriptProviderMetadata?.usage?.outputTokens ??
                null,
            providerMetadata: null,
            schemaViolation: false,
            maxTokens,
            contentFingerprint,
            schemaHash: null,
            error: null,
        })
        .where(eq(runCells.id, cellId));
}

async function markCellCached({
    cellId,
    cached,
    maxTokens,
    contentFingerprint,
    schemaHash,
}: {
    cellId: string;
    cached: NonNullable<Awaited<ReturnType<typeof findCachedCell>>>;
    maxTokens: number;
    contentFingerprint: string;
    schemaHash: string | undefined;
}): Promise<void> {
    await db
        .update(runCells)
        .set({
            status: "cached",
            outputJson: cached.outputJson,
            latencyMs: cached.latencyMs,
            costUsd: cached.costUsd,
            costSource: cached.costSource,
            promptTokens: cached.promptTokens,
            completionTokens: cached.completionTokens,
            providerMetadata: cached.providerMetadata,
            schemaViolation: false,
            maxTokens,
            contentFingerprint,
            schemaHash,
            error: null,
        })
        .where(eq(runCells.id, cellId));
}

function inputPrompt(content: string, inputText: string | null): string {
    return inputText
        ? `${content}\n\n<input>\n${inputText}\n</input>`
        : content;
}

export function fieldConfigsForRunScoring(input: {
    snapshotFieldConfigs?: IPipelineFieldConfig[];
    pipelineFieldConfigs?: IPipelineFieldConfig[];
    datasetSchema?: {
        jsonSchema: JsonSchemaObject;
        fieldRules: FieldRule[];
    };
}): IPipelineFieldConfig[] {
    if (input.snapshotFieldConfigs !== undefined) {
        return input.snapshotFieldConfigs;
    }
    if (input.pipelineFieldConfigs !== undefined) {
        return input.pipelineFieldConfigs;
    }
    if (input.datasetSchema) {
        return fieldConfigsFromSchema(
            input.datasetSchema.jsonSchema,
            input.datasetSchema.fieldRules,
        );
    }
    return [];
}

/**
 * Score rationale for a legacy judge result. A failed judge's error is
 * provider text and the rationale is shown in the UI, so it is redacted.
 */
export function legacyJudgeRationale(outcome: JudgeOutcome): string {
    return outcome.ok
        ? outcome.rationale
        : `judge error: ${redactSecrets(outcome.error)}`;
}

export function structuredOutputFailureReason({
    expectsStructuredOutput,
    parsedObject,
    schemaViolation,
    outputText,
    schemaError,
}: {
    expectsStructuredOutput: boolean;
    parsedObject: Record<string, unknown> | undefined;
    schemaViolation: boolean;
    outputText: string;
    schemaError?: string;
}): string | undefined {
    if (!expectsStructuredOutput || !schemaViolation) return undefined;
    if (!parsedObject) {
        return outputText.trim()
            ? "Model did not return a structured JSON object."
            : "Model returned empty structured output.";
    }
    return schemaError ?? "Output did not match schema.";
}

export function judgePromptVersionForRun(run: {
    judgeConfigId?: string | null;
    judgePromptVersionId?: string | null;
}): string | undefined {
    if (run.judgeConfigId) return undefined;
    return run.judgePromptVersionId ?? undefined;
}

export async function loadJudgePromptForRun(run: {
    judgeConfigId?: string | null;
    judgePromptVersionId?: string | null;
}): Promise<IJudgePromptOption | undefined> {
    const judgePromptVersionId = judgePromptVersionForRun(run);
    if (!judgePromptVersionId) return undefined;
    try {
        return await getJudgePromptVersion(judgePromptVersionId);
    } catch (err) {
        console.error(
            `failed to load judge prompt version ${judgePromptVersionId}:`,
            redactedErrorDetail(err),
        );
        return undefined;
    }
}

interface IResolvedItemInput {
    transcriptProviderMetadata?: IAudioTranscriptMetadata;
    text: string | null;
    transcriptSegments: ITranscriptSegment[];
    transcriptMetricContext?: {
        sttModelId: string;
        providerId: string;
        routeId: string;
        configHash: string;
        latencyMsTotal?: number;
        costUsd?: number;
        costSource?: "computed" | "unavailable";
    };
}

async function inputTextForItem({
    item,
    sttConfig,
    openaiApiKey,
    aiGatewayApiKey,
    sonioxApiKey,
    geminiApiKey,
    openrouterApiKey,
    apiKeys,
}: {
    item: typeof datasetItems.$inferSelect;
    sttConfig?: ISttRunConfig;
    openaiApiKey?: string;
    aiGatewayApiKey?: string;
    sonioxApiKey?: string;
    geminiApiKey?: string;
    openrouterApiKey?: string;
    apiKeys: ApiKeys;
}): Promise<IResolvedItemInput> {
    if (!isAudioItem(item)) {
        return { text: item.inputText, transcriptSegments: [] };
    }
    if (!item.storageKey || !item.mimeType) {
        throw new Error("Audio item is missing stored audio bytes.");
    }
    if (!sttConfig?.modelId) {
        throw new Error("Audio datasets require an STT model.");
    }
    const { artifact } = await getOrCreateAudioTranscriptArtifactWithProvenance(
        {
            datasetItemId: item.id,
            storageKey: item.storageKey,
            mimeType: item.mimeType,
            modelId: sttConfig.modelId,
            language: sttConfig.language,
            config: sttConfig.config,
            openaiApiKey,
            aiGatewayApiKey,
            sonioxApiKey,
            geminiApiKey,
            openrouterApiKey,
        },
    );
    const selectedTranscript = await selectedTranscriptForRun({
        item,
        rawTranscript: artifact.text,
        sttConfig,
        apiKeys,
    });
    return {
        text: item.inputText
            ? `${item.inputText}\n\nTranscript:\n${selectedTranscript}`
            : selectedTranscript,
        transcriptProviderMetadata: artifact.providerMetadata,
        transcriptSegments: artifact.segments,
        transcriptMetricContext: {
            sttModelId: sttConfig.modelId,
            providerId: artifact.providerMetadata?.provider ?? "unknown",
            routeId: artifact.providerMetadata?.route ?? "unknown",
            configHash: artifact.providerMetadata?.configHash ?? "",
            latencyMsTotal: artifact.providerMetadata?.latencyMsTotal,
            costUsd: artifact.providerMetadata?.costUsd,
            costSource: artifact.providerMetadata?.costSource,
        },
    };
}

async function selectedTranscriptForRun(input: {
    item: typeof datasetItems.$inferSelect;
    rawTranscript: string;
    sttConfig: ISttRunConfig;
    apiKeys: ApiKeys;
}): Promise<string> {
    const transliteration = input.sttConfig.transliteration;
    if (
        input.sttConfig.transcriptVariant !== "latin" ||
        !transliteration?.enabled
    ) {
        return input.rawTranscript;
    }
    if (!input.item.storageKey) {
        throw new Error("Audio item is missing stored audio bytes.");
    }
    return getOrCreateTransliteration({
        datasetItemId: input.item.id,
        storageKey: input.item.storageKey,
        sourceTranscript: input.rawTranscript,
        config: transliteration,
        apiKeys: input.apiKeys,
    });
}

function isAudioItem(item: typeof datasetItems.$inferSelect): boolean {
    return (
        item.type === "audio" || item.mimeType?.startsWith("audio/") === true
    );
}

function isImageItem(
    item: typeof datasetItems.$inferSelect,
): item is typeof datasetItems.$inferSelect & {
    storageKey: string;
    mimeType: string;
} {
    return Boolean(item.storageKey && item.mimeType && !isAudioItem(item));
}

export function audioFingerprintStorageKey(
    item: typeof datasetItems.$inferSelect,
    sttConfig: ISttRunConfig | undefined,
): string | null | undefined {
    if (!isAudioItem(item)) return item.storageKey;
    // JSON.stringify of the structured array avoids ambiguous join(":")
    // collisions when a field value itself contains ":".
    return JSON.stringify([
        item.storageKey ?? "",
        sttConfig?.providerId ?? "",
        sttConfig?.routeId ?? "",
        sttConfig?.canonicalModelId ?? "",
        sttConfig?.modelId ?? "",
        sttConfig?.language ?? "",
        stableConfigString(sttConfig?.config),
        sttConfig?.transcriptVariant ?? "raw",
        stableConfigString(sttConfig?.transliteration),
    ]);
}

export function stableConfigString(config: unknown): string {
    if (!isRecord(config)) return "";
    return canonicalJsonString(config);
}

interface ScoreArgs {
    cellId: string;
    inputText?: string;
    transcriptSegments?: ITranscriptSegment[];
    transcriptMetricContext?: {
        sttModelId: string;
        providerId: string;
        routeId: string;
        configHash: string;
        latencyMsTotal?: number;
        costUsd?: number;
        costSource?: "computed" | "unavailable";
    };
    hasImage: boolean;
    outputJson: OutputJson | null;
    label: LabelJson | undefined;
    reference: unknown;
    fieldConfigs: IPipelineFieldConfig[];
    judge?: typeof judgeConfigs.$inferSelect;
    judgePrompt?: IJudgePromptOption;
    runJudgeTransport?: ProviderTransport;
    apiKeys: ApiKeys;
    maxTokens: number;
    transcriptVariant?: "raw" | "latin";
    transcriptJudge: ITranscriptEvaluatorResult | undefined;
}

async function scoreCell(args: ScoreArgs): Promise<void> {
    const transcriptMetric = scoreTranscriptMetrics({
        candidateText: transcriptCandidateText(args.inputText),
        candidateSegments: args.transcriptSegments,
        label: args.label,
        variant: args.transcriptVariant,
        sttModelId: args.transcriptMetricContext?.sttModelId,
        providerId: args.transcriptMetricContext?.providerId,
        routeId: args.transcriptMetricContext?.routeId,
        configHash: args.transcriptMetricContext?.configHash,
        latencyMsTotal: args.transcriptMetricContext?.latencyMsTotal,
        costUsd: args.transcriptMetricContext?.costUsd,
        costSource: args.transcriptMetricContext?.costSource,
    });
    const result = await scoreOutput({
        output: args.outputJson,
        label: args.label,
        fieldConfigs: args.fieldConfigs,
        inputText: args.inputText,
        hasImage: args.hasImage,
        reference: args.reference,
        apiKeys: args.apiKeys,
        maxTokens: args.maxTokens,
        judgePrompt: args.judgePrompt
            ? {
                  modelId: args.judgePrompt.modelId,
                  transport: args.judgePrompt.transport,
                  rubricPrompt: args.judgePrompt.rubricPrompt,
                  declaredInputs: args.judgePrompt.declaredInputs,
                  reasoningEffort: args.judgePrompt.reasoningConfig
                      ? resolveReasoningEffort(
                            args.judgePrompt.modelId,
                            args.judgePrompt.reasoningConfig.effort,
                        )
                      : undefined,
              }
            : undefined,
    });

    let legacyJudge: Awaited<ReturnType<typeof runJudge>> | undefined;
    if (!result.judge && args.judge) {
        legacyJudge = await runJudge({
            judgeModelId: getBareModelName(args.judge.modelId),
            rubricPrompt: args.judge.rubricPrompt,
            apiKeys: args.apiKeys,
            inputText: args.inputText,
            hasImage: args.hasImage,
            output: args.outputJson,
            label: args.label,
            reference: args.reference,
            maxTokens: args.maxTokens,
            reasoningEffort: resolveReasoningEffort(
                args.judge.modelId,
                args.judge.reasoningConfig?.effort,
            ),
            transport: args.judgePrompt?.transport ?? args.runJudgeTransport,
        });
    }

    await db.transaction(async (tx) => {
        await tx
            .delete(cellScores)
            .where(eq(cellScores.runCellId, args.cellId));

        if (result.fieldDiff) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "field_diff",
                score: result.fieldDiff.score,
                detailsJson: result.fieldDiff.details,
                rationale: null,
            });
        }

        if (result.judge) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "judge",
                score: result.judge.score,
                detailsJson: result.judge.details ?? null,
                rationale: result.judge.rationale ?? null,
            });
        } else if (legacyJudge) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "judge",
                score: legacyJudge.ok ? legacyJudge.score : null,
                detailsJson:
                    legacyJudge.ok && legacyJudge.criteria.length > 0
                        ? { criteria: legacyJudge.criteria }
                        : null,
                rationale: legacyJudgeRationale(legacyJudge),
            });
        }

        if (transcriptMetric) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "transcript_metric",
                score: transcriptMetric.score,
                detailsJson: transcriptMetric.details,
                rationale: null,
            });
        }

        if (args.transcriptJudge) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "transcript_judge",
                score: args.transcriptJudge.score,
                detailsJson: args.transcriptJudge.details,
                rationale: args.transcriptJudge.rationale,
            });
        }
    });
}

function transcriptCandidateText(
    inputText: string | undefined,
): string | undefined {
    if (!inputText) return undefined;
    const marker = "\n\nTranscript:\n";
    const markerIndex = inputText.indexOf(marker);
    return markerIndex >= 0
        ? inputText.slice(markerIndex + marker.length)
        : inputText;
}

function transcriptVariantForConfig(
    sttConfig:
        | {
              transcriptVariant?: "raw" | "latin";
              transliteration?: { enabled: boolean };
          }
        | undefined,
): "raw" | "latin" {
    return sttConfig?.transcriptVariant === "latin" &&
        sttConfig.transliteration?.enabled
        ? "latin"
        : "raw";
}

function transcriptEvaluatorForConfig(
    sttConfig:
        | {
              evaluator?: {
                  enabled: boolean;
                  modelId: string;
                  rubricPrompt: string;
                  reasoningEffort?:
                      "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
              };
          }
        | undefined,
) {
    return sttConfig?.evaluator;
}
