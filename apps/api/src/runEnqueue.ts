import type { ICreateRunResponse } from "@mosaic/api-contract";
import type { IApiConfig } from "./config.js";
import { withTransaction, type IDb } from "./db.js";
import { enqueueRun } from "./runQueue.js";

/** pg-boss job insertion and its acknowledgment share the outbox transaction.
 * A crash or failed acknowledgment rolls both back; row locks serialize publishers.
 * Unlike a time-based singleton, this also prevents replay after job completion.
 */
export async function publishRunEnqueue(
    db: IDb,
    config: IApiConfig,
    runId: string,
    enqueue: typeof enqueueRun = enqueueRun,
): Promise<ICreateRunResponse> {
    try {
        return await withTransaction(db, async (tx) => {
            const pending = (
                await tx.query<{ jobId: string }>(
                    `select job_id as "jobId" from run_enqueue_outbox
                 where run_id=$1 and status='pending_enqueue' and available_at <= now()
                 for update skip locked`,
                    [runId],
                )
            ).rows[0];
            if (!pending) {
                const current = (
                    await tx.query<{ status: string }>(
                        `select status from run_enqueue_outbox where run_id=$1`,
                        [runId],
                    )
                ).rows[0];
                // Historical running or terminal runs have already been dispatched
                // but have no outbox row. They are not deferred publication.
                const historical = !current
                    ? (
                          await tx.query<{ status: string }>(
                              `select status from runs where id=$1`,
                              [runId],
                          )
                      ).rows[0]
                    : undefined;
                return {
                    runId,
                    enqueueStatus:
                        current?.status === "queued" ||
                        ["running", "completed", "partial", "failed"].includes(
                            historical?.status ?? "",
                        )
                            ? "queued"
                            : "pending_enqueue",
                };
            }
            await enqueue(config, runId, { db: tx, jobId: pending.jobId });
            await tx.query(
                `update run_enqueue_outbox set status='queued',
                    publish_attempts=publish_attempts+1, queued_at=now(),
                    last_error=null, updated_at=now()
                 where run_id=$1`,
                [runId],
            );
            return { runId, enqueueStatus: "queued" };
        });
    } catch {
        // The run and publication intent already committed. Even if this update
        // fails, the pending row survives for recovery and callers retain its ID.
        try {
            await db.query(
                `update run_enqueue_outbox set publish_attempts=publish_attempts+1,
                    available_at=now() + least(interval '5 minutes',
                        interval '5 seconds' * power(2, least(publish_attempts, 10))),
                    last_error='Queue publication failed', updated_at=now()
                 where run_id=$1 and status='pending_enqueue'`,
                [runId],
            );
        } catch {
            console.error("Eval run enqueue recovery metadata update failed.", {
                runId,
            });
        }
        return { runId, enqueueStatus: "pending_enqueue" };
    }
}

export async function replayPendingRunEnqueues(
    db: IDb,
    config: IApiConfig,
    enqueue: typeof enqueueRun = enqueueRun,
    limit = 100,
): Promise<ICreateRunResponse[]> {
    const pending = await db.query<{ runId: string }>(
        `select run_id as "runId" from run_enqueue_outbox
         where status='pending_enqueue' and available_at <= now()
         order by available_at, created_at limit $1`,
        [limit],
    );
    const results: ICreateRunResponse[] = [];
    for (const row of pending.rows)
        results.push(await publishRunEnqueue(db, config, row.runId, enqueue));
    return results;
}

export function startRunEnqueueReplay(
    db: IDb,
    config: IApiConfig,
    intervalMs = 30_000,
): () => void {
    let replaying = false;
    const replay = async () => {
        if (replaying) return;
        replaying = true;
        try {
            await replayPendingRunEnqueues(db, config);
        } catch {
            console.error("Eval run enqueue replay failed.");
        } finally {
            replaying = false;
        }
    };
    void replay();
    const timer = setInterval(() => void replay(), intervalMs);
    timer.unref();
    return () => clearInterval(timer);
}
