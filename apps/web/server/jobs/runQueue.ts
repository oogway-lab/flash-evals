import { PgBoss, type JobWithMetadata } from "pg-boss";
import { and, eq, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { redactSecrets } from "@flash-evals/secrets";
import { db } from "../db/client";
import { runs, runCells } from "../db/schema";
import { executeRun } from "../runs/executor";
import { queueWaitingComparisonPipelines } from "./workflowRunQueue";
import { errorMessage } from "../lib/errors";
import { runSlots } from "../lib/concurrency";
import { parseStaleClaimMs } from "./claimLease";
import {
    acquireRunExecutionLease,
    refreshRunExecutionLease,
    releaseRunExecutionLease,
} from "./runExecutionLease";
import {
    logQueueWarning,
    logWorkerEvent,
    safeWorkerError,
} from "./workerObservability";
import { PG_BOSS_SCHEMA, RUN_JOB_OPTIONS, RUN_QUEUE } from "./queueNames";

export { RUN_QUEUE } from "./queueNames";

interface RunJob {
    runId: string;
}

let boss: PgBoss | undefined;
let workerStarted = false;
let stopping = false;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let recoveryInFlight: Promise<void> | undefined;
let startPromise: Promise<void> | undefined;
let stopPromise: Promise<{ remainingInFlight: number }> | undefined;
let activeJobs = 0;
const staleClaimMs = parseStaleClaimMs(process.env.RUN_STALE_CLAIM_MS);
/**
 * How long a job that found the run busy waits before trying again. Short,
 * so a Retry right after a pass ends is not held up by the stale window; a
 * dead pass's lease is still taken over once it is stale.
 */
const BUSY_RETRY_SECONDS = 60;

async function getBoss(): Promise<PgBoss> {
    if (!boss) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        const instance = new PgBoss({
            connectionString: url,
            max: 2,
            schema: PG_BOSS_SCHEMA,
        });
        instance.on("error", (error) => {
            logWorkerEvent("error", "queue.error", {
                queue: RUN_QUEUE,
                ...safeWorkerError(error),
            });
        });
        instance.on("warning", (warning) =>
            logQueueWarning(RUN_QUEUE, warning),
        );
        await instance.start();
        await instance.createQueue(RUN_QUEUE, RUN_JOB_OPTIONS);
        // createQueue leaves an existing queue's settings alone, so a queue
        // created with pg-boss's defaults (15-minute expiry, 2 retries) is
        // updated here too. Every send also carries the options.
        await instance.updateQueue(RUN_QUEUE, RUN_JOB_OPTIONS);
        boss = instance;
    }
    return boss;
}

export async function enqueueRun(
    runId: string,
    options: { startAfterSeconds?: number } = {},
): Promise<void> {
    const b = await getBoss();
    await b.send(
        RUN_QUEUE,
        { runId },
        {
            ...RUN_JOB_OPTIONS,
            ...(options.startAfterSeconds
                ? { startAfter: options.startAfterSeconds }
                : {}),
        },
    );
}

export function startRunWorker(): Promise<void> {
    if (workerStarted) return startPromise ?? Promise.resolve();
    stopping = false;
    stopPromise = undefined;
    workerStarted = true;
    startPromise = (async () => {
        await recoverOrphanedRuns();
        if (stopping) return;
        const b = await getBoss();
        if (stopping) return;
        await b.work<
            RunJob,
            void,
            { includeMetadata: true; localConcurrency: number }
        >(
            RUN_QUEUE,
            { includeMetadata: true, localConcurrency: runSlots() },
            async (jobs) => {
                for (const job of jobs) await handleRunJob(job);
            },
        );
        if (stopping) {
            await b.offWork(RUN_QUEUE);
            return;
        }
        startRecoverySweep();
        logWorkerEvent("info", "worker.queue_ready", { queue: RUN_QUEUE });
    })().catch((error: unknown) => {
        workerStarted = false;
        throw error;
    });
    return startPromise;
}

