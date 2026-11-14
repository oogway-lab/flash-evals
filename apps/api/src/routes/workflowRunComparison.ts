import {
    benchmarkUsesSource,
    combineDataPolicies,
    PIPELINE_COMPARABLE_RUN_STATUSES,
    summarizePipelineComparison,
    taskMapNeedsJudge,
    type IBenchmarkCellDetails,
    type IPipelineComparison,
    type IPipelineComparisonConfig,
    type IPipelineComparisonRunOption,
    type IRunBenchmarkConfig,
    type IRunConfigSnapshot,
    type IRunDataPolicy,
    type IWorkflowRunAnswer,
    type IWorkflowRunConfig,
    type RunStatus,
} from "@flash-evals/api-contract";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiBadRequestError } from "../errors.js";
import { RUN_NOTE_TITLE_SQL } from "./runNoteTitle.js";
import { validateRunDataPolicy } from "./runs/creation.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface IComparableRunRow {
    id: string;
    datasetId: string;
    status: RunStatus;
    createdAt: Date | string;
    configSnapshot: IRunConfigSnapshot | null;
    noteTitle: string | null;
    referenceRunModelId: string | null;
    referenceModelId: string | null;
}

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

function hasTasks(
    benchmark: IRunBenchmarkConfig | undefined,
): benchmark is IRunBenchmarkConfig {
    return Array.isArray(benchmark?.taskMap?.tasks);
}

/**
 * Why a run can't be compared with, or undefined when it can: it must have
 * finished with results (completed, or partial: every cell ran and failed
 * cells count as failures, as on its own page), have a benchmark Task Map,
 * and have a reference model when a task compares with it.
 */
function whyNotComparable(
    row: IComparableRunRow,
    sameComparison = false,
): string | undefined {
    if (
        !sameComparison &&
        !PIPELINE_COMPARABLE_RUN_STATUSES.includes(row.status)
    )
        return "That run hasn't finished. Choose a completed run.";
    const benchmark = row.configSnapshot?.benchmark;
    if (!hasTasks(benchmark))
        return "That run has no benchmark Task Map. Choose a run that was compared with a reference model or stored answers.";
    if (benchmarkUsesSource(benchmark, "model") && !row.referenceRunModelId)
        return "That run has no reference model to compare with.";
    return undefined;
}

const COMPARABLE_RUNS_SQL = `select r.id,
        r.dataset_id as "datasetId",
        r.status,
        r.created_at as "createdAt",
        r.config_snapshot as "configSnapshot",
        ${RUN_NOTE_TITLE_SQL} as "noteTitle",
        rm.id as "referenceRunModelId",
        rm.model_id as "referenceModelId"
    from runs r
    left join lateral (
        select id, model_id from run_models
        where run_id = r.id and is_reference
        order by id limit 1
    ) rm on true
    where r.team_id = $1 and r.project_id = $2`;

/**
 * Eval runs a pipeline run can be compared with, newest first: finished,
 * with a benchmark Task Map, on the dataset when one is given.
 */
export async function listPipelineComparisonRunsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    datasetId?: string,
): Promise<IPipelineComparisonRunOption[]> {
    if (datasetId !== undefined && !UUID.test(datasetId)) return [];
    const rows = (
        await db.query<IComparableRunRow>(
            `${COMPARABLE_RUNS_SQL}
              and r.status = any($3::run_status[])
              and r.config_snapshot ? 'benchmark'
              and ($4::uuid is null or r.dataset_id = $4)
            order by r.created_at desc
            limit 50`,
            [
                teamId,
                projectId,
                [...PIPELINE_COMPARABLE_RUN_STATUSES],
                datasetId ?? null,
            ],
        )
    ).rows;
    return rows
        .filter((row) => whyNotComparable(row) === undefined)
        .map((row) => ({
            id: row.id,
            datasetId: row.datasetId,
            status: row.status,
            createdAt: iso(row.createdAt),
            ...(row.noteTitle ? { noteTitle: row.noteTitle } : {}),
            ...(row.referenceModelId
                ? { referenceModelId: row.referenceModelId }
                : {}),
            taskCount: row.configSnapshot?.benchmark?.taskMap.tasks.length ?? 0,
        }));
}

