import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    datasetItems,
    workflowRunCells,
    workflowRunItems,
    workflowRuns,
} from "../db/schema";
import type { IWorkflowSnapshot } from "../db/jsonTypes";
import { forEachPool } from "../lib/concurrency";
import { pricingFor } from "../llm/pricing";
import type { EvalImage } from "@mosaic/llm-core";
import { WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION } from "@mosaic/api-contract";
import { resolveApiKeys } from "../secrets/resolveApiKeys";
import {
    assembleDagNodeInput,
    planLayers,
    type IChainEdge,
    type IUpstreamOutput,
} from "./chain";
import { loadWorkflowScoringContext, scoreWorkflowCell } from "./scoring";
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
import { executeWorkflowLlmInvocation } from "./llmInvocation";
import { logWorkerEvent, safeWorkerError } from "../jobs/workerObservability";

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
    const { cell, item, node, inputText, images, upstreamCells, context } =
        input;
    if (
        context.kind === "stt" ||
        (context.kind === "multi" && (node.nodeType ?? "prompt") !== "prompt")
    )
        return executeSttWorkflowNode({
            cell,
            item,
            node,
            inputText,
            images,
            upstreamArtifact: upstreamCells[0]?.cell?.outputJson,
            apiKeys: context.apiKeys,
            sttProviderKeys: context.sttProviderKeys,
            labelsByItemId: context.scoringContext.labelsByItemId,
            teamId: context.teamId,
            projectId: context.projectId,
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
    });
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
let activeExecutions = 0;
const executionWaiters: Array<() => void> = [];

async function acquireExecutionPermit(): Promise<() => void> {
    if (activeExecutions >= concurrency) {
        await new Promise<void>((resolve) => executionWaiters.push(resolve));
    } else {
        activeExecutions += 1;
    }
    let released = false;
    return () => {
        if (released) return;
        released = true;
        const next = executionWaiters.shift();
        if (next) next();
        else activeExecutions -= 1;
    };
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

async function executeClaimedCell(
    cell: WorkflowCell,
    item: DatasetItem,
    node: IWorkflowSnapshot["nodes"][number],
    inboundEdges: IChainEdge[],
    upstreamCells: IUpstreamCell[],
    context: ILayerTaskContext,
): Promise<void> {
    let inputText: string | undefined;
    try {
        const resolvedInput =
            context.kind === "stt"
                ? { text: item.inputText ?? "" }
                : await context.resolvedInputFor(item);
        const hasDirectImageInput = upstreamCells.some(({ edge }) => {
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
        inputText = assembleDagNodeInput(
            resolvedInput.text,
            inboundEdges,
            outputs,
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
        await db
            .update(workflowRunCells)
            .set({
                status: "succeeded",
                inputText,
                outputJson: execution.artifact,
                latencyMs: execution.latencyMs,
                costUsd: execution.costUsd,
                error: null,
            })
            .where(eq(workflowRunCells.id, cell.id));
        try {
            if (context.kind !== "stt")
                await scoreWorkflowCell({
                    cellId: cell.id,
                    node,
                    item,
                    output: execution.artifact.json ?? execution.artifact,
                    apiKeys: context.apiKeys,
                    context: context.scoringContext,
                    teamId: context.teamId,
                    projectId: context.projectId,
                });
        } catch (error) {
            logWorkerEvent("error", "workflow_cell.scoring_failed", {
                workflowRunId: cell.workflowRunId,
                cellId: cell.id,
                ...safeWorkerError(error),
            });
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWorkerEvent("error", "workflow_cell.failed", {
            workflowRunId: cell.workflowRunId,
            cellId: cell.id,
            ...safeWorkerError(error),
        });
        await db
            .update(workflowRunCells)
            .set({ status: "failed", inputText, error: message })
            .where(eq(workflowRunCells.id, cell.id));
    }
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
    const upstreamReady = upstreamCells.every(
        ({ cell: upstream }) =>
            upstream?.status === "succeeded" || upstream?.status === "cached",
    );
    if (!upstreamReady) return;

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

    await executeClaimedCell(
        cell,
        item,
        node,
        inboundEdges,
        upstreamCells,
        context,
    );
}

export async function executeWorkflowRun(workflowRunId: string): Promise<void> {
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
            .set({ status: "failed" })
            .where(eq(workflowRuns.id, workflowRunId));
        return;
    }
    await db
        .update(workflowRuns)
        .set({ status: "running" })
        .where(
            and(
                eq(workflowRuns.id, workflowRunId),
                eq(workflowRuns.status, "pending"),
            ),
        );
    const nodeKeyById = new Map(
        snapshot.nodes.map((node) => [node.id, node.nodeKey]),
    );
    const edges: IChainEdge[] = snapshot.edges.map((edge) => ({
        fromNodeKey: nodeKeyById.get(edge.fromNodeId) ?? "",
        toNodeKey: nodeKeyById.get(edge.toNodeId) ?? "",
        carryOriginalInput: edge.carryOriginalInput,
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
        snapshot.kind === "stt" ||
            (snapshot.kind === "multi" &&
                snapshot.nodes.some(
                    (node) =>
                        node.nodeConfig?.type === "input" &&
                        node.nodeConfig.modality === "audio",
                )) ||
            snapshot.sttConfig?.evaluator?.enabled === true,
    );
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
        };
        await forEachPool(layerTasks, concurrency, ({ item, node }) =>
            executeLayerTask(item, node, context),
        );
        resolvedImageCache.clear();
    }

    await evaluationTask;

    const [counts] = await db
        .select({
            total: sql<number>`count(*)::int`,
            failed: sql<number>`count(*) filter (where ${workflowRunCells.status} = 'failed')::int`,
            done: sql<number>`count(*) filter (where ${workflowRunCells.status} in ('succeeded','cached'))::int`,
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
