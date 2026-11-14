import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    datasetItems,
    runs,
    workflowRunCells,
    workflowRunItems,
    workflowRuns,
} from "../db/schema";
import type { IWorkflowSnapshot } from "../db/jsonTypes";
import { createSemaphore, forEachPool } from "../lib/concurrency";
import { ensureModelCatalog } from "../llm/catalog";
import { pricingFor } from "../llm/pricing";
import type { EvalImage, ICompletionDataPolicy } from "@flash-evals/llm-core";
import {
    WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
    describeStepCondition,
    renderTemplate,
    runConditionList,
    stepAnswerValue,
    stepConditionHolds,
    valueAtBenchmarkPath,
    type ITemplateStep,
    type IWorkflowRunConfig,
} from "@flash-evals/api-contract";
import { resolveApiKeys } from "../secrets/resolveApiKeys";
import {
    assembleDagNodeInput,
    passingEdges,
    planLayers,
    type IChainEdge,
    type IUpstreamOutput,
} from "./chain";
import { loadWorkflowScoringContext, scoreWorkflowCell } from "./scoring";
import { recordFinalAnswers } from "./finalAnswer";
import { scorePipelineAnswers } from "./comparison";
import { evaluatePreparedWorkflowAudio } from "./audioEvaluation";
import {
    resolveWorkflowItemInput,
    type IResolvedWorkflowInput,
    type WorkflowDatasetItem,
} from "./audioPreparation";
import {
    executeSttWorkflowNode,
    type ISttNodeExecutionResult,
} from "./nodes/executeSttWorkflowNode";
import { billedCostOf, executeWorkflowLlmInvocation } from "./llmInvocation";
import { failedStepMessage } from "./stepError";
import {
    createWorkflowRunStopGuard,
    finishStoppedWorkflowRun,
} from "./runStop";
import type { IRunStopGuard, ISpendTrackingStopGuard } from "../runs/runStop";
import { logWorkerEvent, safeWorkerError } from "../jobs/workerObservability";
import { readSetupComparisonSpendUsd } from "../setupComparisons/spend";

type WorkflowCell = typeof workflowRunCells.$inferSelect;
type DatasetItem = WorkflowDatasetItem;

interface ILayerTaskContext {
    cellsByItemAndNode: Map<string, WorkflowCell>;
    incoming: Map<string, IChainEdge[]>;
    nodeByKey: Map<string, IWorkflowSnapshot["nodes"][number]>;
    apiKeys: Awaited<ReturnType<typeof resolveApiKeys>>["apiKeys"];
    sttProviderKeys: Awaited<
        ReturnType<typeof resolveApiKeys>
    >["sttProviderKeys"];
    scoringContext: Awaited<ReturnType<typeof loadWorkflowScoringContext>>;
    resolvedInputFor: (item: DatasetItem) => Promise<IResolvedWorkflowInput>;
    resolvedImagesFor: (item: DatasetItem) => Promise<EvalImage[]>;
    kind: IWorkflowSnapshot["kind"];
    teamId: string;
    projectId: string;
    /** The run's data rules, applied to every step and judge call. */
    dataPolicy?: ICompletionDataPolicy;
    /**
     * Cancel requests and the spend limit, checked before each step starts;
     * steps in flight count toward the limit at the average step's cost.
     */
    stop: ISpendTrackingStopGuard;
}
interface IUpstreamCell {
    edge: IChainEdge;
    cell: WorkflowCell | undefined;
}

