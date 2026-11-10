import {
    benchmarkUsesSource,
    summarizeBenchmarkComparison,
    type IBenchmarkCellDetails,
    type IBenchmarkCellInput,
    type IBenchmarkModelSummary,
    type IRunBenchmarkConfig,
} from "./benchmark.js";
import type { IRunDataPolicy, RunStatus } from "./index.js";

/**
 * Comparing a pipeline run with an eval run's reference: the pipeline is one
 * candidate, scored item by item on its final answers with the eval run's
 * Task Map, policy, yardsticks and judge, so it faces exactly the same test
 * as the models in that run.
 */

/** The run model id the pipeline's row has in the comparison summary. */
export const PIPELINE_COMPARISON_MODEL_ID = "pipeline";

/** Eval run statuses a pipeline can be compared with: finished with results. */
export const PIPELINE_COMPARABLE_RUN_STATUSES: readonly RunStatus[] = [
    "completed",
    "partial",
];

/**
 * What a pipeline run captures from the chosen eval run when it is created,
 * so later edits to that run never change the test.
 */
export interface IPipelineComparisonConfig {
    /** The eval run compared with. */
    runId: string;
    /** That run's benchmark settings, unchanged: Task Map, policy, source, judge. */
    benchmark: IRunBenchmarkConfig;
    /** That run's reference run model, when it has one. */
    referenceRunModelId?: string;
    referenceModelId?: string;
    /** That run's data rules. */
    dataPolicy?: IRunDataPolicy;
    /**
     * The rules the judge calls follow: that run's rules, made stricter by
     * the pipeline run's own (see `combineDataPolicies`).
     */
    judgeDataPolicy?: IRunDataPolicy;
    /** That run's output-token budget, which the judge calls use too. */
    maxTokens?: number;
}

/** An eval run the launcher offers to compare a pipeline with. */
export interface IPipelineComparisonRunOption {
    id: string;
    datasetId: string;
    status: RunStatus;
    createdAt: string;
    /** First line of the run's note, when it has one. */
    noteTitle?: string;
    referenceModelId?: string;
    taskCount: number;
}

/** The comparison shown on a pipeline run that was compared with an eval run. */
export interface IPipelineComparison {
    /** The eval run; only its id when it has since been deleted. */
    run: {
        id: string;
        status?: RunStatus;
        createdAt?: string;
        noteTitle?: string;
    };
    benchmark: IRunBenchmarkConfig;
    referenceRunModelId?: string;
    referenceModelId?: string;
    /** The pipeline's row id in `summary`. */
    pipelineRunModelId: string;
    /** The reference and the pipeline, from `summarizeBenchmarkComparison`. */
    summary: IBenchmarkModelSummary[];
    /**
     * Mean cost of one item (the sum of its steps), on the compared items,
     * failed ones included.
     */
    pipelineCostPerItem?: number;
    /** The reference's mean cost of one item on the same items, failed ones included. */
    referenceCostPerItem?: number;
    /** Mean latency of one item on the compared items, failed ones included. */
    pipelineLatencyMs?: number;
    /** The reference's mean latency on the same items, failed ones included. */
    referenceLatencyMs?: number;
    /** Items compared, failed ones included. */
    comparedItems: number;
    /** Compared items whose pipeline answer failed. */
    failedItems: number;
    /** Final answers recorded but not scored yet. */
    unscoredItems: number;
    judgeDataPolicy?: IRunDataPolicy;
}

/**
 * Data rules that satisfy both a and b: allowed hosts are the hosts both
 * allow (either list alone when only one has one), and no-retention and
 * no-training apply when either asks. `onlyHosts` comes back empty when
 * both lists are set and share no host: nothing can serve such a call.
 */
export function combineDataPolicies(
    a: IRunDataPolicy | undefined,
    b: IRunDataPolicy | undefined,
): IRunDataPolicy | undefined {
    if (!a) return b;
    if (!b) return a;
    const hostsA = a.onlyHosts?.length ? a.onlyHosts : undefined;
    const hostsB = b.onlyHosts?.length ? b.onlyHosts : undefined;
    const onlyHosts =
        hostsA && hostsB
            ? hostsA.filter((host) => hostsB.includes(host))
            : (hostsA ?? hostsB);
    return {
        ...(onlyHosts ? { onlyHosts } : {}),
        ...(a.zeroDataRetention || b.zeroDataRetention
            ? { zeroDataRetention: true }
            : {}),
        ...(a.disallowPromptTraining || b.disallowPromptTraining
            ? { disallowPromptTraining: true }
            : {}),
    };
}

/** One of the reference model's cells in the chosen eval run. */
export interface IPipelineReferenceCell {
    datasetItemId: string;
    succeeded: boolean;
    costUsd: number | null;
    latencyMs: number | null;
    /** Its stored benchmark details, where it is scored itself. */
    details?: IBenchmarkCellDetails;
}