async function handleRunJob(job: JobWithMetadata<RunJob>): Promise<void> {
    const runId = job.data.runId;
    const leaseId = await acquireRunExecutionLease(runId, staleClaimMs);
    if (!leaseId) {
        // Another pass is executing this run (or just finishing). Check again
        // shortly; a run whose worker died is resumed once its lease is stale.
        logWorkerEvent("warn", "job.deferred_run_busy", {
            queue: RUN_QUEUE,
            runId,
            jobId: job.id,
        });
        await enqueueRun(runId, {
            startAfterSeconds: Math.min(
                BUSY_RETRY_SECONDS,
                Math.ceil(staleClaimMs / 1000),
            ),
        });
        return;
    }
    const startedAt = Date.now();
    activeJobs += 1;
    logWorkerEvent("info", "job.started", {
        queue: RUN_QUEUE,
        runId,
        jobId: job.id,
        retryCount: job.retryCount,
        retryLimit: job.retryLimit,
    });
    const lease = { lost: false };
    const heartbeat = startClaimHeartbeat(runId, leaseId, lease);
    try {
        await executeRun(runId, { leaseLost: () => lease.lost });
        logWorkerEvent("info", "job.completed", {
            queue: RUN_QUEUE,
            runId,
            jobId: job.id,
            durationMs: Date.now() - startedAt,
        });
    } catch (error) {
        logWorkerEvent("error", "job.failed", {
            queue: RUN_QUEUE,
            runId,
            jobId: job.id,
            retryCount: job.retryCount,
            retryLimit: job.retryLimit,
            durationMs: Date.now() - startedAt,
            ...safeWorkerError(error),
        });
        await failRunThatNeverStarted(runId, error).catch((markError) =>
            logWorkerEvent("error", "run.failure_persist_failed", {
                queue: RUN_QUEUE,
                runId,
                ...safeWorkerError(markError),
            }),
        );
    } finally {
        clearInterval(heartbeat);
        // Released first, so a Retry queued as the pass ends is not deferred.
        await releaseRunExecutionLease(runId, leaseId).catch((error) =>
            logWorkerEvent("error", "run_lease.release_failed", {
                queue: RUN_QUEUE,
                runId,
                ...safeWorkerError(error),
            }),
        );
        // A setup comparison's pipeline runs score their answers once this
        // eval run has finished.
        await queueWaitingComparisonPipelines(runId).catch((error: unknown) =>
            logWorkerEvent("error", "comparison.queue_pipelines_failed", {
                queue: RUN_QUEUE,
                runId,
                ...safeWorkerError(error),
            }),
        );
        activeJobs -= 1;
    }
}

const MAX_RUN_ERROR_CHARS = 1_000;

/**
 * A run whose pass failed before it started any cell (still pending: the
 * worker sets it running only once setup is done) would otherwise stay
 * pending forever with its job completed. It is marked failed with the
 * redacted error, so the app shows why and offers Retry. A run that did
 * start is left to stale-claim recovery.
 */
export async function failRunThatNeverStarted(
    runId: string,
    error: unknown,
): Promise<void> {
    const message = redactSecrets(errorMessage(error)).slice(
        0,
        MAX_RUN_ERROR_CHARS,
    );
    await db
        .update(runs)
        .set({ status: "failed", error: message })
        .where(and(eq(runs.id, runId), eq(runs.status, "pending")));
}

