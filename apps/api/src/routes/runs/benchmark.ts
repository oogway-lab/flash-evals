import {
    benchmarkUsesSource,
    summarizeBenchmarkComparison,
    taskMapNeedsJudge,
    validateTaskMap,
    type IBenchmarkCellDetails,
    type IBenchmarkModelSummary,
    type ICreateRunRequest,
    type IJsonSchemaObject,
    type IMatrixCellScore,
    type IRunBenchmarkConfig,
    type IRunDetailCell,
    type IRunDetailModel,
} from "@flash-evals/api-contract";
import { rulePatternEngineErrors } from "@flash-evals/api-contract/rule-patterns";
import { ApiBadRequestError } from "../../errors.js";
import { BenchmarkConfig } from "../../mcp/schemas.js";
import { registryModelFor } from "../../modelRegistry.js";
import { assertModelMapsToTransport } from "./modelTransport.js";

/**
 * Checks a run's benchmark settings before anything is written. The schema
 * check runs only when the caller knows the output schema (run creation from
 * a selection); the raw create-run path still gets every other check.
 */
export function validateRunBenchmark(
    input: Pick<ICreateRunRequest, "models" | "benchmark" | "audioRunMode">,
    outputSchema?: IJsonSchemaObject,
    options: { allowReferenceOnly?: boolean } = {},
): void {
    if (!input.benchmark) return;
    // The HTTP route receives untyped JSON. Prefer the specific messages
    // below; fall back to the schema's message when the input is too
    // malformed for them to run, or when only the schema catches it.
    const shape = BenchmarkConfig.safeParse(input.benchmark);
    if (shape.success) return checkBenchmark(input, outputSchema, options);
    try {
        checkBenchmark(input, outputSchema, options);
    } catch (error) {
        if (error instanceof ApiBadRequestError) throw error;
    }
    const issue = shape.error.issues[0]!;
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw new ApiBadRequestError(`benchmark: ${where}${issue.message}`);
}

function checkBenchmark(
    input: Pick<ICreateRunRequest, "models" | "benchmark" | "audioRunMode">,
    outputSchema: IJsonSchemaObject | undefined,
    options: { allowReferenceOnly?: boolean },
): void {
    const benchmark = input.benchmark;
    if (!benchmark) return;
    if (input.audioRunMode === "stt_metrics")
        throw new ApiBadRequestError(
            "benchmark: Speech-to-text metric runs cannot be compared with a benchmark.",
        );
    if (needsBenchmarkModel(benchmark)) {
        if (!input.models.some((model) => model.isReference))
            throw new ApiBadRequestError(
                "benchmark: Choose a reference model to act as the benchmark.",
            );
        // A setup comparison whose candidates are all pipelines runs the
        // reference alone; the pipelines are compared with it.
        if (input.models.length < 2 && !options.allowReferenceOnly)
            throw new ApiBadRequestError(
                "benchmark: Add at least one model to compare with the benchmark.",
            );
    }
    const errors = [
        ...validateTaskMap(benchmark.taskMap, outputSchema),
        ...rulePatternEngineErrors(benchmark.taskMap),
    ];
    if (errors.length > 0)
        throw new ApiBadRequestError(`benchmark: ${errors[0]}`);
    if (taskMapNeedsJudge(benchmark.taskMap) && !benchmark.judge?.modelId)
        throw new ApiBadRequestError(
            "benchmark: Choose a judge model for the head-to-head tasks.",
        );
    validatePolicy(benchmark);
    const judge = benchmark.judge;
    if (!judge) return;
    const entry = registryModelFor(judge.modelId);
    if (judge.transport)
        assertModelMapsToTransport(judge.modelId, judge.transport, {
            prefix: "benchmark: ",
        });
    if (entry && (!entry.judgeSuitable || !entry.structuredOutput))
        throw new ApiBadRequestError(
            `benchmark: ${entry.label} cannot be used as a judge model.`,
        );
}