async function executeWorkflowNode(input: {
    cell: WorkflowCell;
    item: DatasetItem;
    node: IWorkflowSnapshot["nodes"][number];
    inputText: string;
    images: EvalImage[];
    upstreamCells: IUpstreamCell[];
    context: ILayerTaskContext;
}): Promise<ISttNodeExecutionResult> {
    const { cell, item, node, inputText, images, context } = input;
    // Order-only parents gate and order the step; their answers aren't read.
    const upstreamCells = input.upstreamCells.filter(
        ({ edge }) => edge.orderOnly !== true,
    );
    if (runsAsSttNode(node, context))
        return executeSttWorkflowNode({
            cell,
            item,
            node,
            inputText,
            images,
            // A judge with multiple parents needs the assembled, labeled inputs,
            // rather than one arbitrarily selected parent's artifact.
            upstreamArtifact:
                node.nodeType === "judge" && upstreamCells.length > 1
                    ? undefined
                    : upstreamCells[0]?.cell?.outputJson,
            apiKeys: context.apiKeys,
            sttProviderKeys: context.sttProviderKeys,
            labelsByItemId: context.scoringContext.labelsByItemId,
            teamId: context.teamId,
            projectId: context.projectId,
            ...(context.dataPolicy ? { dataPolicy: context.dataPolicy } : {}),
        });
    if (!node.resolvedLlmExecution || node.promptContent === undefined)
        throw new Error(`Prompt node ${node.nodeKey} has invalid config.`);
    return executeWorkflowLlmInvocation({
        teamId: context.teamId,
        projectId: context.projectId,
        cellId: cell.id,
        nodeType: node.nodeType ?? "prompt",
        execution: node.resolvedLlmExecution,
        prompt: `${node.promptContent}\n\n${inputText}`,
        images,
        ...(node.promptSchema
            ? {
                  responseSchema: {
                      name: node.promptSchema.name,
                      schema: node.promptSchema.schema,
                      strict: node.promptSchema.strict,
                  },
              }
            : {}),
        pricing: pricingFor(node.resolvedLlmExecution.route.modelId),
        ...(context.dataPolicy ? { dataPolicy: context.dataPolicy } : {}),
        ...(node.stepSettings?.outputMode
            ? { outputMode: node.stepSettings.outputMode }
            : {}),
    });
}

/**
 * Whether a step runs through the STT node path. Its recorded cost is a
 * running total across passes; an LLM step's cost is per call.
 */
function runsAsSttNode(
    node: IWorkflowSnapshot["nodes"][number],
    context: ILayerTaskContext,
): boolean {
    return (
        context.kind === "stt" ||
        (context.kind === "multi" && (node.nodeType ?? "prompt") !== "prompt")
    );
}

/**
 * A succeeded step's recorded cost. An STT step reports its running total;
 * an LLM step reports this call only, so what earlier failed-but-billed
 * passes recorded is added to it.
 */
function succeededStepCostUsd(
    callCostUsd: number | undefined,
    recordedUsd: number,
    runningTotal: boolean,
): number | null {
    if (runningTotal || recordedUsd === 0) return callCostUsd ?? null;
    return recordedUsd + (callCostUsd ?? 0);
}

/**
 * A call that was answered and billed but failed the step (e.g. its answer
 * broke the schema) still counts toward the run's spend limit and the team's
 * daily cap: it is added to what the step has recorded.
 */
function failedStepCost(
    error: unknown,
    recordedUsd: number,
): { set: { costUsd?: number }; paidUsd: number } {
    const paidUsd = billedCostOf(error) ?? 0;
    return paidUsd > 0
        ? { set: { costUsd: recordedUsd + paidUsd }, paidUsd }
        : { set: {}, paidUsd: 0 };
}

function workflowRunStatus(
    counts: { total: number; failed: number; done: number },
    activeSttItems: number,
): "running" | "failed" | "partial" | "completed" {
    if (activeSttItems > 0) return "running";
    if (counts.failed === counts.total) return "failed";
    if (counts.failed > 0) return "partial";
    if (counts.done === counts.total) return "completed";
    return "running";
}

const concurrency = Math.max(
    1,
    Number.parseInt(process.env.EVAL_CONCURRENCY ?? "4", 10),
);
const executionPermits = createSemaphore(() => concurrency);

function acquireExecutionPermit(): Promise<() => void> {
    return executionPermits.acquire();
}

async function markCellBlocked(
    cell: WorkflowCell,
    fromNodeKey: string,
): Promise<void> {
    await db
        .update(workflowRunCells)
        .set({
            status: "failed",
            error: `Blocked by failed node ${fromNodeKey}.`,
        })
        .where(
            and(
                eq(workflowRunCells.id, cell.id),
                eq(workflowRunCells.status, "pending"),
            ),
        );
}

/**
 * Records a step that does not run for this item: its condition did not
 * hold, or a step it depends on was skipped. No model call, no cost.
 */
async function markCellSkipped(
    cell: WorkflowCell,
    skipReason: string,
): Promise<void> {
    await db
        .update(workflowRunCells)
        .set({
            status: "skipped",
            outputJson: { text: "", skipReason },
            costUsd: 0,
            latencyMs: null,
            error: null,
        })
        .where(
            and(
                eq(workflowRunCells.id, cell.id),
                eq(workflowRunCells.status, "pending"),
            ),
        );
}