/** One item's final answer in the pipeline run, with its scoring. */
export interface IPipelineAnswerScore {
    datasetItemId: string;
    status: "complete" | "failed";
    costUsd?: number;
    latencyMs?: number;
    /** False while a complete answer waits to be scored. */
    scored: boolean;
    details?: IBenchmarkCellDetails;
}

function mean(values: number[]): number | undefined {
    return values.length > 0
        ? values.reduce((total, value) => total + value, 0) / values.length
        : undefined;
}

function known(values: Array<number | null | undefined>): number[] {
    return values.filter((value): value is number => typeof value === "number");
}

/**
 * The pipeline against the eval run's reference, item by item on the items
 * both have: the eval run's items where the pipeline recorded a final
 * answer. A failed answer counts as a failure, as a failed eval cell does;
 * a complete answer not scored yet is left out, like a running cell.
 */
export function summarizePipelineComparison(input: {
    config: IPipelineComparisonConfig;
    pipelineName: string;
    /** Items the chosen eval run has. */
    evalItemIds: string[];
    /** Items with a stored answer, when a task uses them. */
    labeledItemIds?: string[];
    referenceCells: IPipelineReferenceCell[];
    answers: IPipelineAnswerScore[];
}): Omit<IPipelineComparison, "run"> {
    const { config } = input;
    const evalItems = new Set(input.evalItemIds);
    const shared = input.answers.filter(
        (answer) =>
            evalItems.has(answer.datasetItemId) &&
            (answer.status === "failed" || answer.scored),
    );
    const sharedItems = new Set(shared.map((answer) => answer.datasetItemId));
    const referenceCells = input.referenceCells.filter((cell) =>
        sharedItems.has(cell.datasetItemId),
    );
    const referenceId = config.referenceRunModelId;
    const cells: IBenchmarkCellInput[] = [
        ...(referenceId
            ? referenceCells.map((cell) => ({
                  runModelId: referenceId,
                  datasetItemId: cell.datasetItemId,
                  succeeded: cell.succeeded,
                  costUsd: cell.costUsd,
                  latencyMs: cell.latencyMs,
                  ...(cell.details ? { details: cell.details } : {}),
              }))
            : []),
        ...shared.map((answer) => ({
            runModelId: PIPELINE_COMPARISON_MODEL_ID,
            datasetItemId: answer.datasetItemId,
            succeeded: answer.status === "complete",
            costUsd: answer.costUsd ?? null,
            latencyMs: answer.latencyMs ?? null,
            ...(answer.details ? { details: answer.details } : {}),
        })),
    ];
    const summary = summarizeBenchmarkComparison({
        taskMap: config.benchmark.taskMap,
        policy: config.benchmark.policy,
        source: config.benchmark.source ?? "model",
        ...(benchmarkUsesSource(config.benchmark, "labels")
            ? {
                  labeledItemIds: (input.labeledItemIds ?? []).filter((id) =>
                      sharedItems.has(id),
                  ),
              }
            : {}),
        models: [
            ...(referenceId
                ? [
                      {
                          id: referenceId,
                          modelId: config.referenceModelId ?? referenceId,
                          isBenchmark: true,
                      },
                  ]
                : []),
            {
                id: PIPELINE_COMPARISON_MODEL_ID,
                modelId: input.pipelineName,
                isBenchmark: false,
            },
        ],
        cells,
    });
    // Both sides average every compared item, failed ones included (a
    // failed call can still cost), so the two numbers cover the same items.
    const pipelineCostPerItem = mean(known(shared.map((a) => a.costUsd)));
    const referenceCostPerItem = mean(
        known(referenceCells.map((cell) => cell.costUsd)),
    );
    const pipelineLatencyMs = mean(known(shared.map((a) => a.latencyMs)));
    const referenceLatencyMs = mean(
        known(referenceCells.map((cell) => cell.latencyMs)),
    );
    return {
        benchmark: config.benchmark,
        ...(referenceId ? { referenceRunModelId: referenceId } : {}),
        ...(config.referenceModelId
            ? { referenceModelId: config.referenceModelId }
            : {}),
        pipelineRunModelId: PIPELINE_COMPARISON_MODEL_ID,
        summary,
        ...(pipelineCostPerItem !== undefined ? { pipelineCostPerItem } : {}),
        ...(referenceCostPerItem !== undefined ? { referenceCostPerItem } : {}),
        ...(pipelineLatencyMs !== undefined ? { pipelineLatencyMs } : {}),
        ...(referenceLatencyMs !== undefined ? { referenceLatencyMs } : {}),
        comparedItems: shared.length,
        failedItems: shared.filter((answer) => answer.status === "failed")
            .length,
        unscoredItems: input.answers.filter(
            (answer) =>
                evalItems.has(answer.datasetItemId) &&
                answer.status === "complete" &&
                !answer.scored,
        ).length,
        ...(config.judgeDataPolicy
            ? { judgeDataPolicy: config.judgeDataPolicy }
            : {}),
    };
}