/**
 * Checks the eval run a new pipeline run is to be compared with and
 * captures what the comparison needs from it, unchanged: its benchmark
 * settings (Task Map, policy, source, judge), reference model, data rules
 * and output-token budget. The judge calls follow that run's data rules;
 * when the pipeline run has rules too, they must satisfy both (hosts both
 * allow, every retention and training rule either sets).
 */
export async function pipelineComparisonFor(
    db: IDb,
    input: {
        teamId: string;
        projectId: string;
        datasetId: string;
        compareWithRunId: unknown;
        hasFinalAnswer: boolean;
        pipelineDataPolicy: IRunDataPolicy | undefined;
        /**
         * The eval run belongs to the same setup comparison and was just
         * created: it hasn't finished, and the pipeline's scoring waits.
         */
        sameComparison?: boolean;
    },
    config?: Pick<IApiConfig, "flashEvalsLlmProvider">,
): Promise<IPipelineComparisonConfig> {
    const runId = input.compareWithRunId;
    if (typeof runId !== "string" || !UUID.test(runId))
        throw new ApiBadRequestError("compareWithRunId must be a run ID.");
    if (!input.hasFinalAnswer)
        throw new ApiBadRequestError(
            "compareWithRunId: This pipeline has no final answer, so there is nothing to compare. Add a final answer under the canvas and save it first.",
        );
    const row = (
        await db.query<IComparableRunRow>(
            `${COMPARABLE_RUNS_SQL} and r.id = $3 for share of r`,
            [input.teamId, input.projectId, runId],
        )
    ).rows[0];
    if (!row)
        throw new ApiBadRequestError(
            "compareWithRunId: That run isn't in this project.",
        );
    if (row.datasetId !== input.datasetId)
        throw new ApiBadRequestError(
            "compareWithRunId: That run used a different dataset. Choose a run on the dataset this pipeline reads.",
        );
    const reason = whyNotComparable(row, input.sameComparison);
    if (reason) throw new ApiBadRequestError(`compareWithRunId: ${reason}`);
    const snapshot = row.configSnapshot!;
    const benchmark = snapshot.benchmark!;
    const judgeDataPolicy = combineDataPolicies(
        snapshot.dataPolicy,
        input.pipelineDataPolicy,
    );
    if (judgeDataPolicy?.onlyHosts?.length === 0)
        throw new ApiBadRequestError(
            "dataPolicy: The pipeline run's allowed hosts and the compared run's allowed hosts have none in common, so no host could serve the judge. Allow a host both lists share.",
        );
    if (
        judgeDataPolicy &&
        benchmark.judge &&
        taskMapNeedsJudge(benchmark.taskMap)
    )
        validateRunDataPolicy(
            { models: [], benchmark, dataPolicy: judgeDataPolicy },
            config,
        );
    return {
        runId: row.id,
        benchmark,
        ...(row.referenceRunModelId
            ? {
                  referenceRunModelId: row.referenceRunModelId,
                  referenceModelId: row.referenceModelId ?? undefined,
              }
            : {}),
        ...(snapshot.dataPolicy ? { dataPolicy: snapshot.dataPolicy } : {}),
        ...(judgeDataPolicy ? { judgeDataPolicy } : {}),
        ...(typeof snapshot.maxTokens === "number"
            ? { maxTokens: snapshot.maxTokens }
            : {}),
    };
}

/**
 * The comparison on a pipeline run's page: its final answers against the
 * compared run's reference, on the items both have, summarised with the
 * same verdict code eval runs use.
 */
