import type { IRetryWorkflowRunRequest, RunStatus } from "@flash-evals/api-contract";
import { withTransaction, type IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../errors.js";

const RETRYABLE_RUN_STATUSES = new Set<RunStatus>(["failed", "partial"]);

/**
 * Admit a retry of a finished workflow run's failed cells. Failed cells,
 * including descendants that were marked failed because an upstream node
 * failed, return to pending with their stale output and scores removed.
 * Successful cells, the workflow snapshot, and LLM attempt history are kept.
 *
 * The run row lock makes admission single-flight: a second retry sees the run
 * as pending and is rejected instead of queueing duplicate work. The publish
 * step that follows uses a pg-boss singleton key, and cell claims are atomic,
 * so duplicate queue delivery cannot execute a cell twice.
 */
export async function retryWorkflowRunPayload(
    db: IDb,
    input: IRetryWorkflowRunRequest,
): Promise<{ retriedCellCount: number }> {
    for (const key of [
        "teamId",
        "projectId",
        "workflowId",
        "workflowRunId",
    ] as const) {
        if (typeof input[key] !== "string" || !input[key].trim())
            throw new ApiBadRequestError(`Missing required field: ${key}`);
    }
    return withTransaction(db, async (tx) => {
        const run = (
            await tx.query<{ status: RunStatus }>(
                `select status from workflow_runs
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
        if (!RETRYABLE_RUN_STATUSES.has(run.status))
            throw new ApiConflictError(
                run.status === "completed"
                    ? "This run has no failed cells to retry."
                    : "This run is still in progress; retry it after it finishes.",
            );
        const failed = await tx.query<{ id: string }>(
            `select id from workflow_run_cells
            where workflow_run_id = $1 and status = 'failed'`,
            [input.workflowRunId],
        );
        const cellIds = failed.rows.map((row) => row.id);
        if (cellIds.length === 0)
            throw new ApiConflictError(
                "This run has no failed cells to retry.",
            );
        await tx.query(
            `delete from workflow_cell_scores
            where workflow_run_cell_id = any($1::uuid[])`,
            [cellIds],
        );
        await tx.query(
            `update workflow_run_cells
            set status = 'pending', output_json = null, latency_ms = null,
                cost_usd = null, error = null, claimed_at = null
            where id = any($1::uuid[]) and status = 'failed'`,
            [cellIds],
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
        await tx.query(
            `insert into workflow_run_enqueue_outbox (project_id, workflow_run_id)
            values ($1, $2)
            on conflict (workflow_run_id) do update set
                status = 'pending_enqueue', publish_attempts = 0,
                available_at = now(), queued_at = null, last_error = null,
                updated_at = now()`,
            [input.projectId, input.workflowRunId],
        );
        await tx.query(
            `update workflow_runs
            set status = 'pending', enqueue_status = 'pending_enqueue'
            where id = $1`,
            [input.workflowRunId],
        );
        return { retriedCellCount: cellIds.length };
    });
}
