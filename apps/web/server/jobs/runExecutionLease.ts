import { randomUUID } from "node:crypto";
import { and, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { runs } from "../db/schema";

/**
 * A run-level claim so only one worker pass executes a run at a time. A
 * duplicate job (a pg-boss redelivery, a recovery requeue racing a live
 * worker, two workers) finds the lease held and is deferred instead of
 * claiming cells and paying for judge calls a second time.
 */
export async function acquireRunExecutionLease(
    runId: string,
    staleAfterMs: number,
    nowMs = Date.now(),
): Promise<string | undefined> {
    const leaseId = randomUUID();
    const rows = await db
        .update(runs)
        .set({
            executionLeaseId: leaseId,
            executionLeaseAt: new Date(nowMs),
            executionLeaseStaleMs: staleAfterMs,
        })
        .where(
            and(
                eq(runs.id, runId),
                or(
                    isNull(runs.executionLeaseId),
                    isNull(runs.executionLeaseAt),
                    lt(runs.executionLeaseAt, new Date(nowMs - staleAfterMs)),
                ),
            ),
        )
        .returning({ id: runs.id });
    return rows.length > 0 ? leaseId : undefined;
}

/**
 * Keeps this pass's lease fresh. False when the lease is no longer ours:
 * it went stale (a long pause) and another pass took the run over.
 */
export async function refreshRunExecutionLease(
    runId: string,
    leaseId: string,
): Promise<boolean> {
    const rows = await db
        .update(runs)
        .set({ executionLeaseAt: new Date() })
        .where(and(eq(runs.id, runId), eq(runs.executionLeaseId, leaseId)))
        .returning({ id: runs.id });
    return rows.length > 0;
}

export async function releaseRunExecutionLease(
    runId: string,
    leaseId: string,
): Promise<void> {
    await db
        .update(runs)
        .set({
            executionLeaseId: null,
            executionLeaseAt: null,
            executionLeaseStaleMs: null,
        })
        .where(and(eq(runs.id, runId), eq(runs.executionLeaseId, leaseId)));
}
