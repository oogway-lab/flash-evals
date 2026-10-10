import PgBoss from "pg-boss";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { workflowRunCells, workflowRuns } from "../db/schema";
import { executeWorkflowRun } from "../workflowRuns/executor";
import { parseStaleClaimMs } from "./claimLease";
import { logWorkerEvent, safeWorkerError } from "./workerObservability";
import { WORKFLOW_RUN_QUEUE } from "./queueNames";

export { WORKFLOW_RUN_QUEUE } from "./queueNames";
interface IWorkflowRunJob {
    workflowRunId: string;
}
const staleClaimMs = parseStaleClaimMs(process.env.WORKFLOW_STALE_CLAIM_MS);
let boss: PgBoss | undefined;
let workerStarted = false;
let stopping = false;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let recoveryInFlight: Promise<void> | undefined;
let startPromise: Promise<void> | undefined;
let stopPromise: Promise<{ remainingInFlight: number }> | undefined;
let activeJobs = 0;

async function getBoss() {
    if (!boss) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        boss = new PgBoss({ connectionString: url, max: 2 });
        boss.on("error", (error) => {
            logWorkerEvent("error", "queue.error", {
                queue: WORKFLOW_RUN_QUEUE,
                ...safeWorkerError(error),
            });
        });
        await boss.start();
        await boss.createQueue(WORKFLOW_RUN_QUEUE);
    }
    return boss;
}

export async function enqueueWorkflowRun(workflowRunId: string) {
    await (
        await getBoss()
    ).send(
        WORKFLOW_RUN_QUEUE,
        { workflowRunId },
        {
            retryLimit: 3,
            retryBackoff: true,
        },
    );
}

export async function recoverOrphanedWorkflowRuns() {
    if (stopping) return;
    const cutoff = new Date(Date.now() - staleClaimMs);
    const stuck = await db
        .selectDistinct({ id: workflowRuns.id })
        .from(workflowRuns)
        .innerJoin(
            workflowRunCells,
            eq(workflowRunCells.workflowRunId, workflowRuns.id),
        )
        .where(
            and(
                eq(workflowRuns.status, "running"),
                eq(workflowRunCells.status, "running"),
                or(
                    isNull(workflowRunCells.claimedAt),
                    lt(workflowRunCells.claimedAt, cutoff),
                ),
            ),
        );
    if (stuck.length === 0) return;
    const ids = stuck.map((run) => run.id);
    await db
        .update(workflowRunCells)
        .set({ status: "pending", claimedAt: null })
        .where(
            and(
                inArray(workflowRunCells.workflowRunId, ids),
                eq(workflowRunCells.status, "running"),
                or(
                    isNull(workflowRunCells.claimedAt),
                    lt(workflowRunCells.claimedAt, cutoff),
                ),
            ),
        );
    await db
        .update(workflowRuns)
        .set({ status: "pending" })
        .where(inArray(workflowRuns.id, ids));
    for (const id of ids) await enqueueWorkflowRun(id);
    logWorkerEvent("warn", "recovery.completed", {
        queue: WORKFLOW_RUN_QUEUE,
        recoveredCount: ids.length,
    });
}