const DONE = new Set(["succeeded", "cached"]);

/**
 * Whether a step with a run condition goes ahead for this item: "run",
 * "skip" (with the reason), "blocked" when a checked step failed, or
 * "wait" when one has not finished. With several conditions, all must hold;
 * the reason names the first that does not.
 */
export function conditionOutcome(
    node: Pick<IWorkflowSnapshot["nodes"][number], "runCondition">,
    sourceFor: (
        stepKey: string,
    ) => Pick<WorkflowCell, "status" | "outputJson"> | undefined,
    labelFor: (stepKey: string) => string,
):
    | { kind: "run" }
    | { kind: "skip"; reason: string }
    | { kind: "blocked"; stepKey: string }
    | { kind: "wait" } {
    const conditions = runConditionList(node.runCondition);
    let waiting = false;
    for (const condition of conditions) {
        const source = sourceFor(condition.stepKey);
        if (!source || source.status === "failed")
            return { kind: "blocked", stepKey: condition.stepKey };
        if (source.status === "skipped")
            return {
                kind: "skip",
                reason: `Skipped: ${labelFor(condition.stepKey)} was skipped.`,
            };
        if (!DONE.has(source.status)) waiting = true;
    }
    if (waiting) return { kind: "wait" };
    for (const condition of conditions) {
        const answer = stepAnswerValue(
            sourceFor(condition.stepKey)?.outputJson ?? { text: "" },
        );
        if (stepConditionHolds(condition, answer)) continue;
        const actual =
            condition.path.trim() === "$" || condition.path.trim() === ""
                ? answer
                : valueAtBenchmarkPath(answer, condition.path);
        const rule = describeStepCondition(
            condition,
            labelFor(condition.stepKey),
        ).replace(/^Runs only/, "runs only");
        return {
            kind: "skip",
            reason: `Skipped: ${rule} (it was ${actual === undefined ? "missing" : JSON.stringify(actual)}).`,
        };
    }
    return { kind: "run" };
}

async function executeClaimedCell(
    cell: WorkflowCell,
    item: DatasetItem,
    node: IWorkflowSnapshot["nodes"][number],
    inboundEdges: IChainEdge[],
    upstreamCells: IUpstreamCell[],
    context: ILayerTaskContext,
): Promise<number> {
    // Spend an earlier pass already recorded on this step (see below).
    const recordedUsd = cell.costUsd ?? 0;
    let inputText: string | undefined;
    try {
        const resolvedInput =
            context.kind === "stt"
                ? { text: item.inputText ?? "" }
                : await context.resolvedInputFor(item);
        const passing = passingEdges(upstreamCells.map(({ edge }) => edge));
        const hasDirectImageInput = passing.some((edge) => {
            const upstreamNode = context.nodeByKey.get(edge.fromNodeKey);
            return (
                upstreamNode?.nodeConfig?.type === "input" &&
                upstreamNode.nodeConfig.modality === "image"
            );
        });
        const images = hasDirectImageInput
            ? await context.resolvedImagesFor(item)
            : [];
        const outputs = new Map<string, IUpstreamOutput>();
        for (const { edge, cell: upstream } of upstreamCells) {
            if (edge.orderOnly) continue;
            if (typeof upstream?.outputJson?.text !== "string") {
                throw new Error(
                    `Workflow node ${edge.fromNodeKey} has no output text.`,
                );
            }
            const upstreamNode = context.nodeByKey.get(edge.fromNodeKey);
            outputs.set(edge.fromNodeKey, {
                nodeKey: edge.fromNodeKey,
                label: upstreamNode?.label ?? edge.fromNodeKey,
                output: upstream.outputJson.text,
            });
        }
        inputText = stepInputText(
            item,
            node,
            resolvedInput.text,
            () =>
                assembleDagNodeInput(resolvedInput.text, inboundEdges, outputs),
            context,
        );
        const releasePermit = await acquireExecutionPermit();
        let execution: ISttNodeExecutionResult;
        try {
            execution = await executeWorkflowNode({
                cell,
                item,
                node,
                inputText,
                images,
                upstreamCells,
                context,
            });
        } finally {
            releasePermit();
        }
        const stepCostUsd = succeededStepCostUsd(
            execution.costUsd,
            recordedUsd,
            runsAsSttNode(node, context),
        );
        await db
            .update(workflowRunCells)
            .set({
                status: "succeeded",
                inputText,
                outputJson: execution.artifact,
                latencyMs: execution.latencyMs,
                costUsd: stepCostUsd,
                error: null,
            })
            .where(eq(workflowRunCells.id, cell.id));
        let judgePaidUsd = 0;
        try {
            if (context.kind !== "stt")
                judgePaidUsd = await scoreWorkflowCell({
                    cellId: cell.id,
                    node,
                    item,
                    output: execution.artifact.json ?? execution.artifact,
                    apiKeys: context.apiKeys,
                    context: context.scoringContext,
                    teamId: context.teamId,
                    projectId: context.projectId,
                    ...(context.dataPolicy
                        ? { dataPolicy: context.dataPolicy }
                        : {}),
                });
        } catch (error) {
            logWorkerEvent("error", "workflow_cell.scoring_failed", {
                workflowRunId: cell.workflowRunId,
                cellId: cell.id,
                ...safeWorkerError(error),
            });
        }
        // What this pass paid, for the spend limit's in-flight estimate: the
        // step's cost minus what an earlier pass already recorded on it (an
        // STT step's cost is a running total of its paid chunks), plus its
        // judge calls.
        return Math.max(0, (stepCostUsd ?? 0) - recordedUsd) + judgePaidUsd;
    } catch (error) {
        // Shown in the step result: redacted and capped like provider text.
        const message = failedStepMessage(error);
        logWorkerEvent("error", "workflow_cell.failed", {
            workflowRunId: cell.workflowRunId,
            cellId: cell.id,
            ...safeWorkerError(error),
        });
        const billed = failedStepCost(error, recordedUsd);
        await db
            .update(workflowRunCells)
            .set({ status: "failed", inputText, error: message, ...billed.set })
            .where(eq(workflowRunCells.id, cell.id));
        return billed.paidUsd;
    }
}

