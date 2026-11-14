import { and, eq, sql } from "drizzle-orm";
import type { RunStopReason } from "@flash-evals/api-contract";
import { db } from "../db/client";
import {
    workflowRunAnswers,
    workflowRunCells,
    workflowRunItems,
    workflowRuns,
} from "../db/schema";
import { createRunStopGuard, type IRunStopState } from "../runs/runStop";

export async function readWorkflowRunStopState(
    workflowRunId: string,
): Promise<IRunStopState> {
    const [row] = await db
        .select({
            cancelRequestedAt: workflowRuns.cancelRequestedAt,
            stopReason: workflowRuns.stopReason,
        })
        .from(workflowRuns)
        .where(eq(workflowRuns.id, workflowRunId))
        .limit(1);
    return {
        cancelRequested: Boolean(row?.cancelRequestedAt),
        ...(row?.stopReason ? { stopReason: row.stopReason } : {}),
    };
}

/**
 * What a pipeline run has spent so far: its steps' recorded model calls,
 * the judge calls that scored them or compared its final answers with an
 * eval run's reference, and shared audio transcription. A
 * reused result records no cost (an earlier run paid for it), and a call
 * whose cost the provider and price list could not give counts as nothing.
 */
export async function readWorkflowRunSpendUsd(
    workflowRunId: string,
): Promise<number> {
    const [cells] = await db
        .select({
            spent: sql<
                string | number | null
            >`coalesce(sum(${workflowRunCells.costUsd}), 0) + coalesce(sum(${workflowRunCells.judgeCostUsd}), 0)`,
        })
        .from(workflowRunCells)
        .where(eq(workflowRunCells.workflowRunId, workflowRunId));
    const [items] = await db
        .select({
            spent: sql<
                string | number | null
            >`coalesce(sum(${workflowRunItems.incurredCostUsd}), 0)`,
        })
        .from(workflowRunItems)
        .where(eq(workflowRunItems.workflowRunId, workflowRunId));
    const [answers] = await db
        .select({
            spent: sql<
                string | number | null
            >`coalesce(sum(${workflowRunAnswers.judgeCostUsd}), 0)`,
        })
        .from(workflowRunAnswers)
        .where(eq(workflowRunAnswers.workflowRunId, workflowRunId));
    return (
        Number(cells?.spent ?? 0) +
        Number(items?.spent ?? 0) +
        Number(answers?.spent ?? 0)
    );
}

/**
 * The eval runs' stop check, reading a pipeline run: a cancel request, or
 * recorded spend at or over the run's limit (a setup comparison's member
 * passes the comparison's spend, shared by all its runs). At most one read per poll
 * interval; once a stop is seen it stays.
 */
export function createWorkflowRunStopGuard(
    workflowRunId: string,
    maxCostUsd: number | undefined,
    /** Spend that counts toward the limit; this run's own by default. */
    readSpend: (
        workflowRunId: string,
    ) => Promise<number> = readWorkflowRunSpendUsd,
) {
    return createRunStopGuard(workflowRunId, {
        ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
        read: readWorkflowRunStopState,
        readSpend,
    });
}

/**
 * Ends a stopped pipeline run. Calls already sent have finished; any step
 * still marked running never started, so it goes back to pending (shown as
 * not run). The run is `cancelled` with the reason it stopped.
 */
export async function finishStoppedWorkflowRun(
    workflowRunId: string,
    reason: RunStopReason,
): Promise<void> {
    await db
        .update(workflowRunCells)
        .set({ status: "pending", claimedAt: null })
        .where(
            and(
                eq(workflowRunCells.workflowRunId, workflowRunId),
                eq(workflowRunCells.status, "running"),
            ),
        );
    await db
        .update(workflowRuns)
        .set({ status: "cancelled", stopReason: reason })
        .where(eq(workflowRuns.id, workflowRunId));
}
