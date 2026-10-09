export const DEFAULT_STALE_CLAIM_MS = 900_000;
export const MIN_STALE_CLAIM_MS = 60_000;

export function parseStaleClaimMs(value: string | undefined): number {
    if (value === undefined) return DEFAULT_STALE_CLAIM_MS;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return DEFAULT_STALE_CLAIM_MS;
    }
    return Math.max(MIN_STALE_CLAIM_MS, parsed);
}