/**
 * A step's message after its prompt: its input template written out, or the
 * default assembly (the item in `<input>`, or the connected answers).
 */
function stepInputText(
    item: DatasetItem,
    node: IWorkflowSnapshot["nodes"][number],
    originalInput: string,
    defaultAssembly: () => string,
    context: ILayerTaskContext,
): string {
    const template = node.stepSettings?.inputTemplate;
    if (!template) return defaultAssembly();
    return renderTemplate(template, {
        input: originalInput,
        steps: upstreamStepsFor(item, node.nodeKey, context),
    });
}

/**
 * The steps that run before `nodeKey` (every step with a path to it), with
 * their answers for this item, for the step's input template.
 */
export function upstreamStepsFor(
    item: Pick<DatasetItem, "id">,
    nodeKey: string,
    context: Pick<
        ILayerTaskContext,
        "incoming" | "nodeByKey" | "cellsByItemAndNode"
    >,
): Map<string, ITemplateStep> {
    const steps = new Map<string, ITemplateStep>();
    const pending = [nodeKey];
    while (pending.length) {
        const key = pending.pop()!;
        for (const edge of context.incoming.get(key) ?? []) {
            if (steps.has(edge.fromNodeKey)) continue;
            const cell = context.cellsByItemAndNode.get(
                `${item.id}:${edge.fromNodeKey}`,
            );
            const done = cell && DONE.has(cell.status);
            steps.set(edge.fromNodeKey, {
                label: context.nodeByKey.get(edge.fromNodeKey)?.label,
                status: done
                    ? "succeeded"
                    : cell?.status === "skipped"
                      ? "skipped"
                      : cell?.status === "failed"
                        ? "failed"
                        : "pending",
                ...(done
                    ? {
                          answer: stepAnswerValue(
                              cell.outputJson ?? { text: "" },
                          ),
                      }
                    : {}),
            });
            pending.push(edge.fromNodeKey);
        }
    }
    return steps;
}

