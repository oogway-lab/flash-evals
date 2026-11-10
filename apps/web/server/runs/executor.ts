import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import {
    evalTransportFor,
    getBareModelName,
    type ApiKeys,
} from "@flash-evals/llm-core";
import { redactSecrets } from "@flash-evals/secrets";
import {
    benchmarkUsesSource,
    isSelfScoredTask,
    canonicalJsonString,
    isSttMetricsModelId,
    parseSttMetricsModelId,
    taskMapNeedsJudge,
    type IBenchmarkCellDetails,
    type IRunBenchmarkConfig,
    type ISttRunConfig,
    type ProviderTransport,
    type IRunDataPolicy,
} from "@flash-evals/api-contract";
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
    getBenchmarkDetailsToRetry,
    findCachedCell,
    claimRunCells,
    contentFingerprintForItem,
    getScoresForCells,
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
import type { ISttProviderCallKeys } from "../audio/transcription/types";
import {
    getOrCreateTransliteration,
    type ITransliterationResult,
    transliterationFailureCostUsd,
} from "../audio/transliteration";
import { sttCellCostWithTransliteration } from "../audio/transliterationCost";
import { scoreTranscriptMetrics } from "../audio/metrics";
import {
    runTranscriptEvaluator,
    type ITranscriptEvaluatorResult,
} from "../audio/customEvaluators";
import { executeCell } from "../jobs/runOrchestrator";
import { resolveApiKeys } from "../secrets/resolveApiKeys";
import { resolveReasoningEffort } from "../llm/reasoningConfig";
import { unsentThinkingOutcome, withThinkingOutcome } from "./cellThinking";
import { resolvePricingFor, type ModelPricing } from "../llm/pricing";
import { ensureModelCatalog } from "../llm/catalog";
import { scoreOutput } from "../scoring/scoreOutput";
import { scoreAgainstBenchmark } from "../scoring/benchmark";
import {
    cellsToScore,
    paidScoresToKeep,
    paidVerdictsStillApply,
    priorBenchmarkToKeep,
} from "./scoringSelection";
import { judgePricing, recordJudgeCost, totalJudgeCostUsd } from "./judgeCost";
import { runJudge, type JudgeOutcome } from "../scoring/judge";
import {
    getJudgePromptVersion,
    type IJudgePromptOption,
} from "../judges/service";
import { isRecord } from "../lib/objects";
import { errorMessage } from "../lib/errors";
import { forEachPool, positiveIntegerSetting } from "../lib/concurrency";
import { finishStoppedRun, releaseUnstartedCell } from "./runStop";
import { logWorkerEvent, safeWorkerError } from "../jobs/workerObservability";
import { evalRunStopGuard } from "../setupComparisons/spend";
import { runModelRoutes } from "./runModelRoutes";

const DEFAULT_EVAL_CONCURRENCY = 5;

/** Cells worked on at once in one run; read per run so it follows config. */
export function evalConcurrency(value = process.env.EVAL_CONCURRENCY): number {
    return positiveIntegerSetting(value, DEFAULT_EVAL_CONCURRENCY);
}

export interface IExecuteRunOptions {
    /**
     * True once this pass's run lease was taken over by another pass. The
     * pass then starts no more cells and leaves the run to the new owner.
     */
    leaseLost?: () => boolean;
}

