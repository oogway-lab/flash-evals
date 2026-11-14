import { createHash } from "node:crypto";
import {
    benchmarkUsesSource,
    canonicalJsonString,
    summarizeSetupComparison,
    type IBenchmarkCellDetails,
    type IRunConfigSnapshot,
    type ISetupRanking,
    isProviderTransport,
    MAX_SETUP_COMPARISON_PIPELINES,
    pipelineStepOrder,
    setupComparisonStatus,
    type ICancelSetupComparisonRequest,
    type ICancelSetupComparisonResponse,
    type ICreateSetupComparisonRequest,
    type ICreateSetupComparisonResponse,
    type IPipelineFinalAnswer,
    type ISetupComparison,
    type ISetupComparisonConfig,
    type ISetupComparisonMember,
    type ISetupComparisonPipelineOption,
    type ISetupComparisonPipelineStep,
    type RunStatus,
    type RunStopReason,
    type WorkflowKind,
} from "@flash-evals/api-contract";
import type { IApiConfig } from "../config.js";
import { withTransaction, type IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiError,
    ApiFieldValidationError,
    ApiNotFoundError,
} from "../errors.js";
import { publishRunEnqueue } from "../runEnqueue.js";
import { publishWorkflowRunEnqueue } from "../workflowRunEnqueue.js";
import { createRunFromSelectionInTransaction } from "./runs/creation.js";
import { cancelRunPayload } from "./runs/lifecycle.js";
import { cancelWorkflowRunPayload } from "./workflowRunRetry.js";
import { createWorkflowRunInTransaction } from "./workflowRuns.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The member-run creators; replaced in tests. */
export interface ISetupComparisonCreators {
    createEvalRun: typeof createRunFromSelectionInTransaction;
    createPipelineRun: typeof createWorkflowRunInTransaction;
}

const creators: ISetupComparisonCreators = {
    createEvalRun: createRunFromSelectionInTransaction,
    createPipelineRun: createWorkflowRunInTransaction,
};

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

function validatePipelineIds(value: unknown): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value))
        throw new ApiBadRequestError(
            "pipelineIds must be a list of pipeline IDs.",
        );
    for (const id of value)
        if (typeof id !== "string" || !UUID.test(id))
            throw new ApiBadRequestError(
                "pipelineIds must be a list of pipeline IDs.",
            );
    if (new Set(value).size !== value.length)
        throw new ApiBadRequestError(
            "pipelineIds: Each pipeline can be chosen once.",
        );
    if (value.length > MAX_SETUP_COMPARISON_PIPELINES)
        throw new ApiBadRequestError(
            `pipelineIds: Compare at most ${MAX_SETUP_COMPARISON_PIPELINES} pipelines at once.`,
        );
    return value as string[];
}

/**
 * Checks what a comparison needs before anything is written: today's model
 * as the reference, a benchmark Task Map to score every setup with, and at
 * least one candidate (a model other than the reference, or a pipeline).
 */
function validateComparisonShape(
    input: ICreateSetupComparisonRequest,
    pipelineIds: string[],
): void {
    if (
        !input.referenceModel ||
        !input.modelIds?.includes(input.referenceModel)
    )
        throw new ApiBadRequestError(
            "referenceModel: Choose the model you use today as the reference.",
        );
    if (!input.benchmark)
        throw new ApiBadRequestError(
            "benchmark: A comparison needs a Task Map to score every setup with.",
        );
    const models = input.modelIds.filter(
        (modelId) => modelId !== input.referenceModel,
    );
    if (models.length + pipelineIds.length === 0)
        throw new ApiBadRequestError(
            "Add at least one model or pipeline to compare with the reference.",
        );
}

function comparisonFingerprint(
    input: ICreateSetupComparisonRequest,
    key: string,
): string {
    return createHash("sha256")
        .update(canonicalJsonString({ ...input, idempotencyKey: key }))
        .digest("hex");
}