async function executeLayerTask(
    item: DatasetItem,
    node: IWorkflowSnapshot["nodes"][number],
    context: ILayerTaskContext,
): Promise<void> {
    const cell = context.cellsByItemAndNode.get(`${item.id}:${node.nodeKey}`);
    if (!cell || cell.status === "succeeded" || cell.status === "cached")
        return;

    const inboundEdges = context.incoming.get(node.nodeKey) ?? [];
    const upstreamCells = inboundEdges.map((edge) => ({
        edge,
        cell: context.cellsByItemAndNode.get(`${item.id}:${edge.fromNodeKey}`),
    }));
    const blockedBy = upstreamCells.find(
        ({ cell: upstream }) => !upstream || upstream.status === "failed",
    );
    if (blockedBy) {
        await markCellBlocked(cell, blockedBy.edge.fromNodeKey);
        return;
    }
    // A step after a skipped step is skipped too: the chain ended there.
    const skippedParent = upstreamCells.find(
        ({ cell: upstream }) => upstream?.status === "skipped",
    );
    if (skippedParent) {
        const label =
            context.nodeByKey.get(skippedParent.edge.fromNodeKey)?.label ??
            skippedParent.edge.fromNodeKey;
        await markCellSkipped(cell, `Skipped: ${label} was skipped.`);
        return;
    }
    const upstreamReady = upstreamCells.every(
        ({ cell: upstream }) =>
            upstream?.status === "succeeded" || upstream?.status === "cached",
    );
    if (!upstreamReady) return;
    if (node.runCondition) {
        const outcome = conditionOutcome(
            node,
            (stepKey) =>
                context.cellsByItemAndNode.get(`${item.id}:${stepKey}`),
            (stepKey) => context.nodeByKey.get(stepKey)?.label ?? stepKey,
        );
        if (outcome.kind === "blocked") {
            await markCellBlocked(cell, outcome.stepKey);
            return;
        }
        if (outcome.kind === "skip") {
            await markCellSkipped(cell, outcome.reason);
            return;
        }
        if (outcome.kind === "wait") return;
    }
    // A stopped run starts no more steps; this one stays pending (not run).
    if (await context.stop.check()) return;

    const [claimed] = await db
        .update(workflowRunCells)
        .set({ status: "running", claimedAt: new Date(), error: null })
        .where(
            and(
                eq(workflowRunCells.id, cell.id),
                eq(workflowRunCells.status, "pending"),
            ),
        )
        .returning({ id: workflowRunCells.id });
    if (!claimed) return;

    context.stop.started();
    let paidUsd = 0;
    try {
        paidUsd = await executeClaimedCell(
            cell,
            item,
            node,
            inboundEdges,
            upstreamCells,
            context,
        );
    } finally {
        context.stop.finished(paidUsd);
    }
}