export async function executeRun(
    runId: string,
    options: IExecuteRunOptions = {},
): Promise<void> {
    const leaseLost = () => options.leaseLost?.() === true;
    await ensureModelCatalog();
    const run = await getRun(runId);
    if (!run) throw new Error(`run ${runId} not found`);
    if (!isExecutableRunStatus(run.status)) {
        // A duplicate or late job for a run that already finished: running
        // it again would flip it back to running and re-claim failed cells.
        logWorkerEvent("warn", "run.skipped_not_runnable", { runId });
        return;
    }
    // Cancel requests are checked before each cell starts; calls already
    // sent finish, cells not started stay pending ("not run").
    const stop = evalRunStopGuard(run);
    const stoppedEarly = await stop.check();
    if (stoppedEarly) {
        await finishStoppedRun(runId, stoppedEarly);
        return;
    }
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
    const routes = runModelRoutes(run.configSnapshot.models);
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
    // What resolving an input paid before it failed (chunks transcribed, a
    // billed empty reply), keyed by the error its cells see; charged once.
    const failedInputCost = new WeakMap<object, { usd: number }>();
    const takeFailedInputCost = (error: unknown): number => {
        if (!error || typeof error !== "object") return 0;
        const paid = failedInputCost.get(error);
        failedInputCost.delete(error);
        return paid?.usd ?? 0;
    };
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
            const paid = { usd: 0 };
            cached = inputTextForItem({
                item,
                sttConfig,
                sttKeys: {
                    openaiApiKey: sttProviderKeys.openai ?? apiKeys.openai,
                    aiGatewayApiKey:
                        sttProviderKeys.vercelGateway ?? apiKeys.gateway,
                    sonioxApiKey: sttProviderKeys.soniox,
                    elevenlabsApiKey: sttProviderKeys.elevenlabs,
                    geminiApiKey: sttProviderKeys.gemini,
                    openrouterApiKey: sttProviderKeys.openrouter,
                },
                apiKeys,
                dataPolicy: run.configSnapshot.dataPolicy,
                onCostIncurred: async (costUsd) => {
                    if (costUsd !== undefined && costUsd > 0)
                        paid.usd += costUsd;
                },
            }).catch((error: unknown) => {
                if (error && typeof error === "object")
                    failedInputCost.set(error, paid);
                throw error;
            });
            inputCache.set(cacheKey, cached);
        }
        return cached;
    };
    // An item's input is resolved (transcribed) once per pass and shared by
    // its cells; what that cost is charged to the first cell that uses it.
    const chargedInputs = new Set<string>();
    const inputCostToCharge = (
        item: typeof datasetItems.$inferSelect,
        runModel: typeof runModels.$inferSelect,
        resolvedInput: IResolvedItemInput,
    ): number => {
        const cacheKey = variantAwareCacheKey(runModel, item.id);
        if (chargedInputs.has(cacheKey)) return 0;
        chargedInputs.add(cacheKey);
        return resolvedInput.incurredCostUsd ?? 0;
    };

    await db
        .update(runs)
        .set({ status: "running", error: null })
        .where(eq(runs.id, runId));

    // Atomic claim: flips pending/failed cells to 'running' and returns only the
    // rows this call won, so a concurrent retry can't double-execute or double-bill.
    const claimed = await claimRunCells(runId);

    // Phase 1: generation — every cell calls the model (or reuses a cache hit).
    try {
        await forEachPool(claimed, evalConcurrency(), async (cell) => {
            if (leaseLost() || (await stop.check())) {
                await releaseUnstartedCell(cell.id);
                return;
            }
            const rm = modelById.get(cell.runModelId);
            const item = itemById.get(cell.datasetItemId);
            if (!rm || !item) {
                await db
                    .update(runCells)
                    .set({ status: "failed", error: "missing model or item" })
                    .where(eq(runCells.id, cell.id));
                return;
            }

            stop.started();
            let paidUsd = 0;
            try {
                const sttConfig = sttConfigForRunModel(
                    run.configSnapshot,
                    rm.modelId,
                );
                paidUsd = await generateCellOutput({
                    cell,
                    runModel: rm,
                    item,
                    sttConfig,
                    maxTokens,
                    apiKeys,
                    dataPolicy: run.configSnapshot.dataPolicy,
                    transport: routes.transport.get(rm.modelId),
                    transportModelId: routes.transportModelId.get(rm.modelId),
                    promptContent,
                    resolvedInputFor,
                    inputCostToCharge,
                    takeFailedInputCost,
                    responseSchemaForRunModel,
                });
                if (leaseLost()) await markLateAnswerUnscored(runId, cell.id);
            } catch (err) {
                logWorkerEvent("error", "run_cell.failed", {
                    runId,
                    cellId: cell.id,
                    phase: "generation",
                    ...safeWorkerError(err),
                });
                await markCellFailed(runId, cell.id, errorMessage(err));
            } finally {
                stop.finished(paidUsd);
            }
        });
    } catch (genErr) {
        // Log but continue to scoring + final status so we don't leave the run in limbo
        logWorkerEvent("error", "run.phase_failed", {
            runId,
            phase: "generation",
            ...safeWorkerError(genErr),
        });
    }

    // Phase 2: scoring — runs after all generations so the judge sees reference outputs.
    const generatedCells = await getRunCells(runId);
    // A cell whose judge failed on a task counts as not scored yet.
    const benchmarkToRetry = await getBenchmarkDetailsToRetry(runId);
    // An answer whose scoring crashed is scored again; its answer is kept.
    const scoringFailedIds = new Set(
        generatedCells.filter(scoringFailed).map((cell) => cell.id),
    );
    const scoredCellIds = new Set(
        [...(await getScoredRunCellIds(runId))].filter(
            (id) => !benchmarkToRetry.has(id) && !scoringFailedIds.has(id),
        ),
    );
    const scoringSelection = {
        claimed,
        referenceModelId: referenceModel?.id,
        benchmark: run.configSnapshot.benchmark,
    };
    const toScore = cellsToScore({
        cells: generatedCells,
        scoredCellIds,
        ...scoringSelection,
    });
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
    // A transcript judge call is shared by the cells of its transcript; its
    // cost is charged to the first of them.
    const chargedTranscriptJudges = new Set<string>();

    try {
        await forEachPool(toScore, evalConcurrency(), async (cell) => {
            // A stopped run leaves unscored cells for a later resume.
            if (leaseLost() || (await stop.check())) return;
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
                const previousBenchmark = priorBenchmarkToKeep(cell, {
                    ...scoringSelection,
                    toRetry: benchmarkToRetry,
                });
                // Scored again with the same answer (a failed benchmark task,
                // a scoring crash): judges that already gave a verdict are
                // not paid again.
                const kept = paidVerdictsStillApply(cell, scoringSelection)
                    ? paidScoresToKeep(await getScoresForCells([cell.id]))
                    : {};
                const transcriptEvaluator =
                    transcriptEvaluatorForConfig(sttConfig);
                const transcriptJudgeKey = variantAwareCacheKey(rm, item.id);
                const transcriptJudge = kept.transcriptJudge
                    ? keptTranscriptJudge(kept.transcriptJudge)
                    : await memoizedPromise(
                          transcriptJudgeCache,
                          transcriptJudgeKey,
                          () =>
                              runTranscriptEvaluator({
                                  config: transcriptEvaluator
                                      ? {
                                            ...transcriptEvaluator,
                                            reasoningEffort:
                                                resolveReasoningEffort(
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
                                  dataPolicy: run.configSnapshot.dataPolicy,
                              }),
                      );
                if (
                    !kept.transcriptJudge &&
                    !chargedTranscriptJudges.has(transcriptJudgeKey)
                ) {
                    chargedTranscriptJudges.add(transcriptJudgeKey);
                    await recordJudgeCost(
                        db,
                        cell.id,
                        totalJudgeCostUsd(transcriptJudge?.costUsd),
                    );
                }
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
                    benchmark: benchmarkForCell({
                        config: run.configSnapshot.benchmark,
                        isReference: rm.id === referenceModel?.id,
                        referenceOutput: referenceByItemId.get(item.id),
                        hasReferenceOutput: referenceByItemId.has(item.id),
                        label,
                    }),
                    fieldConfigs,
                    // Free-text cells are stored as `{ text }`, so key-by-key
                    // label matching only applies to schema-backed output.
                    defaultFieldMatcher:
                        !isAudioItem(item) &&
                        (await responseSchemaForRunModel(rm))
                            ? "exact"
                            : undefined,
                    judge,
                    judgePrompt,
                    runJudgeTransport: run.configSnapshot.judgeTransport,
                    dataPolicy: run.configSnapshot.dataPolicy,
                    apiKeys,
                    maxTokens,
                    transcriptVariant: transcriptVariantForConfig(sttConfig),
                    transcriptJudge,
                    previousBenchmark,
                    keptJudge: kept.judge,
                });
            } catch (scoreErr) {
                logWorkerEvent("error", "run_cell.failed", {
                    runId,
                    cellId: cell.id,
                    phase: "scoring",
                    ...safeWorkerError(scoreErr),
                });
                await addIncurredCost(cell.id, takeFailedInputCost(scoreErr));
                // The answer stands (Retry must not pay for it again); the
                // cell keeps its status and is scored again on the next pass.
                await markCellScoringFailed(
                    runId,
                    cell.id,
                    `scoring failed: ${errorMessage(scoreErr)}`,
                );
            }
        });
    } catch (scorePhaseErr) {
        logWorkerEvent("error", "run.phase_failed", {
            runId,
            phase: "scoring",
            ...safeWorkerError(scorePhaseErr),
        });
    }

    if (leaseLost()) {
        // The pass that took the run over finishes it.
        logWorkerEvent("warn", "run.lease_lost", { runId });
        return;
    }
    if (stop.reason) {
        logWorkerEvent("warn", "run.stopped", { runId, phase: stop.reason });
        await finishStoppedRun(runId, stop.reason);
        return;
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
        const unscored = final.filter(scoringFailed).length;
        const status =
            failed === 0 && unscored === 0
                ? "completed"
                : done > 0
                  ? "partial"
                  : "failed";
        await db.update(runs).set({ status }).where(eq(runs.id, runId));
    }
}

