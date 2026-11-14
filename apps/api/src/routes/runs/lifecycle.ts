import type {
    ICancelRunResponse,
    IRunLifecycleRequest,
    IRunProgressResponse,
    ISaveCellAnnotationRequest,
    ISaveRunNoteRequest,
    ReviewVerdict,
    RunStatus,
    RunStopReason,
} from "@flash-evals/api-contract";
import { withTransaction, type IDb } from "../../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../../errors.js";
import { PG_BOSS_SCHEMA } from "../../runQueue.js";
import { assertTeamSpendUnderCap } from "../../runLimits.js";

/** The worker's default and minimum stale-lease window (`RUN_STALE_CLAIM_MS`). */
const DEFAULT_RUN_STALE_CLAIM_MS = 900_000;
const MIN_RUN_STALE_CLAIM_MS = 60_000;

/**
 * The stale-lease window for a lease stored without the worker's own window
 * (taken before migration 0082), read the way the worker reads it.
 */
export function runStaleClaimMs(
    value: string | undefined = process.env.RUN_STALE_CLAIM_MS,
): number {
    const parsed = Number.parseInt(value ?? "", 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0)
        return DEFAULT_RUN_STALE_CLAIM_MS;
    return Math.max(MIN_RUN_STALE_CLAIM_MS, parsed);
}

/**
 * SQL true when the run's execution lease belongs to a live worker pass. A
 * lease the heartbeat stopped refreshing for longer than the holding
 * worker's stale window (stored with the lease) is a dead worker's: the run
 * is not executing, so Cancel and Retry act on it.
 */
function liveLeaseSql(): string {
    // An integer from runStaleClaimMs, never user input.
    const ms = runStaleClaimMs();
    return `(execution_lease_id is not null and coalesce(execution_lease_at > now() - coalesce(execution_lease_stale_ms, ${ms}) * interval '1 millisecond', false))`;
}

interface IRunRow {
    status: RunStatus;
    enqueueStatus?: "pending_enqueue" | "queued";
    stopReason?: RunStopReason | null;
    error?: string | null;
    pendingSince?: Date | string | null;
}

interface IRunTeamForCellRow {
    run_id: string;
    team_id: string;
    project_id: string;
}

interface IProgressRow {
    status: "pending" | "running" | "succeeded" | "failed" | "cached";
    count: number | string;
}

export async function runProgressPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
): Promise<IRunProgressResponse> {
    const run = await getTeamRun(db, teamId, projectId, runId);
    if (!run) throw new ApiNotFoundError();
    return {
        status: run.status,
        ...(run.enqueueStatus ? { enqueueStatus: run.enqueueStatus } : {}),
        ...(run.stopReason ? { stopReason: run.stopReason } : {}),
        ...(run.error ? { error: run.error } : {}),
        ...(run.status === "pending" && run.pendingSince
            ? { pendingSince: new Date(run.pendingSince).toISOString() }
            : {}),
        ...(await progressPayloadForRun(db, runId)),
    };
}

