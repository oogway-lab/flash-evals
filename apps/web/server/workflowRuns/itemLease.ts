export const workflowItemLeaseMs = 5 * 60_000;
export const workflowPreparationWaitMs = workflowItemLeaseMs + 60_000;

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