export function startWorkflowRunWorker(): Promise<void> {
    if (workerStarted) return startPromise ?? Promise.resolve();
    stopping = false;
    stopPromise = undefined;
    workerStarted = true;
    startPromise = (async () => {
        await recoverOrphanedWorkflowRuns();
        if (stopping) return;
        const b = await getBoss();
        if (stopping) return;
        await b.work<IWorkflowRunJob>(
            WORKFLOW_RUN_QUEUE,
            { includeMetadata: true },
            async (jobs) => {
                for (const job of jobs) {
                    const startedAt = Date.now();
                    activeJobs += 1;
                    logWorkerEvent("info", "job.started", {
                        queue: WORKFLOW_RUN_QUEUE,
                        workflowRunId: job.data.workflowRunId,
                        jobId: job.id,
                        retryCount: job.retryCount,
                        retryLimit: job.retryLimit,
                    });
                    const heartbeat = startClaimHeartbeat(
                        job.data.workflowRunId,
                    );
                    try {
                        await executeWorkflowRun(job.data.workflowRunId);
                    } catch (error) {
                        logWorkerEvent("error", "job.failed", {
                            queue: WORKFLOW_RUN_QUEUE,
                            workflowRunId: job.data.workflowRunId,
                            jobId: job.id,
                            retryCount: job.retryCount,
                            retryLimit: job.retryLimit,
                            durationMs: Date.now() - startedAt,
                            ...safeWorkerError(error),
                        });
                        if (job.retryCount >= job.retryLimit) {
                            await db
                                .update(workflowRunCells)
                                .set({
                                    status: "failed",
                                    claimedAt: null,
                                    error: "Workflow worker exhausted retries.",
                                })
                                .where(
                                    and(
                                        eq(
                                            workflowRunCells.workflowRunId,
                                            job.data.workflowRunId,
                                        ),
                                        inArray(workflowRunCells.status, [
                                            "pending",
                                            "running",
                                        ]),
                                    ),
                                );
                            await db
                                .update(workflowRuns)
                                .set({ status: "failed" })
                                .where(
                                    eq(workflowRuns.id, job.data.workflowRunId),
                                );
                            logWorkerEvent("error", "job.retries_exhausted", {
                                queue: WORKFLOW_RUN_QUEUE,
                                workflowRunId: job.data.workflowRunId,
                                jobId: job.id,
                                retryCount: job.retryCount,
                                retryLimit: job.retryLimit,
                                durationMs: Date.now() - startedAt,
                                ...safeWorkerError(error),
                            });
                        }
                        throw error;
                    } finally {
                        clearInterval(heartbeat);
                        activeJobs -= 1;
                    }
                    logWorkerEvent("info", "job.completed", {
                        queue: WORKFLOW_RUN_QUEUE,
                        workflowRunId: job.data.workflowRunId,
                        jobId: job.id,
                        durationMs: Date.now() - startedAt,
                    });
                }
            },
        );
        if (stopping) {
            await b.offWork(WORKFLOW_RUN_QUEUE);
            return;
        }
        startRecoverySweep();
        logWorkerEvent("info", "worker.queue_ready", {
            queue: WORKFLOW_RUN_QUEUE,
        });
    })().catch((error: unknown) => {
        workerStarted = false;
        throw error;
    });
    return startPromise;
}

function startClaimHeartbeat(
    workflowRunId: string,
): ReturnType<typeof setInterval> {
    const timer = setInterval(
        () => {
            void db
                .update(workflowRunCells)
                .set({ claimedAt: new Date() })
                .where(
                    and(
                        eq(workflowRunCells.workflowRunId, workflowRunId),
                        eq(workflowRunCells.status, "running"),
                    ),
                )
                .catch((error) =>
                    logWorkerEvent("error", "claim_heartbeat.failed", {
                        queue: WORKFLOW_RUN_QUEUE,
                        workflowRunId,
                        ...safeWorkerError(error),
                    }),
                );
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    timer.unref();
    return timer;
}

function startRecoverySweep(): void {
    if (recoveryTimer) clearInterval(recoveryTimer);
    recoveryTimer = setInterval(
        () => {
            if (stopping || recoveryInFlight) return;
            const current = recoverOrphanedWorkflowRuns()
                .catch((error) => {
                    logWorkerEvent("error", "recovery.failed", {
                        queue: WORKFLOW_RUN_QUEUE,
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

export async function stopWorkflowRunWorker(
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
                await instance.offWork(WORKFLOW_RUN_QUEUE);
            } catch (error) {
                quiesceError = error;
                logWorkerEvent("error", "queue.quiesce_failed", {
                    queue: WORKFLOW_RUN_QUEUE,
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