/** Only a queued or interrupted run is executed; Retry sets it pending first. */
export function isExecutableRunStatus(status: string): boolean {
    return status === "pending" || status === "running";
}

/** An answer that stands but whose scoring crashed (see markCellScoringFailed). */
function scoringFailed(cell: {
    status: string;
    error: string | null;
}): boolean {
    return (
        (cell.status === "succeeded" || cell.status === "cached") &&
        Boolean(cell.error)
    );
}

/**
 * Records why scoring crashed without failing the cell: its answer stands,
 * and the next pass (Retry) scores it again instead of generating it again.
 */
async function markCellScoringFailed(
    runId: string,
    cellId: string,
    error: string,
): Promise<void> {
    try {
        await db
            .update(runCells)
            .set({ error: redactSecrets(error) })
            .where(eq(runCells.id, cellId));
    } catch (markError) {
        logWorkerEvent("error", "run_cell.failure_persist_failed", {
            runId,
            cellId,
            ...safeWorkerError(markError),
        });
    }
}

/**
 * An answer written after another pass took the run over can be missed by
 * that pass: it may have scored the cell already (an earlier answer) or
 * finished the run. The answer is kept but marked not scored, its scores (if
 * any) are dropped, and a finished run becomes partial, so the new pass, if
 * still going, or a Retry scores it.
 */
