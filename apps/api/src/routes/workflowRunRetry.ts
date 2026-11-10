import type {
    ICancelWorkflowRunRequest,
    ICancelWorkflowRunResponse,
    IRetryWorkflowRunRequest,
    RunStatus,
    RunStopReason,
} from "@flash-evals/api-contract";
import { withTransaction, type IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../errors.js";
import { PG_BOSS_SCHEMA, WORKFLOW_RUN_QUEUE } from "../runQueue.js";

const RETRYABLE_RUN_STATUSES = new Set<RunStatus>([
    "failed",
    "partial",
    "cancelled",
]);

function assertRunIds(input: IRetryWorkflowRunRequest): void {
    for (const key of [
        "teamId",
        "projectId",
        "workflowId",
        "workflowRunId",
    ] as const) {
        if (typeof input[key] !== "string" || !input[key].trim())
            throw new ApiBadRequestError(`Missing required field: ${key}`);
    }
}

async function lockRun(
    tx: IDb,
    input: IRetryWorkflowRunRequest,
): Promise<{ status: RunStatus; stopReason: RunStopReason | null }> {
    const run = (
        await tx.query<{ status: RunStatus; stopReason: RunStopReason | null }>(
            `select status, stop_reason as "stopReason" from workflow_runs
            where id = $1 and team_id = $2 and project_id = $3 and workflow_id = $4
            for update`,
            [
                input.workflowRunId,
                input.teamId,
                input.projectId,
                input.workflowId,
            ],
        )
    ).rows[0];
    if (!run) throw new ApiNotFoundError();
    return run;
}

async function queuePublication(tx: IDb, input: IRetryWorkflowRunRequest) {
    await tx.query(
        `insert into workflow_run_enqueue_outbox (project_id, workflow_run_id)
        values ($1, $2)
        on conflict (workflow_run_id) do update set
            status = 'pending_enqueue', publish_attempts = 0,
            available_at = now(), queued_at = null, last_error = null,
            updated_at = now()`,
        [input.projectId, input.workflowRunId],
    );
}

/**
 * A pending run's job may still be waiting for a worker (or running its
 * setup). Queueing it again would only wait behind it, so it is left alone.
 * A pending run whose job is gone (an older release, a lost publication)
 * is queued again.
 */
async function pendingRunStillQueued(
    tx: IDb,
    workflowRunId: string,
): Promise<boolean> {
    const publication = (
        await tx.query<{ status: string }>(
            `select status from workflow_run_enqueue_outbox
            where workflow_run_id = $1 for update`,
            [workflowRunId],
        )
    ).rows[0];
    if (
        publication?.status === "pending_enqueue" ||
        publication?.status === "publishing"
    )
        return true;
    if (publication?.status !== "queued") return false;
    // A queued publication implies pg-boss already created its schema.
    const live = await tx.query(
        `select id from ${PG_BOSS_SCHEMA}.job
        where name = $1 and singleton_key = $2
          and state in ('created', 'retry', 'active')
        limit 1`,
        [WORKFLOW_RUN_QUEUE, workflowRunId],
    );
    return live.rows.length > 0;
}

async function resetFailedCells(tx: IDb, cellIds: string[]): Promise<void> {
    if (cellIds.length === 0) return;
    await tx.query(
        `delete from workflow_cell_scores
        where workflow_run_cell_id = any($1::uuid[])`,
        [cellIds],
    );
    await tx.query(
        `update workflow_run_cells
        set status = 'pending', latency_ms = null,
            output_json = case
                when output_json #> '{providerMetadata,transcriptionSpend}' is null then null
                else jsonb_build_object('text', '', 'providerMetadata', jsonb_build_object(
                    'transcriptionSpend', output_json #> '{providerMetadata,transcriptionSpend}'))
            end,
            error = null, claimed_at = null
        where id = any($1::uuid[]) and status = 'failed'`,
        [cellIds],
    );
}

/**
 * Final answers of a run compared with an eval run whose benchmark judge
 * failed on a task (a provider refusal, a spending cap, an answer cut off).
 * The next pass judges those tasks again. The run page shows this count to
 * offer a re-judge on a completed run.
 */
export async function answersToRejudge(
    tx: IDb,
    workflowRunId: string,
): Promise<number> {
    const result = await tx.query<{ rejudge: number }>(
        `select count(*)::int as rejudge from workflow_run_answers
        where workflow_run_id = $1 and status = 'complete'
          and benchmark_scored_at is not null
          and jsonb_path_exists(benchmark_details, '$.tasks[*] ? (exists(@.error))')`,
        [workflowRunId],
    );
    return result.rows[0]?.rejudge ?? 0;
}

/**
 * Admit a retry of a workflow run. For a finished run, failed cells,
 * including descendants that were marked failed because an upstream node
 * failed, return to pending with their stale output and scores removed.
 * Successful cells, the workflow snapshot, LLM attempt history, and already
 * incurred spend are kept. Only the spend checkpoint survives in failed output.
 * A cancelled run resumes: its stop request is cleared and the steps that
 * did not run (still pending) run. Final answers whose benchmark judge
 * failed on a task are judged again, even on a completed run. A run that failed before any step
 * started runs again. A pending run is queued again only when its job is
 * gone; while the job still waits, `requeued` is false.
 *
 * The run row lock makes admission single-flight: a second retry sees the run
 * as pending with a live job and is not queued again. The publish step that
 * follows uses a pg-boss singleton key, and cell claims are atomic, so
 * duplicate queue delivery cannot execute a cell twice.
 */
export async function retryWorkflowRunPayload(
    db: IDb,
    input: IRetryWorkflowRunRequest,
): Promise<{ retriedCellCount: number; requeued: boolean }> {
    assertRunIds(input);
    return withTransaction(db, async (tx) => {
        const run = await lockRun(tx, input);
        if (run.status === "pending") {
            if (await pendingRunStillQueued(tx, input.workflowRunId))
                return { retriedCellCount: 0, requeued: false };
            await queuePublication(tx, input);
            await tx.query(
                `update workflow_runs set enqueue_status = 'pending_enqueue'
                where id = $1`,
                [input.workflowRunId],
            );
            return { retriedCellCount: 0, requeued: true };
        }
        if (
            !RETRYABLE_RUN_STATUSES.has(run.status) &&
            run.status !== "completed"
        )
            throw new ApiConflictError(
                "This run is still in progress; retry it after it finishes.",
            );
        const rejudge = await answersToRejudge(tx, input.workflowRunId);
        if (run.status === "completed" && rejudge === 0)
            throw new ApiConflictError(
                "This run has no failed cells to retry.",
            );
        const failed = await tx.query<{ id: string }>(
            `select id from workflow_run_cells
            where workflow_run_id = $1 and status = 'failed'`,
            [input.workflowRunId],
        );
        const cellIds = failed.rows.map((row) => row.id);
        const unfinished = await tx.query<{ count: number }>(
            `select count(*)::int as count from workflow_run_cells
            where workflow_run_id = $1 and status in ('pending', 'running')`,
            [input.workflowRunId],
        );
        if (
            cellIds.length === 0 &&
            (unfinished.rows[0]?.count ?? 0) === 0 &&
            rejudge === 0
        )
            throw new ApiConflictError(
                "This run has no failed cells to retry.",
            );
        await resetFailedCells(tx, cellIds);
        // Steps a stopped pass claimed but never started.
        await tx.query(
            `update workflow_run_cells set status = 'pending', claimed_at = null
            where workflow_run_id = $1 and status = 'running'`,
            [input.workflowRunId],
        );
        // Shared audio preparation (single-STT workflows) failed per item.
        await tx.query(
            `update workflow_run_items
            set preparation_status = 'pending', evaluation_status = 'pending',
                claimed_at = null, lease_owner = null, error = null,
                updated_at = now()
            where workflow_run_id = $1 and preparation_status = 'error'`,
            [input.workflowRunId],
        );
        await queuePublication(tx, input);
        // Retrying a cancelled run resumes it, so the stop request is cleared.
        await tx.query(
            `update workflow_runs
            set status = 'pending', enqueue_status = 'pending_enqueue',
                cancel_requested_at = null, stop_reason = null, error = null
            where id = $1`,
            [input.workflowRunId],
        );
        return { retriedCellCount: cellIds.length, requeued: true };
    });
}

/**
 * A running run whose steps have all finished and that no worker holds is
 * only waiting for its compared eval run before scoring. No worker would see
 * a stop request on it, so a cancel ends it at once.
 */
async function onlyWaitingToScore(
    tx: IDb,
    workflowRunId: string,
): Promise<boolean> {
    const unfinished = await tx.query<{ count: number }>(
        `select count(*)::int as count from workflow_run_cells
        where workflow_run_id = $1 and status in ('pending', 'running')`,
        [workflowRunId],
    );
    if ((unfinished.rows[0]?.count ?? 0) > 0) return false;
    return !(await pendingRunStillQueued(tx, workflowRunId));
}

/**
 * Asks a pending or running pipeline run to stop. A pending run has not
 * finished its setup on any worker, so it is cancelled at once (a worker
 * still in setup finds it cancelled and stops). A running run keeps going
 * until the worker sees the request before its next step: calls already
 * sent finish, steps not started stay pending (not run), and the run ends
 * cancelled. A running run only waiting for its compared eval run before
 * scoring is cancelled at once. A finished run is left as it is.
 */
export async function cancelWorkflowRunPayload(
    db: IDb,
    input: ICancelWorkflowRunRequest,
): Promise<ICancelWorkflowRunResponse> {
    assertRunIds(input);
    return withTransaction(db, async (tx) => {
        const run = await lockRun(tx, input);
        if (run.status !== "pending" && run.status !== "running")
            return {
                workflowRunId: input.workflowRunId,
                status: run.status,
                ...(run.stopReason ? { stopReason: run.stopReason } : {}),
            };
        const status: RunStatus =
            run.status === "pending" ||
            (await onlyWaitingToScore(tx, input.workflowRunId))
                ? "cancelled"
                : "running";
        await tx.query(
            `update workflow_runs set status = $2,
                cancel_requested_at = coalesce(cancel_requested_at, now()),
                stop_reason = coalesce(stop_reason, 'cancelled')
            where id = $1`,
            [input.workflowRunId, status],
        );
        return {
            workflowRunId: input.workflowRunId,
            status,
            stopReason: run.stopReason ?? "cancelled",
        };
    });
}
