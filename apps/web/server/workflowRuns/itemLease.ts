export const workflowItemLeaseMs = 5 * 60_000;
/**
 * Longest a waiter tolerates a claim whose heartbeat has not advanced. The
 * owner refreshes `claimedAt` while it works, so long transcriptions are
 * waited for; a stalled owner is taken over once its lease expires.
 */
export const workflowPreparationWaitMs = workflowItemLeaseMs + 60_000;

/** Extend the wait deadline whenever the owner's heartbeat moved forward. */
export function nextPreparationWaitDeadline(
    state: { deadlineMs: number; lastClaimedAtMs?: number },
    claimedAt: Date | string | null | undefined,
    nowMs: number,
): { deadlineMs: number; lastClaimedAtMs?: number } {
    const claimedAtMs = claimedAt ? new Date(claimedAt).getTime() : undefined;
    if (
        claimedAtMs === undefined ||
        (state.lastClaimedAtMs !== undefined &&
            claimedAtMs <= state.lastClaimedAtMs)
    )
        return state;
    return {
        deadlineMs:
            state.lastClaimedAtMs === undefined
                ? state.deadlineMs
                : nowMs + workflowPreparationWaitMs,
        lastClaimedAtMs: claimedAtMs,
    };
}

export function preparationLeaseExpired(
    row: { preparationStatus: string; claimedAt?: Date | string | null },
    nowMs: number,
): boolean {
    if (row.preparationStatus === "pending") return true;
    if (!row.claimedAt) return false;
    return new Date(row.claimedAt).getTime() <= nowMs - workflowItemLeaseMs;
}

export function nextPreparationPollDelay(delayMs: number): number {
    return Math.min(delayMs * 2, 1_000);
}