async function markLateAnswerUnscored(
    runId: string,
    cellId: string,
): Promise<void> {
    logWorkerEvent("warn", "run_cell.written_after_lease_lost", {
        runId,
        cellId,
    });
    try {
        await db.transaction(async (tx) => {
            await tx.delete(cellScores).where(eq(cellScores.runCellId, cellId));
            await tx
                .update(runCells)
                .set({
                    error: "scoring failed: answered after another worker took over the run; Retry scores it",
                })
                .where(
                    and(
                        eq(runCells.id, cellId),
                        inArray(runCells.status, ["succeeded", "cached"]),
                    ),
                );
            await tx
                .update(runs)
                .set({ status: "partial" })
                .where(
                    and(
                        eq(runs.id, runId),
                        inArray(runs.status, ["completed", "failed"]),
                    ),
                );
        });
    } catch (markError) {
        logWorkerEvent("error", "run_cell.failure_persist_failed", {
            runId,
            cellId,
            ...safeWorkerError(markError),
        });
    }
}

async function markCellFailed(
    runId: string,
    cellId: string,
    error: string,
): Promise<void> {
    try {
        await db
            .update(runCells)
            // Provider errors can echo request headers or keys; persist the
            // redacted text since cell errors are shown in the UI.
            .set({ status: "failed", error: redactSecrets(error) })
            .where(eq(runCells.id, cellId));
    } catch (markError) {
        logWorkerEvent("error", "run_cell.failure_persist_failed", {
            runId,
            cellId,
            ...safeWorkerError(markError),
        });
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
    dataPolicy,
    transport,
    transportModelId,
    promptContent,
    resolvedInputFor,
    inputCostToCharge,
    takeFailedInputCost,
    responseSchemaForRunModel,
}: {
    cell: typeof runCells.$inferSelect;
    runModel: typeof runModels.$inferSelect;
    item: typeof datasetItems.$inferSelect;
    sttConfig: ISttRunConfig | undefined;
    maxTokens: number;
    apiKeys: ApiKeys;
    /** The run's data rules; saved answers are reused only under the same. */
    dataPolicy?: IRunDataPolicy;
    transport?: ProviderTransport;
    /** The id sent to the provider when it isn't the registry's. */
    transportModelId?: string;
    promptContent: (promptVersionId: string) => Promise<string>;
    resolvedInputFor: (
        item: typeof datasetItems.$inferSelect,
        runModel: typeof runModels.$inferSelect,
    ) => Promise<IResolvedItemInput>;
    inputCostToCharge: (
        item: typeof datasetItems.$inferSelect,
        runModel: typeof runModels.$inferSelect,
        resolvedInput: IResolvedItemInput,
    ) => number;
    /** What a failed input resolution paid, once per failure. */
    takeFailedInputCost: (error: unknown) => number;
    responseSchemaForRunModel: (
        runModel: typeof runModels.$inferSelect,
    ) => Promise<{ name: string; schema: Record<string, unknown> } | undefined>;
}): Promise<number> {
    let resolvedInput: IResolvedItemInput;
    try {
        resolvedInput = await resolvedInputFor(item, runModel);
    } catch (error) {
        // Transcription paid before it failed is still spend.
        await addIncurredCost(cell.id, takeFailedInputCost(error));
        throw error;
    }
    const inputCostUsd = inputCostToCharge(item, runModel, resolvedInput);
    try {
        return await generateFromInput({
            cell,
            runModel,
            item,
            sttConfig,
            maxTokens,
            apiKeys,
            dataPolicy,
            transport,
            transportModelId,
            promptContent,
            responseSchemaForRunModel,
            resolvedInput,
            inputCostUsd,
        });
    } catch (error) {
        // The input's cost was paid even though the model call failed.
        await addIncurredCost(cell.id, inputCostUsd);
        throw error;
    }
}