function normalizeKey(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim() || value.trim().length > 200)
        throw new ApiFieldValidationError(
            "Comparison idempotency key must contain 1 to 200 characters.",
            "idempotencyKey",
            "Provide a stable retry key or omit idempotencyKey.",
        );
    return value.trim();
}

/** A member's error, named with the pipeline it came from. */
function pipelineError(name: string, error: unknown): unknown {
    const prefix = `Pipeline "${name}": `;
    if (error instanceof ApiNotFoundError)
        return new ApiBadRequestError(`${prefix}${error.message}`);
    if (error instanceof ApiFieldValidationError)
        return new ApiFieldValidationError(
            `${prefix}${error.message}`,
            error.path,
            error.remediation,
        );
    if (error instanceof ApiConflictError)
        return new ApiConflictError(`${prefix}${error.message}`);
    if (error instanceof ApiError)
        return new ApiBadRequestError(`${prefix}${error.message}`);
    return error;
}

async function existingComparison(
    tx: IDb,
    input: ICreateSetupComparisonRequest,
    key: string,
    fingerprint: string,
): Promise<ICreateSetupComparisonResponse | undefined> {
    const row = (
        await tx.query<{ id: string; fingerprint: string }>(
            `select id, idempotency_fingerprint as fingerprint
             from setup_comparisons
             where team_id=$1 and project_id=$2 and created_by=$3
               and idempotency_key=$4`,
            [input.teamId, input.projectId, input.createdBy, key],
        )
    ).rows[0];
    if (!row) return undefined;
    if (row.fingerprint !== fingerprint)
        throw new ApiConflictError(
            "This comparison idempotency key was already used for a different request.",
        );
    const members = await memberIds(tx, row.id);
    return {
        setupComparisonId: row.id,
        evalRunId: members.evalRunId ?? "",
        workflowRunIds: members.workflowRunIds,
    };
}

async function memberIds(
    db: IDb,
    setupComparisonId: string,
): Promise<{ evalRunId?: string; workflowRunIds: string[] }> {
    const [evalRuns, pipelineRuns] = await Promise.all([
        db.query<{ id: string }>(
            `select id from runs where setup_comparison_id=$1
             order by created_at, id limit 1`,
            [setupComparisonId],
        ),
        db.query<{ id: string }>(
            `select id from workflow_runs where setup_comparison_id=$1
             order by created_at, id`,
            [setupComparisonId],
        ),
    ]);
    return {
        ...(evalRuns.rows[0] ? { evalRunId: evalRuns.rows[0].id } : {}),
        workflowRunIds: pipelineRuns.rows.map((row) => row.id),
    };
}

/**
 * Creates a comparison in one transaction: the comparison row, its eval
 * run (the reference and the single-model candidates) and one pipeline run
 * per chosen pipeline, compared with that eval run on its items. Every
 * member gets the comparison's spend limit and data rules; the worker
 * counts their spend together. Nothing is created when any member is
 * refused. Publish the members' queue jobs afterwards with
 * `publishSetupComparisonEnqueues`.
 */