export async function executeWorkflowRun(workflowRunId: string): Promise<void> {
    await ensureModelCatalog();
    const [run] = await db
        .select()
        .from(workflowRuns)
        .where(eq(workflowRuns.id, workflowRunId))
        .limit(1);
    if (!run || (run.status !== "pending" && run.status !== "running")) return;
    const snapshot = run.workflowSnapshot as IWorkflowSnapshot;
    if (!supportsWorkflowLlmExecutionContract(snapshot)) {
        await db
            .update(workflowRuns)
            .set({
                status: "failed",
                error: "This run was created by an older release whose model routes this worker can't run. Start a new run.",
            })
            .where(eq(workflowRuns.id, workflowRunId));
        return;
    }
    const runConfig = run.configSnapshot ?? {};
    // Cancel requests and the spend limit are checked before each step
    // starts; calls already sent finish, steps not started stay pending.
    // A setup comparison's members share its spend limit.
    const comparisonId = run.setupComparisonId;
    const stop = createWorkflowRunStopGuard(
        workflowRunId,
        runConfig.maxCostUsd,
        comparisonId
            ? () => readSetupComparisonSpendUsd(comparisonId)
            : undefined,
    );
    const stoppedEarly = await stop.check();
    if (stoppedEarly) {
        await finishStoppedWorkflowRun(workflowRunId, stoppedEarly);
        return;
    }
    const nodeKeyById = new Map(
        snapshot.nodes.map((node) => [node.id, node.nodeKey]),
    );
    const edges: IChainEdge[] = snapshot.edges.map((edge) => ({
        fromNodeKey: nodeKeyById.get(edge.fromNodeId) ?? "",
        toNodeKey: nodeKeyById.get(edge.toNodeId) ?? "",
        carryOriginalInput: edge.carryOriginalInput,
        ...(edge.orderOnly ? { orderOnly: true } : {}),
    }));
    const layers = planLayers(snapshot.nodes, edges, {
        allowDisconnected: snapshot.kind === "stt" || snapshot.kind === "multi",
    });
    const orderedNodes = layers.flat();
    const incoming = new Map<string, IChainEdge[]>();
    for (const edge of edges) {
        incoming.set(edge.toNodeKey, [
            ...(incoming.get(edge.toNodeKey) ?? []),
            edge,
        ]);
    }
    const cells = await db
        .select()
        .from(workflowRunCells)
        .where(eq(workflowRunCells.workflowRunId, workflowRunId));
    const itemIds = [...new Set(cells.map((cell) => cell.datasetItemId))];
    const items = await db
        .select()
        .from(datasetItems)
        .where(inArray(datasetItems.id, itemIds));
    const { apiKeys, sttProviderKeys } = await resolveApiKeys(run.teamId);
    const scoringContext = await loadWorkflowScoringContext(
        orderedNodes,
        itemIds,
        needsTranscriptLabels(snapshot),
    );
    // Setup is done. A pass that threw before here leaves the run pending,
    // and the queue marks it failed with the error (see workflowRunQueue).
    // A run cancelled during setup is no longer pending or running: stop.
    const started = await db
        .update(workflowRuns)
        .set({ status: "running", error: null })
        .where(
            and(
                eq(workflowRuns.id, workflowRunId),
                inArray(workflowRuns.status, ["pending", "running"]),
            ),
        )
        .returning({ id: workflowRuns.id });
    if (started.length === 0) return;
    const resolvedInputCache = new Map<
        string,
        Promise<IResolvedWorkflowInput>
    >();
    const resolvedImageCache = new Map<string, Promise<EvalImage[]>>();
    const resolvedInputFor = (
        item: DatasetItem,
    ): Promise<IResolvedWorkflowInput> => {
        let cached = resolvedInputCache.get(item.id);
        if (!cached) {
            cached = resolveWorkflowItemInput({
                workflowRunId,
                item,
                sttConfig: snapshot.sttConfig,
                sttProviderKeys,
                apiKeys,
                prepareAudio: snapshot.kind !== "multi",
                ...(runConfig.dataPolicy
                    ? { dataPolicy: runConfig.dataPolicy }
                    : {}),
            });
            resolvedInputCache.set(item.id, cached);
        }
        return cached;
    };
    const resolvedImagesFor = (item: DatasetItem): Promise<EvalImage[]> => {
        let cached = resolvedImageCache.get(item.id);
        if (!cached) {
            cached = resolveWorkflowItemInput({
                workflowRunId,
                item,
                sttConfig: undefined,
                sttProviderKeys,
                apiKeys,
                prepareAudio: false,
                includeImages: true,
            }).then((resolved) => resolved.images ?? []);
            resolvedImageCache.set(item.id, cached);
        }
        return cached;
    };
    // Evaluation begins as soon as each transcript is ready and does not hold
    // DAG roots. The shared preparation promise still guarantees one selected
    // transcript is used by both scoring and prompt execution.
    const evaluationTask =
        snapshot.kind === "stt" || snapshot.kind === "multi"
            ? Promise.resolve()
            : forEachPool(items, concurrency, async (item) => {
                  try {
                      const prepared = (await resolvedInputFor(item))
                          .preparedAudio;
                      if (!prepared) return;
                      await evaluatePreparedWorkflowAudio({
                          prepared,
                          item,
                          evaluator: snapshot.sttConfig?.evaluator,
                          sttModelId: snapshot.sttConfig?.modelId ?? "",
                          apiKeys,
                          scoringContext,
                      });
                  } catch {
                      // Preparation failures are persisted on the item and reflected by
                      // the item's failed cells. Do not skip run finalization.
                  }
              });

    const nodeByKey = new Map(orderedNodes.map((node) => [node.nodeKey, node]));
    // A layer is a run-wide barrier. Flattening item/node work within that
    // barrier gives the whole run one concurrency budget instead of nesting
    // item and node pools (which could otherwise execute concurrency squared
    // provider calls).
    for (const layer of layers) {
        if (stop.reason) break;
        const authoritativeCells = await db
            .select()
            .from(workflowRunCells)
            .where(eq(workflowRunCells.workflowRunId, workflowRunId));
        const cellsByItemAndNode = new Map(
            authoritativeCells.map((cell) => [
                `${cell.datasetItemId}:${cell.nodeKey}`,
                cell,
            ]),
        );
        const layerTasks = items.flatMap((item) =>
            layer.map((node) => ({ item, node })),
        );

        const context: ILayerTaskContext = {
            cellsByItemAndNode,
            incoming,
            nodeByKey,
            apiKeys,
            sttProviderKeys,
            scoringContext,
            resolvedInputFor,
            resolvedImagesFor,
            kind: snapshot.kind,
            teamId: run.teamId,
            projectId: run.projectId,
            ...(runConfig.dataPolicy
                ? { dataPolicy: runConfig.dataPolicy }
                : {}),
            stop,
        };
        await forEachPool(layerTasks, concurrency, ({ item, node }) =>
            executeLayerTask(item, node, context),
        );
        resolvedImageCache.clear();
    }

    await evaluationTask;
    await finishWorkflowRun(workflowRunId, snapshot, stop, {
        apiKeys,
        comparison: runConfig.comparison,
    });
}