async function generateFromInput({
    cell,
    runModel,
    item,
    sttConfig,
    maxTokens,
    apiKeys,
    dataPolicy,
    transport,
    transportModelId,
    promptContent,
    responseSchemaForRunModel,
    resolvedInput,
    inputCostUsd,
}: Omit<
    Parameters<typeof generateCellOutput>[0],
    "resolvedInputFor" | "inputCostToCharge" | "takeFailedInputCost"
> & {
    resolvedInput: IResolvedItemInput;
    /** What resolving the input cost this pass, charged to this cell. */
    inputCostUsd: number;
}): Promise<number> {
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
            incurredCostUsd: inputCostUsd,
        });
        return inputCostUsd;
    }

    if (!runModel.promptVersionId) {
        throw new Error("Run model is missing a prompt version.");
    }

    // For "auto", the provider the call goes over (as the provider limit
    // picks it, data rules included); recorded with the answer and part of
    // its reuse key.
    const resolvedTransport = transport
        ? undefined
        : evalTransportFor(
              getBareModelName(runModel.modelId),
              apiKeys,
              {},
              dataPolicy,
          );
    // Under data rules, only answers made under the same rules are reused
    // (see findCachedCell).
    const cached = await findCachedCell(
        item.id,
        runModel.modelId,
        runModel.promptVersionId,
        maxTokens,
        contentFingerprint,
        runModel.promptSnapshot?.schemaHash,
        {
            transport,
            ...(transportModelId ? { transportModelId } : {}),
            ...(resolvedTransport ? { resolvedTransport } : {}),
        },
        runModel.reasoningConfig?.effort,
        runModel.temperature ?? undefined,
        dataPolicy,
    );

    if (cached) {
        await markCellCached({
            cellId: cell.id,
            cached,
            maxTokens,
            contentFingerprint,
            schemaHash: runModel.promptSnapshot?.schemaHash,
            incurredCostUsd: inputCostUsd,
        });
        return inputCostUsd;
    }

    const content = await promptContent(runModel.promptVersionId);
    const prompt = inputPrompt(content, resolvedInput.text);
    const images = isImageItem(item)
        ? [await loadImage(item.storageKey, item.mimeType)]
        : [];
    const resolvedResponseSchema = await responseSchemaForRunModel(runModel);
    const pricing = await resolvePricingFor(
        runModel.modelId,
        apiKeys,
        transport,
    );
    const requestedEffort = runModel.reasoningConfig?.effort;
    const reasoningEffort = requestedEffort
        ? resolveReasoningEffort(runModel.modelId, requestedEffort)
        : undefined;
    const exec = await executeCell(
        runModel.modelId,
        {
            prompt,
            images,
            responseSchema: resolvedResponseSchema,
            maxTokens,
            reasoningEffort,
            ...(runModel.temperature != null
                ? { temperature: runModel.temperature }
                : {}),
            dataPolicy,
        },
        apiKeys,
        pricing,
        transport,
        transportModelId,
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
            ...addedIncurredCost(inputCostUsd + (exec.costUsd ?? 0)),
            promptTokens: exec.usage.promptTokens,
            completionTokens: exec.usage.completionTokens,
            reasoningTokens: exec.usage.reasoningTokens ?? null,
            providerMetadata: withThinkingOutcome(
                resolvedTransport
                    ? { ...exec.providerMetadata, transport: resolvedTransport }
                    : exec.providerMetadata,
                unsentThinkingOutcome(
                    runModel.modelId,
                    requestedEffort,
                    reasoningEffort,
                ),
            ),
            schemaViolation,
            maxTokens,
            contentFingerprint,
            schemaHash: runModel.promptSnapshot?.schemaHash,
            error: structuredFailureReason ?? null,
        })
        .where(eq(runCells.id, cell.id));
    return inputCostUsd + (exec.costUsd ?? 0);
}

/**
 * A cell's incurred cost plus `usd`: each pass adds what it paid (see
 * runCells.incurredCostUsd; the spend ledger records each addition).
 */
function addedIncurredCost(usd: number): { incurredCostUsd: SQL } {
    const paid = Number.isFinite(usd) && usd > 0 ? usd : 0;
    return {
        incurredCostUsd: sql`coalesce(${runCells.incurredCostUsd}, 0) + ${paid}`,
    };
}

async function addIncurredCost(cellId: string, usd: number): Promise<void> {
    if (!(usd > 0)) return;
    await db
        .update(runCells)
        .set(addedIncurredCost(usd))
        .where(eq(runCells.id, cellId));
}

/** An STT cell costs its transcript plus its transliteration, when used. */
function sttCellCost(resolvedInput: IResolvedItemInput) {
    const { costUsd, costSource } = sttCellCostWithTransliteration(
        resolvedInput.transcriptMetricContext,
        resolvedInput.transliteration,
    );
    return { costUsd: costUsd ?? null, costSource: costSource ?? null };
}

