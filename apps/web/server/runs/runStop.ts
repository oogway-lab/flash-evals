import { and, eq, sql } from "drizzle-orm";
import type { RunStopReason } from "@flash-evals/api-contract";
import { db } from "../db/client";
import { runCells, runs } from "../db/schema";

/** How often a worker pass re-reads the run for a cancel request and its spend. */
export const STOP_POLL_MS = 2_000;

export interface IRunStopGuard {
    /**
     * Why the run should stop, or undefined to carry on: a cancel request,
     * or recorded spend at or over the run's limit. Checked before each cell
     * starts; reads the database at most once per poll interval, and once a
     * stop is seen it stays.
     */
    check(): Promise<RunStopReason | undefined>;
    readonly reason: RunStopReason | undefined;
}

/**
 * A stop guard that also estimates spend not yet recorded: what cells
 * finished since the last read paid, and an average cell's cost for each
 * cell still in flight. The limit is checked against recorded spend plus
 * that estimate, so a burst of concurrent cells cannot all start just under
 * the limit. What remains: the first cells, started before any cost is
 * known (at most the run's concurrency), and cells costing more than the
 * average can still take a run over its limit.
 */
export interface ISpendTrackingStopGuard extends IRunStopGuard {
    /** A cell passed the check and started. */
    started(): void;
    /** A started cell finished, having paid `costUsd`. */
    finished(costUsd: number): void;
}

export interface IRunStopState {
    cancelRequested: boolean;
    stopReason?: RunStopReason;
}

export async function readRunStopState(runId: string): Promise<IRunStopState> {
    const [row] = await db
        .select({
            cancelRequestedAt: runs.cancelRequestedAt,
            stopReason: runs.stopReason,
        })
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
    return {
        cancelRequested: Boolean(row?.cancelRequestedAt),
        ...(row?.stopReason ? { stopReason: row.stopReason } : {}),
    };
}

/**
 * What the run has spent so far: what its cells' own calls cost when made
 * (model calls and the transcription their input needed; nothing for a
 * reused answer or transcript), plus every judge call made to score them.
 * Cells written before incurred cost was recorded count their cost unless
 * cached. A call whose cost the provider and price list could not give
 * counts as nothing.
 */
export async function readRunSpendUsd(runId: string): Promise<number> {
    const [row] = await db
        .select({
            spent: sql<
                string | number | null
            >`coalesce(sum(coalesce(${runCells.incurredCostUsd}, case when ${runCells.status} <> 'cached' then ${runCells.costUsd} end)), 0) + coalesce(sum(${runCells.judgeCostUsd}), 0)`,
        })
        .from(runCells)
        .where(eq(runCells.runId, runId));
    return Number(row?.spent ?? 0);
}

export function createRunStopGuard(
    runId: string,
    options: {
        /** The run's spend limit in USD; no limit when undefined. */
        maxCostUsd?: number;
        pollMs?: number;
        now?: () => number;
        read?: (runId: string) => Promise<IRunStopState>;
        readSpend?: (runId: string) => Promise<number>;
    } = {},
): ISpendTrackingStopGuard {
    const pollMs = options.pollMs ?? STOP_POLL_MS;
    const now = options.now ?? Date.now;
    const read = options.read ?? readRunStopState;
    const readSpend = options.readSpend ?? readRunSpendUsd;
    const maxCostUsd = options.maxCostUsd;
    let reason: RunStopReason | undefined;
    let checkedAt = Number.NEGATIVE_INFINITY;
    let inFlight: Promise<RunStopReason | undefined> | undefined;
    // Spend as last read, and what this pass's cells paid since then.
    let spentAtPoll = 0;
    let paidSincePoll = 0;
    let cellsRunning = 0;
    let cellsFinished = 0;
    let paidByFinished = 0;

    const estimatedSpend = () =>
        spentAtPoll +
        paidSincePoll +
        (cellsFinished > 0
            ? (paidByFinished / cellsFinished) * cellsRunning
            : 0);
    const overLimit = () =>
        maxCostUsd !== undefined && estimatedSpend() >= maxCostUsd;

    const poll = async (): Promise<RunStopReason | undefined> => {
        const state = await read(runId);
        if (state.cancelRequested) reason ??= state.stopReason ?? "cancelled";
        else if (maxCostUsd !== undefined && !reason) {
            const paidBeforeRead = paidSincePoll;
            spentAtPoll = await readSpend(runId);
            // Paid while reading may or may not be in the read; kept, so the
            // estimate errs high.
            paidSincePoll -= paidBeforeRead;
            if (overLimit()) reason = "spend_cap";
        }
        checkedAt = now();
        return reason;
    };

    return {
        get reason() {
            return reason;
        },
        async check() {
            if (reason) return reason;
            if (now() - checkedAt >= pollMs) {
                inFlight ??= poll().finally(() => {
                    inFlight = undefined;
                });
                await inFlight;
            }
            if (!reason && overLimit()) reason = "spend_cap";
            return reason;
        },
        started() {
            cellsRunning += 1;
        },
        finished(costUsd) {
            const paid = Number.isFinite(costUsd) && costUsd > 0 ? costUsd : 0;
            cellsRunning = Math.max(0, cellsRunning - 1);
            cellsFinished += 1;
            paidByFinished += paid;
            paidSincePoll += paid;
        },
    };
}

/** A cell claimed by this pass but not started goes back to not run. */
export async function releaseUnstartedCell(cellId: string): Promise<void> {
    await db
        .update(runCells)
        .set({ status: "pending", claimedAt: null })
        .where(and(eq(runCells.id, cellId), eq(runCells.status, "running")));
}

/**
 * Ends a stopped run. Calls already sent have finished by now; any cell
 * still marked running was claimed but never started, so it is left pending
 * (shown as not run). The run is `cancelled` with the reason it stopped.
 */
export async function finishStoppedRun(
    runId: string,
    reason: RunStopReason,
): Promise<void> {
    await db
        .update(runCells)
        .set({ status: "pending", claimedAt: null })
        .where(and(eq(runCells.runId, runId), eq(runCells.status, "running")));
    await db
        .update(runs)
        .set({ status: "cancelled", stopReason: reason })
        .where(eq(runs.id, runId));
}