/**
 * Records final answers for items whose steps all finished and, on a run
 * compared with an eval run, scores them against its reference; then ends
 * the run: `cancelled` when it stopped early, otherwise by its cells'
 * outcome.
 */
async function finishWorkflowRun(
    workflowRunId: string,
    snapshot: IWorkflowSnapshot,
    stop: IRunStopGuard,
    scoring: {
        apiKeys: Awaited<ReturnType<typeof resolveApiKeys>>["apiKeys"];
        comparison: IWorkflowRunConfig["comparison"];
    },
): Promise<void> {
    if (snapshot.finalAnswer) {
        const finished = await db
            .select()
            .from(workflowRunCells)
            .where(eq(workflowRunCells.workflowRunId, workflowRunId));
        await recordFinalAnswers({ workflowRunId, snapshot, cells: finished });
        // Judge calls count toward the spend limit and stop with the run.
        if (scoring.comparison && !stop.reason) {
            // In a setup comparison the eval run starts with this run, so
            // the reference answers may not all exist yet. The run stays
            // running with its steps done; when the eval run finishes, its
            // worker queues this run again to score (and recovery does, if
            // that was missed).
            if (await evalRunStillRunning(scoring.comparison.runId)) {
                logWorkerEvent("info", "workflow_run.waiting_for_eval_run", {
                    workflowRunId,
                    runId: scoring.comparison.runId,
                });
                return;
            }
            await scorePipelineAnswers({
                workflowRunId,
                comparison: scoring.comparison,
                apiKeys: scoring.apiKeys,
                stop,
            });
        }
    }

    const stopReason = stop.reason;
    if (stopReason) {
        await finishStoppedWorkflowRun(workflowRunId, stopReason);
        return;
    }

    const [counts] = await db
        .select({
            total: sql<number>`count(*)::int`,
            failed: sql<number>`count(*) filter (where ${workflowRunCells.status} = 'failed')::int`,
            done: sql<number>`count(*) filter (where ${workflowRunCells.status} in ('succeeded','cached','skipped'))::int`,
        })
        .from(workflowRunCells)
        .where(eq(workflowRunCells.workflowRunId, workflowRunId));
    const [sttCounts] = await db
        .select({
            active: sql<number>`count(*) filter (where ${workflowRunItems.preparationStatus} in ('pending','running') or ${workflowRunItems.evaluationStatus} in ('pending','running'))::int`,
        })
        .from(workflowRunItems)
        .where(eq(workflowRunItems.workflowRunId, workflowRunId));
    const status = workflowRunStatus(counts, sttCounts.active);
    await db
        .update(workflowRuns)
        .set({ status })
        .where(eq(workflowRuns.id, workflowRunId));
}

/** Whether the eval run a pipeline run is compared with has yet to finish. */
async function evalRunStillRunning(runId: string): Promise<boolean> {
    const [row] = await db
        .select({ status: runs.status })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
    return row?.status === "pending" || row?.status === "running";
}

/** Whether scoring needs reference transcripts: audio input or an STT evaluator. */
function needsTranscriptLabels(snapshot: IWorkflowSnapshot): boolean {
    return (
        snapshot.kind === "stt" ||
        (snapshot.kind === "multi" &&
            snapshot.nodes.some(
                (node) =>
                    node.nodeConfig?.type === "input" &&
                    node.nodeConfig.modality === "audio",
            )) ||
        snapshot.sttConfig?.evaluator?.enabled === true
    );
}

export function supportsWorkflowLlmExecutionContract(
    snapshot: IWorkflowSnapshot,
): boolean {
    return snapshot.nodes.every(
        (node) =>
            !node.resolvedLlmExecution ||
            node.resolvedLlmExecution.contractVersion ===
                WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
    );
}