export async function pipelineComparisonPayload(
    db: IDb,
    input: {
        teamId: string;
        projectId: string;
        pipelineName: string;
        config: IWorkflowRunConfig | null;
        answers: IWorkflowRunAnswer[];
        /** Complete answers whose comparison score is recorded. */
        scoredItemIds: Set<string>;
    },
): Promise<IPipelineComparison | undefined> {
    const config = input.config?.comparison;
    if (!config) return undefined;
    const itemIds = input.answers.map((answer) => answer.datasetItemId);
    const [run, evalItems, referenceCells, labeled] = await Promise.all([
        db.query<{
            id: string;
            status: RunStatus;
            createdAt: Date | string;
            noteTitle: string | null;
        }>(
            `select r.id, r.status, r.created_at as "createdAt",
                    ${RUN_NOTE_TITLE_SQL} as "noteTitle"
             from runs r
             where r.id = $1 and r.team_id = $2 and r.project_id = $3`,
            [config.runId, input.teamId, input.projectId],
        ),
        db.query<{ datasetItemId: string }>(
            `select distinct dataset_item_id as "datasetItemId"
             from run_cells
             where run_id = $1 and dataset_item_id = any($2::uuid[])`,
            [config.runId, itemIds],
        ),
        config.referenceRunModelId
            ? db.query<{
                  datasetItemId: string;
                  status: string;
                  costUsd: number | string | null;
                  latencyMs: number | string | null;
                  details: unknown;
              }>(
                  `select c.dataset_item_id as "datasetItemId", c.status,
                          c.cost_usd as "costUsd", c.latency_ms as "latencyMs",
                          s.details_json as details
                   from run_cells c
                   left join cell_scores s
                     on s.run_cell_id = c.id and s.scorer_type = 'benchmark'
                   where c.run_id = $1 and c.run_model_id = $2
                     and c.dataset_item_id = any($3::uuid[])
                     and c.status not in ('pending', 'running')`,
                  [config.runId, config.referenceRunModelId, itemIds],
              )
            : Promise.resolve({ rows: [] }),
        benchmarkUsesSource(config.benchmark, "labels")
            ? db.query<{ datasetItemId: string }>(
                  `select dataset_item_id as "datasetItemId" from labels
                   where dataset_item_id = any($1::uuid[])`,
                  [itemIds],
              )
            : Promise.resolve({ rows: [] }),
    ]);
    const runRow = run.rows[0];
    return {
        run: runRow
            ? {
                  id: runRow.id,
                  status: runRow.status,
                  createdAt: iso(runRow.createdAt),
                  ...(runRow.noteTitle ? { noteTitle: runRow.noteTitle } : {}),
              }
            : { id: config.runId },
        ...summarizePipelineComparison({
            config,
            pipelineName: input.pipelineName,
            evalItemIds: evalItems.rows.map((row) => row.datasetItemId),
            labeledItemIds: labeled.rows.map((row) => row.datasetItemId),
            referenceCells: referenceCells.rows.map((cell) => {
                const details = benchmarkDetails(cell.details);
                return {
                    datasetItemId: cell.datasetItemId,
                    succeeded:
                        cell.status === "succeeded" || cell.status === "cached",
                    costUsd: numberOrNull(cell.costUsd),
                    latencyMs: numberOrNull(cell.latencyMs),
                    ...(details ? { details } : {}),
                };
            }),
            answers: input.answers.map((answer) => ({
                datasetItemId: answer.datasetItemId,
                status: answer.status,
                ...(answer.costUsd !== undefined
                    ? { costUsd: answer.costUsd }
                    : {}),
                ...(answer.latencyMs !== undefined
                    ? { latencyMs: answer.latencyMs }
                    : {}),
                scored: input.scoredItemIds.has(answer.datasetItemId),
                ...(answer.benchmarkDetails
                    ? { details: answer.benchmarkDetails }
                    : {}),
            })),
        }),
    };
}

function numberOrNull(value: number | string | null): number | null {
    return value === null ? null : Number(value);
}

function benchmarkDetails(value: unknown): IBenchmarkCellDetails | undefined {
    return value &&
        typeof value === "object" &&
        Array.isArray((value as { tasks?: unknown }).tasks)
        ? (value as IBenchmarkCellDetails)
        : undefined;
}