export async function createSetupComparisonPayload(
    db: IDb,
    input: ICreateSetupComparisonRequest,
    config?: IApiConfig,
    deps: ISetupComparisonCreators = creators,
): Promise<ICreateSetupComparisonResponse> {
    const pipelineIds = validatePipelineIds(input.pipelineIds);
    validateComparisonShape(input, pipelineIds);
    const key = normalizeKey(input.idempotencyKey);
    const { pipelineIds: _pipelines, idempotencyKey: _key, ...evalRun } = input;
    return withTransaction(db, async (tx) => {
        const fingerprint = key ? comparisonFingerprint(input, key) : undefined;
        if (key && fingerprint) {
            await tx.query(
                `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
                [
                    JSON.stringify([
                        "setup-comparison",
                        input.teamId,
                        input.projectId,
                        input.createdBy,
                        key,
                    ]),
                ],
            );
            const existing = await existingComparison(
                tx,
                input,
                key,
                fingerprint,
            );
            if (existing) return existing;
        }
        const pipelines = await pipelineNames(tx, input, pipelineIds);
        const comparisonConfig: ISetupComparisonConfig = {
            ...(input.dataPolicy ? { dataPolicy: input.dataPolicy } : {}),
            pipelineIds,
        };
        const setupComparisonId = (
            await tx.query<{ id: string }>(
                `insert into setup_comparisons (
                    team_id, project_id, dataset_id, max_cost_usd, config,
                    created_by, idempotency_key, idempotency_fingerprint
                ) values ($1, $2, $3, $4, $5, $6, $7, $8)
                returning id`,
                [
                    input.teamId,
                    input.projectId,
                    input.datasetId,
                    input.maxCostUsd ?? null,
                    comparisonConfig,
                    input.createdBy,
                    key ?? null,
                    fingerprint ?? null,
                ],
            )
        ).rows[0]!.id;
        const { runId: evalRunId } = await deps.createEvalRun(
            tx,
            evalRun,
            config,
            { allowReferenceOnly: pipelineIds.length > 0 },
        );
        await tx.query(`update runs set setup_comparison_id=$2 where id=$1`, [
            evalRunId,
            setupComparisonId,
        ]);
        const itemIds = (
            await tx.query<{ datasetItemId: string }>(
                `select distinct dataset_item_id as "datasetItemId"
                 from run_cells where run_id=$1`,
                [evalRunId],
            )
        ).rows.map((row) => row.datasetItemId);
        const workflowRunIds: string[] = [];
        for (const pipeline of pipelines) {
            try {
                const created = await deps.createPipelineRun(
                    tx,
                    {
                        teamId: input.teamId,
                        projectId: input.projectId,
                        workflowId: pipeline.id,
                        datasetId: input.datasetId,
                        runTarget: "dataset",
                        createdBy: input.createdBy,
                        ...(input.maxCostUsd !== undefined
                            ? { maxCostUsd: input.maxCostUsd }
                            : {}),
                        ...(input.dataPolicy
                            ? { dataPolicy: input.dataPolicy }
                            : {}),
                        compareWithRunId: evalRunId,
                    },
                    config,
                    { setupComparisonId, itemIds },
                );
                workflowRunIds.push(created.workflowRunId);
            } catch (error) {
                throw pipelineError(pipeline.name, error);
            }
        }
        return { setupComparisonId, evalRunId, workflowRunIds };
    });
}

async function pipelineNames(
    tx: IDb,
    input: ICreateSetupComparisonRequest,
    pipelineIds: string[],
): Promise<Array<{ id: string; name: string }>> {
    if (pipelineIds.length === 0) return [];
    const rows = (
        await tx.query<{ id: string; name: string }>(
            `select id, name from prompt_workflows
             where id = any($1::uuid[]) and team_id=$2 and project_id=$3
               and archived_at is null`,
            [pipelineIds, input.teamId, input.projectId],
        )
    ).rows;
    const byId = new Map(rows.map((row) => [row.id, row]));
    return pipelineIds.map((id) => {
        const row = byId.get(id);
        if (!row)
            throw new ApiBadRequestError(
                `pipelineIds: Pipeline ${id} isn't in this project.`,
            );
        return row;
    });
}

/** Queues every member run of a newly created comparison. */
export async function publishSetupComparisonEnqueues(
    db: IDb,
    config: IApiConfig,
    created: ICreateSetupComparisonResponse,
): Promise<
    ICreateSetupComparisonResponse & {
        enqueueStatus: "pending_enqueue" | "queued";
    }
> {
    const results = await Promise.all([
        publishRunEnqueue(db, config, created.evalRunId),
        ...created.workflowRunIds.map((id) =>
            publishWorkflowRunEnqueue(db, config, id),
        ),
    ]);
    return {
        ...created,
        enqueueStatus: results.every(
            (result) => result.enqueueStatus === "queued",
        )
            ? "queued"
            : "pending_enqueue",
    };
}

interface IComparisonRow {
    id: string;
    datasetId: string;
    datasetName: string | null;
    createdAt: Date | string;
    maxCostUsd: number | string | null;
    config: ISetupComparisonConfig | null;
    cancelRequestedAt: Date | string | null;
}

interface IEvalMemberRow {
    id: string;
    configSnapshot?: IRunConfigSnapshot | null;
    status: RunStatus;
    stopReason: RunStopReason | null;
    error: string | null;
    createdAt: Date | string;
    enqueueStatus: string | null;
    pendingSince: Date | string | null;
    spent: number | string | null;
}

interface IPipelineMemberRow extends IEvalMemberRow {
    workflowId: string;
    snapshot: {
        name?: string;
        nodes?: ISnapshotNode[];
        edges?: Array<{ fromNodeId: string; toNodeId: string }>;
    } | null;
    openCells: number | string;
}

interface ISnapshotNode {
    id: string;
    label: string;
    nodeType?: string;
    modelId?: string;
    resolvedLlmExecution?: { route?: { modelId?: string } };
}

const MODEL_BACKED = new Set(["prompt", "llm_text", "transliterate", "judge"]);

function stepModelsOf(snapshot: IPipelineMemberRow["snapshot"]): string[] {
    const nodes = snapshot?.nodes ?? [];
    return pipelineStepOrder(nodes, snapshot?.edges ?? []).flatMap((node) => {
        if (!MODEL_BACKED.has(node.nodeType ?? "prompt")) return [];
        const modelId =
            node.resolvedLlmExecution?.route?.modelId ?? node.modelId;
        return modelId ? [modelId] : [];
    });
}

function enqueueStatusOf(
    value: string | null,
): ISetupComparisonMember["enqueueStatus"] {
    return value === "pending_enqueue" ||
        value === "queued" ||
        value === "failed"
        ? value
        : value === "publishing"
          ? "pending_enqueue"
          : undefined;
}

/** A pending run older than this has not been picked up by a worker. */
const UNPICKED_AFTER_MS = 60_000;

function memberFields(row: IEvalMemberRow, now: number) {
    const pendingSince =
        row.status === "pending" && row.pendingSince
            ? iso(row.pendingSince)
            : undefined;
    return {
        runId: row.id,
        status: row.status,
        ...(row.stopReason ? { stopReason: row.stopReason } : {}),
        ...(row.error ? { error: row.error } : {}),
        createdAt: iso(row.createdAt),
        ...(pendingSince ? { pendingSince } : {}),
        ...(pendingSince && now - Date.parse(pendingSince) > UNPICKED_AFTER_MS
            ? { waitingForWorker: true }
            : {}),
        ...(enqueueStatusOf(row.enqueueStatus)
            ? { enqueueStatus: enqueueStatusOf(row.enqueueStatus) }
            : {}),
    };
}

const EVAL_SPEND_SQL = `(select coalesce(sum(coalesce(incurred_cost_usd, case when status <> 'cached' then cost_usd end)), 0)
          + coalesce(sum(judge_cost_usd), 0)
     from run_cells where run_id = r.id)`;

const PIPELINE_SPEND_SQL = `((select coalesce(sum(cost_usd), 0) + coalesce(sum(judge_cost_usd), 0)
      from workflow_run_cells where workflow_run_id = w.id)
   + (select coalesce(sum(incurred_cost_usd), 0)
      from workflow_run_items where workflow_run_id = w.id)
   + (select coalesce(sum(judge_cost_usd), 0)
      from workflow_run_answers where workflow_run_id = w.id))`;

/** The comparison row and its member runs, or undefined when not found. */
async function loadComparison(
    db: IDb,
    teamId: string,
    projectId: string,
    setupComparisonId: string,
): Promise<
    | {
          row: IComparisonRow;
          evalRuns: IEvalMemberRow[];
          pipelineRuns: IPipelineMemberRow[];
      }
    | undefined
> {
    if (!UUID.test(setupComparisonId)) return undefined;
    const row = (
        await db.query<IComparisonRow>(
            `select c.id, c.dataset_id as "datasetId", d.name as "datasetName",
                    c.created_at as "createdAt", c.max_cost_usd as "maxCostUsd",
                    c.config, c.cancel_requested_at as "cancelRequestedAt"
             from setup_comparisons c
             left join datasets d on d.id = c.dataset_id
             where c.id=$1 and c.team_id=$2 and c.project_id=$3`,
            [setupComparisonId, teamId, projectId],
        )
    ).rows[0];
    if (!row) return undefined;
    const [evalRuns, pipelineRuns] = await Promise.all([
        db.query<IEvalMemberRow>(
            `select r.id, r.status, r.stop_reason as "stopReason", r.error,
                    r.config_snapshot as "configSnapshot",
                    r.created_at as "createdAt", o.status as "enqueueStatus",
                    coalesce(o.queued_at, o.updated_at, r.created_at) as "pendingSince",
                    ${EVAL_SPEND_SQL} as spent
             from runs r
             left join run_enqueue_outbox o on o.run_id = r.id
             where r.setup_comparison_id=$1 and r.team_id=$2 and r.project_id=$3
             order by r.created_at, r.id`,
            [setupComparisonId, teamId, projectId],
        ),
        db.query<IPipelineMemberRow>(
            `select w.id, w.workflow_id as "workflowId", w.status,
                    w.stop_reason as "stopReason", w.error,
                    w.created_at as "createdAt",
                    coalesce(o.status, w.enqueue_status) as "enqueueStatus",
                    coalesce(o.queued_at, o.updated_at, w.created_at) as "pendingSince",
                    jsonb_build_object(
                        'name', w.workflow_snapshot->'name',
                        'nodes', w.workflow_snapshot->'nodes',
                        'edges', w.workflow_snapshot->'edges'
                    ) as snapshot,
                    (select count(*) from workflow_run_cells c
                     where c.workflow_run_id = w.id
                       and c.status in ('pending', 'running')) as "openCells",
                    ${PIPELINE_SPEND_SQL} as spent
             from workflow_runs w
             left join workflow_run_enqueue_outbox o on o.workflow_run_id = w.id
             where w.setup_comparison_id=$1 and w.team_id=$2 and w.project_id=$3
             order by w.created_at, w.id`,
            [setupComparisonId, teamId, projectId],
        ),
    ]);
    return { row, evalRuns: evalRuns.rows, pipelineRuns: pipelineRuns.rows };
}

/** A comparison with its member runs, their status and the shared spend. */
export async function setupComparisonPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    setupComparisonId: string,
): Promise<ISetupComparison> {
    const loaded = await loadComparison(
        db,
        teamId,
        projectId,
        setupComparisonId,
    );
    if (!loaded) throw new ApiNotFoundError("Comparison not found.");
    const { row, evalRuns, pipelineRuns } = loaded;
    const now = Date.now();
    const evalActive = evalRuns.some(
        (run) => run.status === "pending" || run.status === "running",
    );
    const members: ISetupComparisonMember[] = [
        ...evalRuns.map((run): ISetupComparisonMember => ({
            kind: "eval_run",
            name: "Eval run",
            ...memberFields(run, now),
        })),
        ...pipelineRuns.map((run): ISetupComparisonMember => ({
            kind: "pipeline",
            workflowId: run.workflowId,
            name: run.snapshot?.name ?? "Pipeline",
            stepModels: stepModelsOf(run.snapshot),
            ...memberFields(run, now),
            ...(run.status === "running" &&
            Number(run.openCells) === 0 &&
            evalActive
                ? { waitingForEvalRun: true }
                : {}),
        })),
    ];
    const spentUsd = [...evalRuns, ...pipelineRuns].reduce(
        (total, run) => total + Number(run.spent ?? 0),
        0,
    );
    const derived = setupComparisonStatus(members);
    const ranking = evalRuns[0]
        ? await rankingFor(db, evalRuns[0], pipelineRuns)
        : undefined;
    return {
        id: row.id,
        datasetId: row.datasetId,
        ...(row.datasetName ? { datasetName: row.datasetName } : {}),
        createdAt: iso(row.createdAt),
        status: derived.status,
        ...(derived.stopReason ? { stopReason: derived.stopReason } : {}),
        cancelRequested: row.cancelRequestedAt !== null,
        ...(row.maxCostUsd !== null
            ? { maxCostUsd: Number(row.maxCostUsd) }
            : {}),
        spentUsd,
        ...(row.config?.dataPolicy
            ? { dataPolicy: row.config.dataPolicy }
            : {}),
        members,
        ...(ranking ? { ranking } : {}),
    };
}

