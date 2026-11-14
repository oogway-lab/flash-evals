import {
    benchmarkTaskSource,
    benchmarkUsesSource,
    summarizeBenchmarkComparison,
    type IBenchmarkCellDetails,
    type IBenchmarkCellInput,
    type IBenchmarkModelSummary,
    type IRunBenchmarkConfig,
} from "./benchmark.js";
import type {
    ICreateRunFromSelectionRequest,
    IRunDataPolicy,
    ProviderTransport,
    RunStatus,
    RunStopReason,
} from "./index.js";
import type { IPipelineAnswerScore } from "./pipelineComparison.js";
import type { WorkflowKind } from "./workflows.js";

/**
 * A setup comparison: one launch that compares setups on one dataset. It
 * creates an eval run (the reference, today's model, and the single-model
 * candidates) and one pipeline run per chosen pipeline, each scored against
 * that eval run's reference with its Task Map, targets, judge and data
 * rules. All member runs share one spend limit, cancel together, and the
 * comparison's status is derived from theirs.
 */

/** The most pipelines one comparison may launch. */
export const MAX_SETUP_COMPARISON_PIPELINES = 10;

/** Settings a comparison captures when it is created. */
export interface ISetupComparisonConfig {
    /** The data rules every member run follows. */
    dataPolicy?: IRunDataPolicy;
    /** The chosen pipelines, in the order they were picked. */
    pipelineIds?: string[];
}

/**
 * Creating a comparison: the eval run's settings, exactly as for a single
 * eval run (dataset, reference model, candidates and their prompt
 * versions, benchmark Task Map and targets, judge, data rules, output
 * budget), plus the saved pipelines to try. `maxCostUsd` is one spend limit
 * for every member run; `dataPolicy` applies to every member run.
 */
export interface ICreateSetupComparisonRequest extends ICreateRunFromSelectionRequest {
    /** Saved pipelines to try, each with a final answer. May be empty. */
    pipelineIds: string[];
}

export interface ICreateSetupComparisonResponse {
    setupComparisonId: string;
    evalRunId: string;
    /** One pipeline run per chosen pipeline, in the same order. */
    workflowRunIds: string[];
}

export interface ICancelSetupComparisonRequest {
    teamId: string;
    projectId: string;
    setupComparisonId: string;
}

export interface ICancelSetupComparisonResponse {
    setupComparisonId: string;
    status: RunStatus;
    stopReason?: RunStopReason;
}

/** One run in a comparison. */
export interface ISetupComparisonMember {
    kind: "eval_run" | "pipeline";
    /** The eval run id or the pipeline (workflow) run id. */
    runId: string;
    /** The pipeline, for a pipeline run. */
    workflowId?: string;
    /** The pipeline's name; "Eval run" for the eval run. */
    name: string;
    /** The models of the pipeline's steps, in step order. */
    stepModels?: string[];
    status: RunStatus;
    stopReason?: RunStopReason;
    /** Why the run failed before it started (redacted). */
    error?: string;
    createdAt: string;
    /** Since when a pending run has waited for a worker. */
    pendingSince?: string;
    /** Pending for over a minute: no worker has picked it up. */
    waitingForWorker?: boolean;
    enqueueStatus?: "pending_enqueue" | "queued" | "failed";
    /**
     * A pipeline run whose steps have all finished and whose final answers
     * wait for the eval run to finish before they are scored.
     */
    waitingForEvalRun?: boolean;
}

/** A comparison with its member runs. */
export interface ISetupComparison {
    id: string;
    datasetId: string;
    datasetName?: string;
    createdAt: string;
    /** Derived from the member runs (see `setupComparisonStatus`). */
    status: RunStatus;
    stopReason?: RunStopReason;
    cancelRequested: boolean;
    /** The shared spend limit, when one was set. */
    maxCostUsd?: number;
    /** Recorded spend of every member run, judge calls included. */
    spentUsd: number;
    dataPolicy?: IRunDataPolicy;
    members: ISetupComparisonMember[];
    /** Every setup ranked together, once the eval run has a Task Map. */
    ranking?: ISetupRanking;
}