async function markSttMetricsCellSucceeded({
    cellId,
    resolvedInput,
    maxTokens,
    contentFingerprint,
    incurredCostUsd,
}: {
    cellId: string;
    resolvedInput: IResolvedItemInput;
    maxTokens: number;
    contentFingerprint: string;
    /** What the transcription cost this pass (nothing when reused). */
    incurredCostUsd: number;
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
            // The transcript's (and transliteration's) list cost, shown on
            // the cell even when reused; spend counts only what this pass paid.
            ...sttCellCost(resolvedInput),
            ...addedIncurredCost(incurredCostUsd),
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
    incurredCostUsd,
}: {
    cellId: string;
    cached: NonNullable<Awaited<ReturnType<typeof findCachedCell>>>;
    maxTokens: number;
    contentFingerprint: string;
    schemaHash: string | undefined;
    /** What resolving the input cost this pass; the answer itself was free. */
    incurredCostUsd: number;
}): Promise<void> {
    await db
        .update(runCells)
        .set({
            status: "cached",
            outputJson: cached.outputJson,
            latencyMs: cached.latencyMs,
            costUsd: cached.costUsd,
            costSource: cached.costSource,
            ...addedIncurredCost(incurredCostUsd),
            promptTokens: cached.promptTokens,
            completionTokens: cached.completionTokens,
            reasoningTokens: cached.reasoningTokens,
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
        logWorkerEvent("error", "judge_prompt.load_failed", {
            ...safeWorkerError(err),
        });
        return undefined;
    }
}

interface IResolvedItemInput {
    /** What resolving this input cost now (transcription; 0 when reused). */
    incurredCostUsd?: number;
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
    /** The Latin transliteration, when the run uses it. */
    transliteration?: ITransliterationResult;
}

async function inputTextForItem({
    item,
    sttConfig,
    sttKeys,
    apiKeys,
    dataPolicy,
    onCostIncurred,
}: {
    item: typeof datasetItems.$inferSelect;
    sttConfig?: ISttRunConfig;
    /** Provider keys for the transcription call, by provider. */
    sttKeys: ISttProviderCallKeys;
    apiKeys: ApiKeys;
    dataPolicy?: IRunDataPolicy;
    /** Transcription spend as it is paid (see ITranscribeAudioInput). */
    onCostIncurred?: (costUsd: number | undefined) => Promise<void>;
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
    const { artifact, incurredCostUsd } =
        await getOrCreateAudioTranscriptArtifactWithProvenance({
            datasetItemId: item.id,
            storageKey: item.storageKey,
            mimeType: item.mimeType,
            modelId: sttConfig.modelId,
            language: sttConfig.language,
            config: sttConfig.config,
            levelVolume: sttConfig.levelVolume === true,
            ...sttKeys,
            ...(onCostIncurred ? { onCostIncurred } : {}),
        });
    const transliteration = await transliterationForRun({
        item,
        rawTranscript: artifact.text,
        sttConfig,
        apiKeys,
        dataPolicy,
    }).catch(async (error: unknown) => {
        // A paid reply that was cut off or empty still counts.
        await onCostIncurred?.(transliterationFailureCostUsd(error));
        throw error;
    });
    const selectedTranscript = transliteration?.text ?? artifact.text;
    return {
        transliteration,
        text: item.inputText
            ? `${item.inputText}\n\nTranscript:\n${selectedTranscript}`
            : selectedTranscript,
        ...(incurredCostUsd !== undefined ||
        transliteration?.incurredCostUsd !== undefined
            ? {
                  // Transcription plus transliteration paid this pass
                  // (each 0 when reused).
                  incurredCostUsd:
                      (incurredCostUsd ?? 0) +
                      (transliteration?.incurredCostUsd ?? 0),
              }
            : {}),
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

async function transliterationForRun(input: {
    item: typeof datasetItems.$inferSelect;
    rawTranscript: string;
    sttConfig: ISttRunConfig;
    apiKeys: ApiKeys;
    dataPolicy?: IRunDataPolicy;
}): Promise<ITransliterationResult | undefined> {
    const transliteration = input.sttConfig.transliteration;
    if (
        input.sttConfig.transcriptVariant !== "latin" ||
        !transliteration?.enabled
    ) {
        return undefined;
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
        ...(input.dataPolicy ? { dataPolicy: input.dataPolicy } : {}),
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
        ...levelVolumeFingerprint(sttConfig),
    ]);
}

/** Appended only when on so existing fingerprints are unchanged. */
function levelVolumeFingerprint(sttConfig: ISttRunConfig | undefined) {
    return sttConfig?.levelVolume === true ? ["level-volume"] : [];
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
    /** Set on benchmark runs for cells with at least one yardstick to compare with. */
    benchmark?: IBenchmarkForCell;
    fieldConfigs: IPipelineFieldConfig[];
    defaultFieldMatcher?: "exact";
    judge?: typeof judgeConfigs.$inferSelect;
    judgePrompt?: IJudgePromptOption;
    runJudgeTransport?: ProviderTransport;
    dataPolicy?: IRunDataPolicy;
    apiKeys: ApiKeys;
    maxTokens: number;
    transcriptVariant?: "raw" | "latin";
    transcriptJudge: ITranscriptEvaluatorResult | undefined;
    /** Earlier benchmark details whose successful tasks are kept. */
    previousBenchmark?: IBenchmarkCellDetails;
    /** An earlier judge verdict kept instead of asking the judge again. */
    keptJudge?: IStoredScore;
}

type IStoredScore = typeof cellScores.$inferSelect;

/** A kept transcript-judge score, as the evaluator would return it. */
function keptTranscriptJudge(row: IStoredScore): ITranscriptEvaluatorResult {
    return {
        score: row.score,
        rationale: row.rationale,
        details: row.detailsJson as ITranscriptEvaluatorResult["details"],
    };
}

async function scoreCell(args: ScoreArgs): Promise<void> {
    const pricingFor = judgePricing(args.apiKeys);
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
    // Paid verdicts saved if a later step crashes, so Retry keeps them.
    let paidVerdicts = transcriptJudgeScoreRows(args);
    try {
        return await scoreAndSaveCell(
            args,
            transcriptMetric,
            pricingFor,
            (judgeRows) => {
                paidVerdicts = [
                    ...judgeRows,
                    ...transcriptJudgeScoreRows(args),
                ];
            },
        );
    } catch (error) {
        await savePaidVerdicts(args.cellId, paidVerdicts, error);
        throw error;
    }
}

type IScoreRow = typeof cellScores.$inferInsert;

function transcriptJudgeScoreRows(args: ScoreArgs): IScoreRow[] {
    if (!args.transcriptJudge) return [];
    return [
        {
            runCellId: args.cellId,
            scorerType: "transcript_judge",
            score: args.transcriptJudge.score,
            detailsJson: args.transcriptJudge.details,
            rationale: args.transcriptJudge.rationale,
        },
    ];
}

/** The judge score row: this pass's verdict, else the kept one. */
function judgeScoreRows(
    cellId: string,
    judge: Awaited<ReturnType<typeof scoreOutput>>["judge"],
    legacyJudge: JudgeOutcome | undefined,
    keptJudge: IStoredScore | undefined,
): IScoreRow[] {
    if (judge)
        return [
            {
                runCellId: cellId,
                scorerType: "judge",
                score: judge.score,
                detailsJson: judge.details ?? null,
                rationale: judge.rationale ?? null,
            },
        ];
    if (legacyJudge)
        return [
            {
                runCellId: cellId,
                scorerType: "judge",
                score: legacyJudge.ok ? legacyJudge.score : null,
                detailsJson:
                    legacyJudge.ok && legacyJudge.criteria.length > 0
                        ? { criteria: legacyJudge.criteria }
                        : null,
                rationale: legacyJudgeRationale(legacyJudge),
            },
        ];
    if (keptJudge)
        return [
            {
                runCellId: cellId,
                scorerType: "judge",
                score: keptJudge.score,
                detailsJson: keptJudge.detailsJson,
                rationale: keptJudge.rationale,
            },
        ];
    return [];
}

/**
 * After a scoring crash, keeps the judge verdicts this pass paid for (in
 * place of earlier ones) and marks the cell's scoring failed in the same
 * transaction, so its partial scores never count as scored. The next pass
 * scores it again and keeps the verdicts (see paidScoresToKeep).
 */
async function savePaidVerdicts(
    cellId: string,
    rows: IScoreRow[],
    error: unknown,
): Promise<void> {
    if (rows.length === 0) return;
    try {
        await db.transaction(async (tx) => {
            await tx
                .update(runCells)
                .set({
                    error: redactSecrets(
                        `scoring failed: ${errorMessage(error)}`,
                    ),
                })
                .where(eq(runCells.id, cellId));
            await tx.delete(cellScores).where(
                and(
                    eq(cellScores.runCellId, cellId),
                    inArray(
                        cellScores.scorerType,
                        rows.map((row) => row.scorerType),
                    ),
                ),
            );
            for (const row of rows) await tx.insert(cellScores).values(row);
        });
    } catch (saveError) {
        logWorkerEvent("error", "run_cell.verdict_save_failed", {
            cellId,
            ...safeWorkerError(saveError),
        });
    }
}

async function scoreAndSaveCell(
    args: ScoreArgs,
    transcriptMetric: ReturnType<typeof scoreTranscriptMetrics>,
    pricingFor: ReturnType<typeof judgePricing>,
    onJudged: (judgeRows: IScoreRow[]) => void,
): Promise<void> {
    const keptJudge = args.keptJudge;
    const result = await scoreOutput({
        output: args.outputJson,
        label: args.label,
        // With a kept verdict, only the free field checks run again.
        fieldConfigs: keptJudge
            ? args.fieldConfigs.filter((config) => config.kind !== "generative")
            : args.fieldConfigs,
        defaultFieldMatcher: args.defaultFieldMatcher,
        inputText: args.inputText,
        hasImage: args.hasImage,
        reference: args.reference,
        apiKeys: args.apiKeys,
        maxTokens: args.maxTokens,
        ...(args.dataPolicy ? { dataPolicy: args.dataPolicy } : {}),
        judgePrompt: keptJudge
            ? undefined
            : await judgePromptScoring(args.judgePrompt, pricingFor),
        fieldJudgePricingFor: (modelId) => pricingFor(modelId),
    });
    // Each judge's cost is recorded as soon as it is paid, so a later crash
    // in this cell's scoring does not lose it.
    await recordJudgeCost(
        db,
        args.cellId,
        totalJudgeCostUsd(result.judge?.costUsd),
    );

    const legacyJudge =
        !result.judge && !keptJudge && args.judge
            ? await runLegacyJudge(args, args.judge, pricingFor)
            : undefined;
    await recordJudgeCost(
        db,
        args.cellId,
        totalJudgeCostUsd(legacyJudge?.costUsd),
    );
    const judgeRows = judgeScoreRows(
        args.cellId,
        result.judge,
        legacyJudge,
        keptJudge,
    );
    onJudged(judgeRows);

    const benchmarkResult = args.benchmark
        ? await scoreAgainstBenchmark({
              taskMap: args.benchmark.config.taskMap,
              source: args.benchmark.config.source,
              candidate: args.outputJson,
              benchmark: args.benchmark.modelAnswer,
              storedAnswer: args.benchmark.storedAnswer,
              cellId: args.cellId,
              inputText: args.inputText,
              judge: benchmarkJudge(args.benchmark.config, args.dataPolicy),
              judgePricing: await benchmarkJudgePricing(
                  args.benchmark.config,
                  args.apiKeys,
              ),
              apiKeys: args.apiKeys,
              maxTokens: args.maxTokens,
              ...(args.previousBenchmark
                  ? { previous: args.previousBenchmark }
                  : {}),
          })
        : undefined;

    await recordJudgeCost(
        db,
        args.cellId,
        totalJudgeCostUsd(benchmarkResult?.judgeCostUsd),
    );

    await db.transaction(async (tx) => {
        await tx
            .delete(cellScores)
            .where(eq(cellScores.runCellId, args.cellId));
        // Scored: clear an earlier pass's scoring error.
        await tx
            .update(runCells)
            .set({ error: null })
            .where(eq(runCells.id, args.cellId));

        if (benchmarkResult && benchmarkResult.details.tasks.length > 0) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "benchmark",
                score: benchmarkResult.score,
                detailsJson: benchmarkResult.details,
                rationale: null,
            });
        }

        if (result.fieldDiff) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "field_diff",
                score: result.fieldDiff.score,
                detailsJson: result.fieldDiff.details,
                rationale: null,
            });
        }

        for (const row of judgeRows) await tx.insert(cellScores).values(row);

        if (transcriptMetric) {
            await tx.insert(cellScores).values({
                runCellId: args.cellId,
                scorerType: "transcript_metric",
                score: transcriptMetric.score,
                detailsJson: transcriptMetric.details,
                rationale: null,
            });
        }

        for (const row of transcriptJudgeScoreRows(args))
            await tx.insert(cellScores).values(row);
    });
}