/**
 * Every setup ranked together: the eval run's cells with their stored
 * benchmark details, and each pipeline run's final answers with theirs,
 * summarised once with the eval run's Task Map and targets.
 */
async function rankingFor(
    db: IDb,
    evalRun: IEvalMemberRow,
    pipelineRuns: IPipelineMemberRow[],
): Promise<ISetupRanking | undefined> {
    const benchmark = evalRun.configSnapshot?.benchmark;
    if (!benchmark || !Array.isArray(benchmark.taskMap?.tasks))
        return undefined;
    const pipelineIds = pipelineRuns.map((run) => run.id);
    const [runModels, cells, answers, itemCounts] = await Promise.all([
        db.query<{ id: string; modelId: string; isReference: boolean }>(
            `select id, model_id as "modelId", is_reference as "isReference"
             from run_models where run_id=$1 order by id`,
            [evalRun.id],
        ),
        db.query<IRankingCellRow>(
            `select c.run_model_id as "runModelId",
                    c.dataset_item_id as "datasetItemId", c.status,
                    c.cost_usd as "costUsd", c.latency_ms as "latencyMs",
                    s.details_json as details
             from run_cells c
             left join cell_scores s
               on s.run_cell_id = c.id and s.scorer_type = 'benchmark'
             where c.run_id = $1`,
            [evalRun.id],
        ),
        pipelineIds.length > 0
            ? db.query<IRankingAnswerRow>(
                  `select workflow_run_id as "workflowRunId",
                          dataset_item_id as "datasetItemId", status,
                          cost_usd as "costUsd", latency_ms as "latencyMs",
                          benchmark_scored_at is not null as scored,
                          benchmark_details as details
                   from workflow_run_answers
                   where workflow_run_id = any($1::uuid[])`,
                  [pipelineIds],
              )
            : Promise.resolve({ rows: [] as IRankingAnswerRow[] }),
        pipelineIds.length > 0
            ? db.query<{ workflowRunId: string; items: number | string }>(
                  `select workflow_run_id as "workflowRunId",
                          count(distinct dataset_item_id) as items
                   from workflow_run_cells
                   where workflow_run_id = any($1::uuid[])
                   group by workflow_run_id`,
                  [pipelineIds],
              )
            : Promise.resolve({
                  rows: [] as Array<{ workflowRunId: string; items: number }>,
              }),
    ]);
    const itemIds = [...new Set(cells.rows.map((cell) => cell.datasetItemId))];
    const labeled =
        benchmarkUsesSource(benchmark, "labels") && itemIds.length > 0
            ? (
                  await db.query<{ datasetItemId: string }>(
                      `select dataset_item_id as "datasetItemId" from labels
                       where dataset_item_id = any($1::uuid[])`,
                      [itemIds],
                  )
              ).rows.map((row) => row.datasetItemId)
            : undefined;
    const countOf = new Map(
        itemCounts.rows.map((row) => [row.workflowRunId, Number(row.items)]),
    );
    return summarizeSetupComparison({
        benchmark,
        evalRunId: evalRun.id,
        ...(labeled ? { labeledItemIds: labeled } : {}),
        runModels: runModels.rows.map((model) => ({
            ...model,
            isReference: Boolean(model.isReference),
        })),
        cells: cells.rows.map((cell) => ({
            runModelId: cell.runModelId,
            datasetItemId: cell.datasetItemId,
            status: cell.status,
            costUsd: numberOrNull(cell.costUsd),
            latencyMs: numberOrNull(cell.latencyMs),
            ...withDetails(cell.details),
        })),
        pipelines: pipelineRuns.map((run) => ({
            workflowRunId: run.id,
            workflowId: run.workflowId,
            name: run.snapshot?.name ?? "Pipeline",
            stepModels: stepModelsOf(run.snapshot),
            itemCount: countOf.get(run.id) ?? 0,
            answers: answers.rows
                .filter((answer) => answer.workflowRunId === run.id)
                .map((answer) => {
                    const costUsd = numberOrNull(answer.costUsd);
                    const latencyMs = numberOrNull(answer.latencyMs);
                    return {
                        datasetItemId: answer.datasetItemId,
                        status: answer.status,
                        scored: Boolean(answer.scored),
                        ...(costUsd !== null ? { costUsd } : {}),
                        ...(latencyMs !== null ? { latencyMs } : {}),
                        ...withDetails(answer.details),
                    };
                }),
        })),
    });
}