/** One setup's row in a comparison's ranking. */
export interface ISetupRankingRow {
    /** The eval run's run model id, or `pipeline:<workflow run id>`. */
    id: string;
    kind: "reference" | "model" | "pipeline";
    /** The model id, or the pipeline's name. */
    name: string;
    /** A pipeline's step models, in step order. */
    stepModels?: string[];
    /** The member run the row's answers come from. */
    runId: string;
    workflowId?: string;
    /**
     * Mean cost of one item on the compared items (a pipeline: the sum of
     * its steps).
     */
    costPerCall?: number;
    latencyMs?: number;
    /** Items whose answer is scored (the reference: answered), of all items. */
    scoredItems: number;
    /** Items not answered or not scored yet. */
    waitingItems: number;
    /** Failed items, of all items (progress). */
    failedItems: number;
    /** Scored items among the compared items, which accuracy uses. */
    comparedScoredItems: number;
    /** Failed items among the compared items (counted as misses). */
    comparedFailedItems: number;
    /** See `setupAccuracy`. */
    accuracy?: number;
    /** No other setup is at least as accurate and at most as costly, and better on one. */
    notBeaten: boolean;
    /** The row in `summarizeBenchmarkComparison`'s output. */
    summary?: IBenchmarkModelSummary;
}

/** Every setup of a comparison in one table. */
export interface ISetupRanking {
    benchmark: IRunBenchmarkConfig;
    /** The reference row's id, when the run has a reference model. */
    referenceRowId?: string;
    /** `summarizeBenchmarkComparison` over the reference, models and pipelines. */
    summary: IBenchmarkModelSummary[];
    /**
     * How many items accuracy, cost and latency are compared on: the items
     * every setup with a result has finished, so all are ranked on the same
     * items.
     */
    comparedItems: number;
    /**
     * Rows with nothing left to run that finished fewer items than another
     * setup (a member stopped early, or ran on fewer items), so every setup
     * is compared on fewer items. Omitted when none.
     */
    finishedFewer?: string[];
    rows: ISetupRankingRow[];
}

/** One cell of the comparison's eval run. */
export interface ISetupRankingCell {
    runModelId: string;
    datasetItemId: string;
    status: string;
    costUsd: number | null;
    latencyMs: number | null;
    details?: IBenchmarkCellDetails;
}

/** One pipeline run of the comparison, with its final answers. */
export interface ISetupRankingPipeline {
    workflowRunId: string;
    workflowId: string;
    name: string;
    stepModels: string[];
    /** Items the pipeline run runs on. */
    itemCount: number;
    answers: IPipelineAnswerScore[];
}

/** One step of a saved pipeline, as the launcher shows it. */
export interface ISetupComparisonPipelineStep {
    label: string;
    modelId?: string;
    transport?: ProviderTransport;
    promptVersionId?: string;
    /** Length of the step's prompt, for the rough cost estimate. */
    promptChars?: number;
}

/** A saved pipeline the launcher offers as a candidate. */
export interface ISetupComparisonPipelineOption {
    id: string;
    name: string;
    kind: WorkflowKind;
    /** The dataset its input block reads; absent when it runs on any text dataset. */
    datasetId?: string;
    /** Model-backed steps, in the order they run. */
    steps: ISetupComparisonPipelineStep[];
    hasFinalAnswer: boolean;
    /** Why it can't be compared, when it can't. */
    unavailableReason?: string;
}

/**
 * A comparison's status from its member runs: running while any member is
 * pending or running (pending only while all are); otherwise cancelled
 * when any member stopped early (at the spend limit when one did), failed
 * when every member failed, partial when some failed, else completed.
 */
export function setupComparisonStatus(
    members: ReadonlyArray<{ status: RunStatus; stopReason?: RunStopReason }>,
): { status: RunStatus; stopReason?: RunStopReason } {
    if (members.length === 0) return { status: "pending" };
    const active = members.filter(
        (member) => member.status === "pending" || member.status === "running",
    );
    if (active.length > 0)
        return {
            status:
                active.every((member) => member.status === "pending") &&
                active.length === members.length
                    ? "pending"
                    : "running",
        };
    const stopped = members.filter((member) => member.status === "cancelled");
    if (stopped.length > 0)
        return {
            status: "cancelled",
            stopReason: stopped.some(
                (member) => member.stopReason === "spend_cap",
            )
                ? "spend_cap"
                : "cancelled",
        };
    if (members.every((member) => member.status === "failed"))
        return { status: "failed" };
    if (
        members.some(
            (member) =>
                member.status === "failed" || member.status === "partial",
        )
    )
        return { status: "partial" };
    return { status: "completed" };
}