async function judgePromptScoring(
    judgePrompt: IJudgePromptOption | undefined,
    pricingFor: ReturnType<typeof judgePricing>,
) {
    if (!judgePrompt) return undefined;
    return {
        modelId: judgePrompt.modelId,
        transport: judgePrompt.transport,
        rubricPrompt: judgePrompt.rubricPrompt,
        declaredInputs: judgePrompt.declaredInputs,
        reasoningEffort: judgePrompt.reasoningConfig
            ? resolveReasoningEffort(
                  judgePrompt.modelId,
                  judgePrompt.reasoningConfig.effort,
              )
            : undefined,
        pricing: await pricingFor(judgePrompt.modelId, judgePrompt.transport),
    };
}

async function runLegacyJudge(
    args: ScoreArgs,
    judge: typeof judgeConfigs.$inferSelect,
    pricingFor: ReturnType<typeof judgePricing>,
): Promise<JudgeOutcome> {
    const transport = args.judgePrompt?.transport ?? args.runJudgeTransport;
    return runJudge({
        judgeModelId: getBareModelName(judge.modelId),
        rubricPrompt: judge.rubricPrompt,
        apiKeys: args.apiKeys,
        inputText: args.inputText,
        hasImage: args.hasImage,
        output: args.outputJson,
        label: args.label,
        reference: args.reference,
        maxTokens: args.maxTokens,
        reasoningEffort: resolveReasoningEffort(
            judge.modelId,
            judge.reasoningConfig?.effort,
        ),
        transport,
        ...(args.dataPolicy ? { dataPolicy: args.dataPolicy } : {}),
        pricing: await pricingFor(judge.modelId, transport),
    });
}