interface IRankingCellRow {
    runModelId: string;
    datasetItemId: string;
    status: string;
    costUsd: number | string | null;
    latencyMs: number | string | null;
    details: unknown;
}

interface IRankingAnswerRow {
    workflowRunId: string;
    datasetItemId: string;
    status: "complete" | "failed";
    costUsd: number | string | null;
    latencyMs: number | string | null;
    scored: boolean;
    details: unknown;
}

function numberOrNull(value: number | string | null): number | null {
    return value === null ? null : Number(value);
}

/** Stored benchmark details, when the value is some. */
function withDetails(value: unknown): { details?: IBenchmarkCellDetails } {
    return value &&
        typeof value === "object" &&
        Array.isArray((value as { tasks?: unknown }).tasks)
        ? { details: value as IBenchmarkCellDetails }
        : {};
}

/**
 * Cancels a comparison: every pending or running member run is asked to
 * stop, exactly as its own Cancel run would (calls already sent finish;
 * steps and cells not started are left as not run). Finished members are
 * left as they are.
 */
export async function cancelSetupComparisonPayload(
    db: IDb,
    input: ICancelSetupComparisonRequest,
): Promise<ICancelSetupComparisonResponse> {
    return withTransaction(db, async (tx) => {
        if (!UUID.test(input.setupComparisonId)) throw new ApiNotFoundError();
        const locked = (
            await tx.query<{ id: string }>(
                `update setup_comparisons
                 set cancel_requested_at = coalesce(cancel_requested_at, now())
                 where id=$1 and team_id=$2 and project_id=$3
                 returning id`,
                [input.setupComparisonId, input.teamId, input.projectId],
            )
        ).rows[0];
        if (!locked) throw new ApiNotFoundError("Comparison not found.");
        const [evalRuns, pipelineRuns] = await Promise.all([
            tx.query<{ id: string }>(
                `select id from runs where setup_comparison_id=$1
                 order by created_at, id`,
                [input.setupComparisonId],
            ),
            tx.query<{ id: string; workflowId: string }>(
                `select id, workflow_id as "workflowId" from workflow_runs
                 where setup_comparison_id=$1 order by created_at, id`,
                [input.setupComparisonId],
            ),
        ]);
        const results: Array<{
            status: RunStatus;
            stopReason?: RunStopReason;
        }> = [];
        for (const run of evalRuns.rows)
            results.push(
                await cancelRunPayload(tx, {
                    teamId: input.teamId,
                    projectId: input.projectId,
                    runId: run.id,
                }),
            );
        for (const run of pipelineRuns.rows)
            results.push(
                await cancelWorkflowRunPayload(tx, {
                    teamId: input.teamId,
                    projectId: input.projectId,
                    workflowId: run.workflowId,
                    workflowRunId: run.id,
                }),
            );
        const derived = setupComparisonStatus(results);
        return {
            setupComparisonId: input.setupComparisonId,
            status: derived.status,
            ...(derived.stopReason ? { stopReason: derived.stopReason } : {}),
        };
    });
}