interface IStepNode {
    id: string;
    label: string;
}

/**
 * A pipeline's nodes in the order they run: each node after the nodes it
 * reads from (ties keep the given order). Nodes in a cycle, which the
 * editor rejects, come last in the given order.
 */
export function pipelineStepOrder<T extends IStepNode>(
    nodes: readonly T[],
    edges: ReadonlyArray<{ fromNodeId: string; toNodeId: string }>,
): T[] {
    const incoming = new Map(nodes.map((node) => [node.id, 0]));
    for (const edge of edges)
        if (incoming.has(edge.toNodeId) && incoming.has(edge.fromNodeId))
            incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
    const ordered: T[] = [];
    const placed = new Set<string>();
    let progressed = true;
    while (progressed) {
        progressed = false;
        for (const node of nodes) {
            if (placed.has(node.id) || (incoming.get(node.id) ?? 0) > 0)
                continue;
            ordered.push(node);
            placed.add(node.id);
            progressed = true;
            for (const edge of edges)
                if (edge.fromNodeId === node.id && incoming.has(edge.toNodeId))
                    incoming.set(
                        edge.toNodeId,
                        (incoming.get(edge.toNodeId) ?? 1) - 1,
                    );
        }
    }
    return [...ordered, ...nodes.filter((node) => !placed.has(node.id))];
}

/** "Chain (model-a → model-b)": a pipeline named with its steps' models. */
export function pipelineSetupLabel(
    name: string,
    stepModels: readonly string[],
): string {
    return stepModels.length > 0 ? `${name} (${stepModels.join(" → ")})` : name;
}

/** The row id a pipeline has in a comparison's ranking. */
export function pipelineRankingId(workflowRunId: string): string {
    return `pipeline:${workflowRunId}`;
}

const ACTIVE_CELL = new Set(["pending", "running"]);
const ANSWERED_CELL = new Set(["succeeded", "cached"]);

function mean(values: Array<number | null | undefined>): number | undefined {
    const known = values.filter(
        (value): value is number => typeof value === "number",
    );
    return known.length > 0
        ? known.reduce((total, value) => total + value, 0) / known.length
        : undefined;
}

/**
 * The items every setup with a result has finished. A setup with none yet
 * (still starting, or stopped before any item) has nothing to compare and
 * does not narrow the set.
 */
function sharedItems(finishedBySetup: string[][]): Set<string> {
    const withResults = finishedBySetup.filter((items) => items.length > 0);
    const [first, ...rest] = withResults.map((items) => new Set(items));
    if (!first) return new Set();
    return new Set(
        [...first].filter((item) => rest.every((items) => items.has(item))),
    );
}

/**
 * A setup's accuracy, for ranking: the mean of its task results as the task
 * grid shows them (agreement, or the won-or-tied rate for judged tasks). The
 * reference counts as 100% on each task compared with its own answers: it
 * is the yardstick there.
 */
export function setupAccuracy(
    row: IBenchmarkModelSummary,
    benchmark: IRunBenchmarkConfig,
): number | undefined {
    const values = benchmark.taskMap.tasks.flatMap((task) => {
        const value = row.tasks.find((t) => t.key === task.key)?.assessment
            .value;
        if (value !== undefined) return [value];
        const ownYardstick =
            row.isBenchmark && benchmarkTaskSource(task, benchmark) === "model";
        return ownYardstick ? [1] : [];
    });
    return mean(values);
}

/**
 * Marks the setups no other setup beats on both accuracy and cost: a setup
 * is beaten when another is at least as accurate and costs no more per
 * call, and is better on one of the two. Setups without both numbers are
 * never marked.
 */
export function markNotBeaten<
    T extends { accuracy?: number; costPerCall?: number },