/**
 * True when any task uses the benchmark model's answers. With stored answers
 * as every task's benchmark, a reference model is only the leaderboard's
 * baseline and is scored like every other model. A Task Map too malformed
 * to read falls back to the run's source.
 */
function needsBenchmarkModel(benchmark: IRunBenchmarkConfig): boolean {
    return Array.isArray(benchmark.taskMap?.tasks)
        ? benchmarkUsesSource(benchmark, "model")
        : benchmark.source !== "labels";
}

function validatePolicy(benchmark: IRunBenchmarkConfig): void {
    const policy = benchmark.policy;
    if (!policy) return;
    const rates: Array<[string, number | undefined]> = [
        ["minAgreement", policy.minAgreement],
        ["minWinOrTieRate", policy.minWinOrTieRate],
        ["maxDropBelowReference", policy.maxDropBelowReference],
        ...Object.entries(policy.tasks ?? {}).flatMap(
            ([key, task]): Array<[string, number | undefined]> => [
                [`tasks.${key}.minAgreement`, task.minAgreement],
                [`tasks.${key}.minWinOrTieRate`, task.minWinOrTieRate],
                [
                    `tasks.${key}.maxDropBelowReference`,
                    task.maxDropBelowReference,
                ],
            ],
        ),
    ];
    for (const [name, value] of rates) {
        if (value !== undefined && !(value >= 0 && value <= 1))
            throw new ApiBadRequestError(
                `benchmark: policy.${name} must be between 0 and 1.`,
            );
    }
    const keys = new Set(benchmark.taskMap.tasks.map((task) => task.key));
    for (const key of Object.keys(policy.tasks ?? {})) {
        if (!keys.has(key))
            throw new ApiBadRequestError(
                `benchmark: policy.tasks has "${key}", which is not a task.`,
            );
    }
    if (policy.maxRelativeCost !== undefined && !(policy.maxRelativeCost > 0))
        throw new ApiBadRequestError(
            "benchmark: policy.maxRelativeCost must be above 0.",
        );
}

/** The comparison table for a benchmark run, built from its stored scores. */
export function benchmarkComparisonForRun(input: {
    benchmark: IRunBenchmarkConfig | undefined;
    /** Items with a stored answer; used when any task's benchmark is "labels". */
    labeledItemIds?: string[];
    models: IRunDetailModel[];
    cells: IRunDetailCell[];
    scoresByCell: Record<string, IMatrixCellScore[]>;
}): IBenchmarkModelSummary[] | undefined {
    if (!input.benchmark) return undefined;
    return summarizeBenchmarkComparison({
        taskMap: input.benchmark.taskMap,
        policy: input.benchmark.policy,
        source: input.benchmark.source ?? "model",
        ...(benchmarkUsesSource(input.benchmark, "labels")
            ? { labeledItemIds: input.labeledItemIds ?? [] }
            : {}),
        models: input.models.map((model) => ({
            id: model.id,
            modelId: model.modelId,
            isBenchmark: model.isReference,
        })),
        // Cells still running are left out so they do not count as failures.
        cells: input.cells
            .filter(
                (cell) =>
                    cell.status !== "pending" && cell.status !== "running",
            )
            .map((cell) => ({
                runModelId: cell.runModelId,
                datasetItemId: cell.datasetItemId,
                succeeded:
                    cell.status === "succeeded" || cell.status === "cached",
                costUsd: cell.costUsd,
                latencyMs: cell.latencyMs,
                details: benchmarkDetails(input.scoresByCell[cell.id]),
                // What the cell was charged, every scoring pass included.
                ...(cell.judgeCostUsd !== undefined
                    ? { judgeCostUsd: cell.judgeCostUsd }
                    : {}),
            })),
    });
}

function benchmarkDetails(
    scores: IMatrixCellScore[] | undefined,
): IBenchmarkCellDetails | undefined {
    const details = scores?.find(
        (score) => score.scorerType === "benchmark",
    )?.detailsJson;
    if (
        details &&
        typeof details === "object" &&
        Array.isArray((details as { tasks?: unknown }).tasks)
    )
        return details as IBenchmarkCellDetails;
    return undefined;
}