interface IPipelineOptionRow {
    id: string;
    name: string;
    kind: WorkflowKind | null;
    finalAnswer: IPipelineFinalAnswer | null;
    nodes: Array<{
        id: string;
        label: string;
        nodeType: string | null;
        nodeConfig: {
            type?: string;
            datasetId?: string;
            modality?: string;
        } | null;
        modelId: string | null;
        transport: string | null;
        promptVersionId: string | null;
        promptChars: number | null;
    }>;
    edges: Array<{ fromNodeId: string; toNodeId: string }>;
}

/**
 * Saved text pipelines the comparison launcher offers, newest first: each
 * with its model-backed steps in order, the dataset its input block reads,
 * and why it can't be compared (no final answer, or not a text pipeline).
 */
export async function listSetupComparisonPipelinesPayload(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<ISetupComparisonPipelineOption[]> {
    const rows = (
        await db.query<IPipelineOptionRow>(
            `select w.id, w.name, w.kind, w.final_answer as "finalAnswer",
                    coalesce((
                        select json_agg(json_build_object(
                            'id', n.id, 'label', n.label,
                            'nodeType', n.node_type, 'nodeConfig', n.node_config,
                            'modelId', n.model_id, 'transport', n.llm_transport,
                            'promptVersionId', n.prompt_version_id,
                            'promptChars', length(pv.content)
                        ) order by n.node_key)
                        from workflow_nodes n
                        left join prompt_versions pv on pv.id = n.prompt_version_id
                        where n.workflow_id = w.id
                    ), '[]'::json) as nodes,
                    coalesce((
                        select json_agg(json_build_object(
                            'fromNodeId', e.from_node_id, 'toNodeId', e.to_node_id
                        ))
                        from workflow_edges e where e.workflow_id = w.id
                    ), '[]'::json) as edges
             from prompt_workflows w
             where w.team_id=$1 and w.project_id=$2 and w.archived_at is null
               and coalesce(w.kind, 'prompt') in ('prompt', 'multi')
             order by w.created_at desc, w.id
             limit 100`,
            [teamId, projectId],
        )
    ).rows;
    return rows.map((row) => pipelineOption(row));
}

function pipelineOption(
    row: IPipelineOptionRow,
): ISetupComparisonPipelineOption {
    const kind = row.kind ?? "prompt";
    const input = row.nodes.find((node) => node.nodeConfig?.type === "input");
    const steps = pipelineStepOrder(row.nodes, row.edges).flatMap(
        (node): ISetupComparisonPipelineStep[] =>
            MODEL_BACKED.has(node.nodeType ?? "prompt")
                ? [
                      {
                          label: node.label,
                          ...(node.modelId ? { modelId: node.modelId } : {}),
                          ...(node.transport &&
                          isProviderTransport(node.transport)
                              ? { transport: node.transport }
                              : {}),
                          ...(node.promptVersionId
                              ? { promptVersionId: node.promptVersionId }
                              : {}),
                          ...(node.promptChars !== null
                              ? { promptChars: Number(node.promptChars) }
                              : {}),
                      },
                  ]
                : [],
    );
    const hasFinalAnswer = (row.finalAnswer?.fields.length ?? 0) > 0;
    const unavailableReason = !hasFinalAnswer
        ? "No final answer yet. Add one under the canvas to compare it."
        : input?.nodeConfig?.modality && input.nodeConfig.modality !== "text"
          ? "Only text pipelines can be compared."
          : steps.length === 0
            ? "It has no model steps."
            : undefined;
    return {
        id: row.id,
        name: row.name,
        kind,
        ...(input?.nodeConfig?.datasetId
            ? { datasetId: input.nodeConfig.datasetId }
            : {}),
        steps,
        hasFinalAnswer,
        ...(unavailableReason ? { unavailableReason } : {}),
    };
}
