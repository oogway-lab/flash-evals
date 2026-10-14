import { logWorkerEvent, safeWorkerError } from "../jobs/workerObservability";

/**
 * Refresh a claim while long work runs, so stale-claim recovery does not
 * requeue a cell or item that is still transcribing (which would pay for the
 * same provider work twice). Returns a stop function.
 */
export function startLeaseHeartbeat(
    refresh: () => Promise<unknown>,
    leaseMs: number,
    context: Record<string, unknown>,
): () => void {
    const intervalMs = Math.max(
        1_000,
        Math.min(60_000, Math.floor(leaseMs / 3)),
    );
    let inFlight = false;
    const timer = setInterval(() => {
        if (inFlight) return;
        inFlight = true;
        refresh()
            .catch((error: unknown) =>
                logWorkerEvent("warn", "workflow_lease.heartbeat_failed", {
                    ...context,
                    ...safeWorkerError(error),
                }),
            )
            .finally(() => {
                inFlight = false;
            });
    }, intervalMs);
    timer.unref?.();
    return () => clearInterval(timer);
}