>(rows: readonly T[]): Array<T & { notBeaten: boolean }> {
    const comparable = rows.filter(
        (row) => row.accuracy !== undefined && row.costPerCall !== undefined,
    );
    return rows.map((row) => {
        if (row.accuracy === undefined || row.costPerCall === undefined)
            return { ...row, notBeaten: false };
        const beaten = comparable.some(
            (other) =>
                other !== row &&
                other.accuracy! >= row.accuracy! &&
                other.costPerCall! <= row.costPerCall! &&
                (other.accuracy! > row.accuracy! ||
                    other.costPerCall! < row.costPerCall!),
        );
        return { ...row, notBeaten: !beaten };
    });
}

/**
 * Every setup of a comparison in one table: the eval run's reference and
 * single models and each pipeline as a candidate, all summarised by one
 * `summarizeBenchmarkComparison` call over the eval run's cells and the
 * pipelines' scored final answers (the verdict code eval runs use,
 * unchanged). Pipelines count only items the eval run has; a failed answer
 * counts as a failure and an answer not scored yet is left out, like a
 * running cell. Accuracy, cost and latency use only the items every setup
 * with a result has finished, so setups that have finished different items
 * are never ranked against each other on different items.
 */
export function summarizeSetupComparison(input: {
    benchmark: IRunBenchmarkConfig;
    evalRunId: string;
    /** Items with a stored answer, when a task uses them. */
    labeledItemIds?: string[];
    runModels: Array<{ id: string; modelId: string; isReference: boolean }>;
    cells: ISetupRankingCell[];
    pipelines: ISetupRankingPipeline[];
}): ISetupRanking {
    const { benchmark } = input;
    const evalItems = new Set(input.cells.map((cell) => cell.datasetItemId));
    const finished = input.cells.filter(
        (cell) => !ACTIVE_CELL.has(cell.status),
    );
    const pipelineAnswers = input.pipelines.map((pipeline) => ({
        pipeline,
        id: pipelineRankingId(pipeline.workflowRunId),
        answers: pipeline.answers.filter((answer) =>
            evalItems.has(answer.datasetItemId),
        ),
    }));
    const finishedAnswers = pipelineAnswers.map(({ id, answers }) => ({
        id,
        answers: answers.filter(
            (answer) => answer.status === "failed" || answer.scored,
        ),
    }));
    const shared = sharedItems([
        ...input.runModels.map((model) =>
            finished
                .filter((cell) => cell.runModelId === model.id)
                .map((cell) => cell.datasetItemId),
        ),
        ...finishedAnswers.map(({ answers }) =>
            answers.map((answer) => answer.datasetItemId),
        ),
    ]);
    const onShared = <T extends { datasetItemId: string }>(rows: T[]) =>
        rows.filter((row) => shared.has(row.datasetItemId));
    const cells: IBenchmarkCellInput[] = [
        ...onShared(finished).map((cell) => ({
            runModelId: cell.runModelId,
            datasetItemId: cell.datasetItemId,
            succeeded: ANSWERED_CELL.has(cell.status),
            costUsd: cell.costUsd,
            latencyMs: cell.latencyMs,
            ...(cell.details ? { details: cell.details } : {}),
        })),
        ...finishedAnswers.flatMap(({ id, answers }) =>
            onShared(answers).map((answer) => ({
                runModelId: id,
                datasetItemId: answer.datasetItemId,
                succeeded: answer.status === "complete",
                costUsd: answer.costUsd ?? null,
                latencyMs: answer.latencyMs ?? null,
                ...(answer.details ? { details: answer.details } : {}),
            })),
        ),
    ];
    const summary = summarizeBenchmarkComparison({
        taskMap: benchmark.taskMap,
        policy: benchmark.policy,
        source: benchmark.source ?? "model",
        ...(benchmarkUsesSource(benchmark, "labels")
            ? {
                  labeledItemIds: (input.labeledItemIds ?? []).filter((id) =>
                      shared.has(id),
                  ),
              }
            : {}),
        models: [
            ...input.runModels.map((model) => ({
                id: model.id,
                modelId: model.modelId,
                isBenchmark: model.isReference,
            })),
            ...pipelineAnswers.map(({ id, pipeline }) => ({
                id,
                modelId: pipeline.name,
                isBenchmark: false,
            })),
        ],
        cells,
    });
    const summaryOf = (id: string) =>
        summary.find((row) => row.runModelId === id);
    const withAccuracy = (row: IBenchmarkModelSummary | undefined) => {
        const accuracy = row ? setupAccuracy(row, benchmark) : undefined;
        return accuracy !== undefined ? { accuracy } : {};
    };
    const modelRows = input.runModels.map((model): IUnrankedRow => {
        const own = input.cells.filter((cell) => cell.runModelId === model.id);
        const done = own.filter((cell) => !ACTIVE_CELL.has(cell.status));
        const row = summaryOf(model.id);
        const compared = onShared(done);
        const costPerCall = mean(compared.map((cell) => cell.costUsd));
        const latencyMs = mean(compared.map((cell) => cell.latencyMs));
        return {
            id: model.id,
            kind: model.isReference ? "reference" : "model",
            name: model.modelId,
            runId: input.evalRunId,
            ...(costPerCall !== undefined ? { costPerCall } : {}),
            ...(latencyMs !== undefined ? { latencyMs } : {}),
            scoredItems: done.filter((cell) => ANSWERED_CELL.has(cell.status))
                .length,
            waitingItems: own.length - done.length,
            failedItems: done.filter((cell) => cell.status === "failed").length,
            comparedScoredItems: compared.filter((cell) =>
                ANSWERED_CELL.has(cell.status),
            ).length,
            comparedFailedItems: compared.filter(
                (cell) => !ANSWERED_CELL.has(cell.status),
            ).length,
            finishedItems: done.length,
            ...withAccuracy(row),
            ...(row ? { summary: row } : {}),
        };
    });
    const pipelineRows = pipelineAnswers.map(
        ({ id, pipeline, answers }): IUnrankedRow => {
            const row = summaryOf(id);
            const scored = answers.filter(
                (answer) => answer.status === "complete" && answer.scored,
            ).length;
            const failed = answers.filter(
                (answer) => answer.status === "failed",
            ).length;
            const compared = onShared(
                finishedAnswers.find((entry) => entry.id === id)?.answers ?? [],
            );
            const costPerCall = mean(compared.map((answer) => answer.costUsd));
            const latencyMs = mean(compared.map((answer) => answer.latencyMs));
            return {
                id,
                kind: "pipeline",
                name: pipeline.name,
                stepModels: pipeline.stepModels,
                runId: pipeline.workflowRunId,
                workflowId: pipeline.workflowId,
                ...(costPerCall !== undefined ? { costPerCall } : {}),
                ...(latencyMs !== undefined ? { latencyMs } : {}),
                scoredItems: scored,
                waitingItems: Math.max(
                    0,
                    Math.min(pipeline.itemCount, evalItems.size) -
                        scored -
                        failed,
                ),
                failedItems: failed,
                comparedScoredItems: compared.filter(
                    (answer) => answer.status === "complete",
                ).length,
                comparedFailedItems: compared.filter(
                    (answer) => answer.status === "failed",
                ).length,
                finishedItems: scored + failed,
                ...withAccuracy(row),
                ...(row ? { summary: row } : {}),
            };
        },
    );
    const reference = input.runModels.find((model) => model.isReference);
    const unranked = [...modelRows, ...pipelineRows];
    const mostFinished = Math.max(
        0,
        ...unranked.map((row) => row.finishedItems),
    );
    const finishedFewer = unranked
        .filter(
            (row) =>
                row.waitingItems === 0 &&
                row.finishedItems > 0 &&
                row.finishedItems < mostFinished,
        )
        .map((row) => row.id);
    return {
        benchmark,
        ...(reference ? { referenceRowId: reference.id } : {}),
        summary,
        comparedItems: shared.size,
        ...(finishedFewer.length > 0 ? { finishedFewer } : {}),
        rows: markNotBeaten(
            unranked.map(({ finishedItems: _finished, ...row }) => row),
        ),
    };
}

/** A row before ranking, with how many items it finished. */
type IUnrankedRow = Omit<ISetupRankingRow, "notBeaten"> & {
    finishedItems: number;
};