interface IBenchmarkForCell {
    config: IRunBenchmarkConfig;
    /** The reference model's answer for the item, for model-sourced tasks. */
    modelAnswer?: OutputJson;
    /** The item's stored answer, for labels-sourced tasks. */
    storedAnswer?: OutputJson;
}

/**
 * The yardsticks a cell is scored against, or undefined when it has none
 * that a task uses: the reference model's output for the item (not on the
 * reference model's own cells, and only when it succeeded) and the item's
 * stored answer. Each task picks one by its source.
 */
export function benchmarkForCell(input: {
    config: IRunBenchmarkConfig | undefined;
    isReference: boolean;
    referenceOutput: OutputJson | undefined;
    hasReferenceOutput: boolean;
    label: LabelJson | undefined;
}): IBenchmarkForCell | undefined {
    const config = input.config;
    if (!config) return undefined;
    const modelAnswer =
        benchmarkUsesSource(config, "model") &&
        !input.isReference &&
        input.hasReferenceOutput
            ? (input.referenceOutput ?? {})
            : undefined;
    const storedAnswer = benchmarkUsesSource(config, "labels")
        ? input.label
        : undefined;
    // Rule checks and rubrics look at every answer, the reference's included.
    const selfScored = config.taskMap.tasks.some(isSelfScoredTask);
    if (modelAnswer === undefined && storedAnswer === undefined && !selfScored)
        return undefined;
    return {
        config,
        ...(modelAnswer !== undefined ? { modelAnswer } : {}),
        ...(storedAnswer !== undefined ? { storedAnswer } : {}),
    };
}

export function benchmarkJudge(
    config: IRunBenchmarkConfig,
    dataPolicy: IRunDataPolicy | undefined,
) {
    if (!config.judge) return undefined;
    return {
        modelId: getBareModelName(config.judge.modelId),
        transport: config.judge.transport,
        ...(dataPolicy ? { dataPolicy } : {}),
        reasoningEffort: resolveReasoningEffort(
            config.judge.modelId,
            config.judge.reasoningEffort,
        ),
    };
}

export async function benchmarkJudgePricing(
    config: IRunBenchmarkConfig,
    apiKeys: ApiKeys,
): Promise<ModelPricing | undefined> {
    if (!config.judge || !taskMapNeedsJudge(config.taskMap)) return undefined;
    return resolvePricingFor(
        config.judge.modelId,
        apiKeys,
        config.judge.transport,
    );
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
