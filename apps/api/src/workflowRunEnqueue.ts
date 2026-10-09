import type { ICreateWorkflowRunResponse } from "@mosaic/api-contract";
import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";
import { withTransaction } from "./db.js";
import { enqueueWorkflowRun } from "./runQueue.js";

interface IWorkflowRunEnqueueRow {
    workflowRunId: string;
    status: "pending_enqueue" | "publishing" | "queued" | "failed";
}

type EnqueueWorkflowRun = (
    config: IApiConfig,
    workflowRunId: string,
) => Promise<void>;

export async function publishWorkflowRunEnqueue(
    db: IDb,
    config: IApiConfig,
    workflowRunId: string,
    enqueue: EnqueueWorkflowRun = enqueueWorkflowRun,
): Promise<ICreateWorkflowRunResponse> {
    const claimed = (
        await db.query<IWorkflowRunEnqueueRow>(
            `update workflow_run_enqueue_outbox
            set status = 'publishing',
                available_at = now() + interval '2 minutes',
                updated_at = now()
            where workflow_run_id = $1
              and status in ('pending_enqueue', 'publishing')
              and available_at <= now()
            returning workflow_run_id as "workflowRunId", status`,
            [workflowRunId],
        )
    ).rows[0];
    if (!claimed) {
        const current = (
            await db.query<IWorkflowRunEnqueueRow>(
                `select workflow_run_id as "workflowRunId", status
                from workflow_run_enqueue_outbox
                where workflow_run_id = $1`,
                [workflowRunId],
            )
        ).rows[0];
        return {
            workflowRunId,
            enqueueStatus:
                current?.status === "queued" ? "queued" : "pending_enqueue",
        };
    }

    try {
        await enqueue(config, workflowRunId);
    } catch {
        await withTransaction(db, async (tx) => {
            await tx.query(
                `update workflow_run_enqueue_outbox
                set status = 'pending_enqueue',
                    publish_attempts = publish_attempts + 1,
                    available_at = now() + least(
                        interval '5 minutes',
                        interval '5 seconds' * power(2, publish_attempts)
                    ),
                    last_error = 'Queue publication failed',
                    updated_at = now()
                where workflow_run_id = $1 and status = 'publishing'`,
                [workflowRunId],
            );
            await tx.query(
                `update workflow_runs
                set enqueue_status = 'pending_enqueue'
                where id = $1 and enqueue_status <> 'queued'`,
                [workflowRunId],
            );
        });
        return { workflowRunId, enqueueStatus: "pending_enqueue" };
    }

    await withTransaction(db, async (tx) => {
        await tx.query(
            `update workflow_run_enqueue_outbox
            set status = 'queued',
                publish_attempts = publish_attempts + 1,
                queued_at = coalesce(queued_at, now()),
                last_error = null,
                updated_at = now()
            where workflow_run_id = $1`,
            [workflowRunId],
        );
        await tx.query(
            `update workflow_runs
            set enqueue_status = 'queued'
            where id = $1`,
            [workflowRunId],
        );
    });
    return { workflowRunId, enqueueStatus: "queued" };
}

export async function replayPendingWorkflowRunEnqueues(
    db: IDb,
    config: IApiConfig,
    enqueue: EnqueueWorkflowRun = enqueueWorkflowRun,
    limit = 100,
): Promise<ICreateWorkflowRunResponse[]> {
    const pending = await db.query<{ workflowRunId: string }>(
        `select workflow_run_id as "workflowRunId"
        from workflow_run_enqueue_outbox
        where status in ('pending_enqueue', 'publishing')
          and available_at <= now()
        order by available_at, created_at
        limit $1`,
        [limit],
    );
    const results: ICreateWorkflowRunResponse[] = [];
    for (const row of pending.rows)
        results.push(
            await publishWorkflowRunEnqueue(
                db,
                config,
                row.workflowRunId,
                enqueue,
            ),
        );
    return results;
}

export function startWorkflowRunEnqueueReplay(
    db: IDb,
    config: IApiConfig,
    intervalMs = 30_000,
): () => void {
    let replaying = false;
    const replay = async () => {
        if (replaying) return;
        replaying = true;
        try {
            await replayPendingWorkflowRunEnqueues(db, config);
        } catch {
            console.error("Workflow run enqueue replay failed.");
        } finally {
            replaying = false;
        }
    };
    void replay();
    const timer = setInterval(() => void replay(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
}