function startRecoverySweep(): void {
    if (recoveryTimer) clearInterval(recoveryTimer);
    recoveryTimer = setInterval(
        () => {
            if (stopping || recoveryInFlight) return;
            const current = recoverOrphanedRuns()
                .catch((error) => {
                    logWorkerEvent("error", "recovery.failed", {
                        queue: RUN_QUEUE,
                        ...safeWorkerError(error),
                    });
                })
                .finally(() => {
                    if (recoveryInFlight === current)
                        recoveryInFlight = undefined;
                });
            recoveryInFlight = current;
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    recoveryTimer.unref();
}

export async function stopRunWorker(
    timeoutMs = 20_000,
): Promise<{ remainingInFlight: number }> {
    if (stopPromise) return stopPromise;
    stopping = true;
    if (recoveryTimer) clearInterval(recoveryTimer);
    recoveryTimer = undefined;
    const deadline = Date.now() + timeoutMs;
    const starting = startPromise;
    const instanceAtStop = boss;

    stopPromise = (async () => {
        let quiesceError: unknown;
        const quiesce = async (instance: PgBoss | undefined) => {
            if (!instance) return;
            try {
                // Stop polling immediately, while keeping this instance available
                // to the recovery sweep until its durable requeues have finished.
                await instance.offWork(RUN_QUEUE);
            } catch (error) {
                quiesceError = error;
                logWorkerEvent("error", "queue.quiesce_failed", {
                    queue: RUN_QUEUE,
                    ...safeWorkerError(error),
                });
            }
        };
        await quiesce(instanceAtStop);
        await starting?.catch(() => undefined);
        const instance = boss;
        if (instance !== instanceAtStop) await quiesce(instance);
        await recoveryInFlight;
        if (instance) {
            if (boss === instance) boss = undefined;
            await instance.stop({
                graceful: true,
                timeout: Math.max(1_000, deadline - Date.now()),
            });
        }
        startPromise = undefined;
        workerStarted = false;
        if (quiesceError) throw quiesceError;
        return { remainingInFlight: activeJobs };
    })();
    return stopPromise;
}

function startClaimHeartbeat(
    runId: string,
    leaseId: string,
    lease: { lost: boolean },
): ReturnType<typeof setInterval> {
    const timer = setInterval(
        () => {
            if (lease.lost) return;
            void refreshRunExecutionLease(runId, leaseId)
                .then((held) => {
                    if (held) return;
                    // Another pass took the run over: this one stops
                    // starting cells and leaves the run to it.
                    lease.lost = true;
                    logWorkerEvent("warn", "run_lease.lost", {
                        queue: RUN_QUEUE,
                        runId,
                    });
                })
                .catch((error) =>
                    logWorkerEvent("error", "run_lease.heartbeat_failed", {
                        queue: RUN_QUEUE,
                        runId,
                        ...safeWorkerError(error),
                    }),
                );
            void db
                .update(runCells)
                .set({ claimedAt: new Date() })
                .where(eq(runCells.runId, runId))
                .catch((error) =>
                    logWorkerEvent("error", "claim_heartbeat.failed", {
                        queue: RUN_QUEUE,
                        runId,
                        ...safeWorkerError(error),
                    }),
                );
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    timer.unref();
    return timer;
}

export async function recoverOrphanedRuns(nowMs = Date.now()): Promise<void> {
    if (stopping) return;
    const cutoff = new Date(nowMs - staleClaimMs);
    await recoverRunsStuckInSetup(cutoff);
    const rows = await db
        .select({
            id: runs.id,
            cellStatus: runCells.status,
            claimedAt: runCells.claimedAt,
        })
        .from(runs)
        .innerJoin(runCells, eq(runCells.runId, runs.id))
        .where(eq(runs.status, "running"));
    const byRun = new Map<string, typeof rows>();
    for (const row of rows) {
        const cells = byRun.get(row.id);
        if (cells) cells.push(row);
        else byRun.set(row.id, [row]);
    }
    const ids = [...byRun]
        .filter(([, cells]) => shouldRecoverRun(cells, cutoff))
        .map(([id]) => id);
    if (ids.length === 0) return;
    await db
        .update(runCells)
        .set({ status: "pending", claimedAt: null })
        .where(
            and(
                inArray(runCells.runId, ids),
                eq(runCells.status, "running"),
                or(isNull(runCells.claimedAt), lt(runCells.claimedAt, cutoff)),
            ),
        );
    await db
        .update(runs)
        .set({ status: "pending" })
        .where(inArray(runs.id, ids));
    for (const id of ids) await enqueueRun(id);
    logWorkerEvent("warn", "recovery.completed", {
        queue: RUN_QUEUE,
        recoveredCount: ids.length,
    });
}

/**
 * A pending run whose pass died during setup (before it set the run
 * running) keeps a lease no heartbeat refreshes, and its pg-boss job stays
 * active until it expires. Its stale lease is cleared and the run queued
 * again.
 */
async function recoverRunsStuckInSetup(cutoff: Date): Promise<void> {
    const stuck = await db
        .update(runs)
        .set({ executionLeaseId: null, executionLeaseAt: null })
        .where(
            and(
                eq(runs.status, "pending"),
                isNotNull(runs.executionLeaseId),
                or(
                    isNull(runs.executionLeaseAt),
                    lt(runs.executionLeaseAt, cutoff),
                ),
            ),
        )
        .returning({ id: runs.id });
    for (const { id } of stuck) await enqueueRun(id);
    if (stuck.length > 0)
        logWorkerEvent("warn", "recovery.completed", {
            queue: RUN_QUEUE,
            phase: "setup",
            recoveredCount: stuck.length,
        });
}

function shouldRecoverRun(
    cells: Array<{ cellStatus: string; claimedAt: Date | null }>,
    cutoff: Date,
): boolean {
    const running = cells.filter((cell) => cell.cellStatus === "running");
    if (running.length === 0) {
        return cells.every(
            (cell) =>
                !cell.claimedAt || cell.claimedAt.getTime() < cutoff.getTime(),
        );
    }
    return running.some(
        (cell) =>
            !cell.claimedAt || cell.claimedAt.getTime() < cutoff.getTime(),
    );
}
