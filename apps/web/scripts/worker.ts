import { closeDatabasePool } from "../server/db/client";
import { startRunWorker, stopRunWorker } from "../server/jobs/runQueue";
import {
    startWorkflowRunWorker,
    stopWorkflowRunWorker,
} from "../server/jobs/workflowRunQueue";
import {
    logWorkerEvent,
    safeWorkerError,
} from "../server/jobs/workerObservability";

const DEFAULT_DRAIN_TIMEOUT_MS = 20_000;
const MAX_DRAIN_TIMEOUT_MS = 300_000;
const SHUTDOWN_BUFFER_MS = 5_000;

let shuttingDown = false;
let startupFailed = false;

function parseDrainTimeoutMs(value: string | undefined): number {
    if (value === undefined) return DEFAULT_DRAIN_TIMEOUT_MS;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isSafeInteger(parsed) || parsed < 1_000) {
        return DEFAULT_DRAIN_TIMEOUT_MS;
    }
    return Math.min(parsed, MAX_DRAIN_TIMEOUT_MS);
}

const drainTimeoutMs = parseDrainTimeoutMs(
    process.env.MOSAIC_WORKER_DRAIN_TIMEOUT_MS,
);

async function main(): Promise<void> {
    logWorkerEvent("info", "worker.starting");
    await startRunWorker();
    if (shuttingDown) return;
    await startWorkflowRunWorker();
    if (shuttingDown) return;
    logWorkerEvent("info", "worker.ready", { readiness: "ready" });
}

function shutdown(signal: string): void {
    if (shuttingDown) {
        logWorkerEvent("error", "worker.shutdown_forced", { signal });
        process.exit(1);
    }
    shuttingDown = true;
    logWorkerEvent("warn", "worker.shutdown_started", {
        signal,
        drainTimeoutMs,
        readiness: "not_ready",
    });

    const hardExitTimer = setTimeout(() => {
        logWorkerEvent("error", "worker.shutdown_deadline_exceeded", {
            signal,
            drainTimeoutMs,
        });
        process.exit(1);
    }, drainTimeoutMs + SHUTDOWN_BUFFER_MS);

    void (async () => {
        await startupPromise;
        const stopResults = await Promise.allSettled([
            stopRunWorker(drainTimeoutMs),
            stopWorkflowRunWorker(drainTimeoutMs),
        ]);
        let remainingInFlight = 0;
        let failed = startupFailed;
        for (const result of stopResults) {
            if (result.status === "rejected") {
                failed = true;
                logWorkerEvent("error", "worker.queue_shutdown_failed", {
                    ...safeWorkerError(result.reason),
                });
            } else {
                remainingInFlight += result.value.remainingInFlight;
            }
        }

        try {
            await closeDatabasePool();
        } catch (error) {
            failed = true;
            logWorkerEvent("error", "worker.database_close_failed", {
                ...safeWorkerError(error),
            });
        }

        logWorkerEvent(
            remainingInFlight > 0 ? "error" : "info",
            remainingInFlight > 0
                ? "worker.drain_timed_out"
                : "worker.shutdown_completed",
            { signal, drainTimeoutMs, remainingInFlight },
        );
        clearTimeout(hardExitTimer);
        if (remainingInFlight > 0 || failed) process.exit(1);
    })().catch((error: unknown) => {
        logWorkerEvent("error", "worker.shutdown_failed", {
            signal,
            drainTimeoutMs,
            ...safeWorkerError(error),
        });
        process.exit(1);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const startupPromise = main().catch((error: unknown) => {
    startupFailed = true;
    process.exitCode = 1;
    logWorkerEvent("error", "worker.startup_failed", {
        ...safeWorkerError(error),
    });
    shutdown("startup_failure");
});