export async function saveRunNotePayload(
    db: IDb,
    input: ISaveRunNoteRequest,
): Promise<void> {
    const run = await getTeamRun(
        db,
        input.teamId,
        input.projectId,
        input.runId,
    );
    if (!run) throw new ApiNotFoundError();
    await db.query(
        `insert into run_notes (run_id, body, updated_by, updated_at)
        values ($1, $2, $3, now())
        on conflict (run_id) do update set
            body = excluded.body,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [input.runId, input.body, input.updatedBy],
    );
}

export async function saveCellAnnotationPayload(
    db: IDb,
    input: ISaveCellAnnotationRequest,
): Promise<{ runId: string }> {
    if (!isReviewVerdict(input.verdict)) {
        throw new ApiBadRequestError("Invalid review verdict");
    }
    const result = await db.query<IRunTeamForCellRow>(
        `select r.id as run_id, r.team_id, r.project_id
        from run_cells rc
        inner join runs r on rc.run_id = r.id
        where rc.id = $1
        limit 1`,
        [input.runCellId],
    );
    const row = result.rows[0];
    if (
        !row ||
        row.team_id !== input.teamId ||
        row.project_id !== input.projectId
    )
        throw new ApiNotFoundError();

    await db.query(
        `insert into run_cell_annotations (
            run_cell_id,
            verdict,
            comment,
            updated_by,
            updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (run_cell_id) do update set
            verdict = excluded.verdict,
            comment = excluded.comment,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [input.runCellId, input.verdict, input.comment, input.updatedBy],
    );
    return { runId: row.run_id };
}

export async function deleteRunPayload(
    db: IDb,
    input: IRunLifecycleRequest,
): Promise<void> {
    const run = await getTeamRun(
        db,
        input.teamId,
        input.projectId,
        input.runId,
    );
    if (!run) throw new ApiNotFoundError();

    const cells = await db.query<{ id: string }>(
        `select id
        from run_cells
        where run_id = $1`,
        [input.runId],
    );
    const cellIds = cells.rows.map((cell) => cell.id);
    if (cellIds.length > 0) {
        await db.query(
            `delete from cell_scores
            where run_cell_id = any($1::uuid[])`,
            [cellIds],
        );
        await db.query(
            `delete from run_cell_annotations
            where run_cell_id = any($1::uuid[])`,
            [cellIds],
        );
    }
    await db.query("delete from run_notes where run_id = $1", [input.runId]);
    await db.query("delete from run_cells where run_id = $1", [input.runId]);
    await db.query("delete from run_models where run_id = $1", [input.runId]);
    await db.query(
        "delete from runs where id = $1 and team_id = $2 and project_id = $3",
        [input.runId, input.teamId, input.projectId],
    );
}

/**
 * Queues a run again. `requeued` is false when there was nothing to do: the
 * run is running, or its job is still queued or active (a pending run no
 * worker has picked up yet), or a publication is already pending.
 */
export async function retryRunPayload(
    db: IDb,
    input: IRunLifecycleRequest,
    options: { teamDailySpendCapUsd?: number } = {},
): Promise<{ requeued: boolean }> {
    return withTransaction(db, async (tx) => {
        const run = (
            await tx.query<IRunRow & { staleLease?: boolean }>(
                `select status,
                        execution_lease_id is not null and not ${liveLeaseSql()} as "staleLease"
                 from runs where id=$1 and team_id=$2 and project_id=$3 for update`,
                [input.runId, input.teamId, input.projectId],
            )
        ).rows[0];
        if (!run) throw new ApiNotFoundError();
        if (run.status === "running") return { requeued: false };
        const publication = (
            await tx.query<{ status: string; jobId: string }>(
                `select status, job_id as "jobId" from run_enqueue_outbox where run_id=$1 for update`,
                [input.runId],
            )
        ).rows[0];
        if (publication?.status === "pending_enqueue")
            return { requeued: false };
        if (publication?.status === "queued" && run.status === "pending") {
            // A worker can fail before setting the run running. Preserve explicit
            // recovery of that case, but never duplicate work still in the queue.
            // A queued outbox record implies pg-boss already created its schema.
            // An active job whose pass holds only a stale lease belongs to a
            // dead worker (pg-boss keeps it active until it expires).
            const states =
                run.staleLease === true
                    ? "('created', 'retry')"
                    : "('created', 'retry', 'active')";
            const active = (
                await tx.query(
                    `select id from ${PG_BOSS_SCHEMA}.job where id=$1 and name='eval-run'
                 and state in ${states} limit 1`,
                    [publication.jobId],
                )
            ).rows[0];
            if (active) return { requeued: false };
        }
        // A retry spends like a new run, so the team daily cap applies.
        await assertTeamSpendUnderCap(
            tx,
            input.teamId,
            options.teamDailySpendCapUsd,
        );
        await tx.query(
            `insert into run_enqueue_outbox (run_id) values ($1)
             on conflict (run_id) do update set
                job_id=gen_random_uuid(), status='pending_enqueue', publish_attempts=0,
                available_at=now(), queued_at=null, last_error=null, updated_at=now()`,
            [input.runId],
        );
        // Admission and status change are atomic. A second retry after publication
        // sees pending + a live job instead of admitting another terminal retry.
        // Retrying a cancelled run resumes it, so the stop request is cleared.
        await tx.query(
            `update runs set status='pending', cancel_requested_at=null, stop_reason=null, error=null
             where id=$1`,
            [input.runId],
        );
        return { requeued: true };
    });
}

/**
 * Asks a pending or running eval run to stop. A run no worker has started
 * is cancelled at once; otherwise the worker sees the request before its
 * next cell, lets calls already sent finish, leaves the rest not run and
 * marks the run cancelled. A finished run is left as it is.
 */
export async function cancelRunPayload(
    db: IDb,
    input: IRunLifecycleRequest,
): Promise<ICancelRunResponse> {
    return withTransaction(db, async (tx) => {
        const run = (
            await tx.query<{
                status: RunStatus;
                stopReason: RunStopReason | null;
                executing: boolean;
            }>(
                `select status, stop_reason as "stopReason",
                        ${liveLeaseSql()} as executing
                 from runs where id=$1 and team_id=$2 and project_id=$3 for update`,
                [input.runId, input.teamId, input.projectId],
            )
        ).rows[0];
        if (!run) throw new ApiNotFoundError();
        if (run.status !== "pending" && run.status !== "running")
            return {
                runId: input.runId,
                status: run.status,
                ...(run.stopReason ? { stopReason: run.stopReason } : {}),
            };
        // A queued job for a run cancelled here finds it cancelled and skips it.
        const status: RunStatus =
            run.status === "pending" && !run.executing
                ? "cancelled"
                : run.status;
        await tx.query(
            `update runs set status=$2,
                cancel_requested_at=coalesce(cancel_requested_at, now()),
                stop_reason=coalesce(stop_reason, 'cancelled')
             where id=$1`,
            [input.runId, status],
        );
        return {
            runId: input.runId,
            status,
            stopReason: run.stopReason ?? "cancelled",
        };
    });
}

async function getTeamRun(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
): Promise<IRunRow | undefined> {
    const result = await db.query<IRunRow>(
        `select status, stop_reason as "stopReason", error,
                (select status from run_enqueue_outbox where run_id=runs.id) as "enqueueStatus",
                coalesce(
                    (select coalesce(queued_at, updated_at) from run_enqueue_outbox where run_id=runs.id),
                    created_at
                ) as "pendingSince"
         from runs where id = $1 and team_id = $2 and project_id = $3 limit 1`,
        [runId, teamId, projectId],
    );
    return result.rows[0];
}

async function progressPayloadForRun(
    db: IDb,
    runId: string,
): Promise<{ total: number; done: number; failed: number; pending: number }> {
    const progressResult = await db.query<IProgressRow>(
        `select status, count(*)::int as count
        from run_cells
        where run_id = $1
        group by status`,
        [runId],
    );
    let total = 0;
    let done = 0;
    let failed = 0;
    for (const row of progressResult.rows) {
        const count =
            typeof row.count === "number" ? row.count : Number(row.count);
        total += count;
        if (row.status === "succeeded" || row.status === "cached")
            done += count;
        else if (row.status === "failed") failed += count;
    }
    return { total, done, failed, pending: total - done - failed };
}

const REVIEW_VERDICTS = new Set<string>([
    "unreviewed",
    "approved",
    "needs_review",
    "issue",
]);

function isReviewVerdict(value: string): value is ReviewVerdict {
    return REVIEW_VERDICTS.has(value);
}
