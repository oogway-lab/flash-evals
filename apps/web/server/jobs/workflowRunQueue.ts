import { PgBoss } from "pg-boss";
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from "drizzle-orm";
import { redactSecrets } from "@flash-evals/secrets";
import { db } from "../db/client";
import { errorMessage } from "../lib/errors";
import { runs, workflowRunCells, workflowRuns } from "../db/schema";
import { executeWorkflowRun } from "../workflowRuns/executor";
import { parseStaleClaimMs } from "./claimLease";
import {
    logQueueWarning,
    logWorkerEvent,
    safeWorkerError,
} from "./workerObservability";
import {
    PG_BOSS_SCHEMA,
    WORKFLOW_RUN_JOB_OPTIONS,
    WORKFLOW_RUN_QUEUE,
    WORKFLOW_RUN_QUEUE_OPTIONS,
} from "./queueNames";

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
        boss = new PgBoss({
            connectionString: url,
            max: 2,
            schema: PG_BOSS_SCHEMA,
        });
        boss.on("error", (error) => {
            logWorkerEvent("error", "queue.error", {
                queue: WORKFLOW_RUN_QUEUE,
                ...safeWorkerError(error),
            });
        });
        boss.on("warning", (warning) =>
            logQueueWarning(WORKFLOW_RUN_QUEUE, warning),
        );
        await boss.start();
        // pg-boss enforces singletonKey only on non-standard queues;
        // "stately" keeps one created and one active job per run. Matches the
        // API publisher; every send to this queue carries a singletonKey.
        // The policy is fixed at creation: pg-boss 11+ rejects policy updates.
        await boss.createQueue(WORKFLOW_RUN_QUEUE, WORKFLOW_RUN_QUEUE_OPTIONS);
        // Expiry and retries can be updated; an existing queue keeps pg-boss's
        // 15-minute default otherwise.
        await boss.updateQueue(WORKFLOW_RUN_QUEUE, WORKFLOW_RUN_JOB_OPTIONS);
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
            ...WORKFLOW_RUN_JOB_OPTIONS,
            // With the stately queue policy, at most one queued and one
            // running job per run, so recovery and retries cannot stack.
            singletonKey: workflowRunId,
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
    await queueWaitingComparisonPipelines();
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

/**
 * Queues the pipeline runs whose steps have all finished and whose final
 * answers wait for the eval run they are compared with (in a setup
 * comparison or not), once that eval run has finished (one eval run when
 * given, else every one). Their next pass scores the answers and ends the run. The eval
 * run's worker calls this when it finishes; the recovery sweep calls it too,
 * so a missed call never leaves a pipeline run waiting. Sends carry the run's
 * singleton key, so a run already queued is not queued twice.
 */
export async function queueWaitingComparisonPipelines(
    evalRunId?: string,
): Promise<number> {
    const waiting = await db
        .selectDistinct({ id: workflowRuns.id })
        .from(workflowRuns)
        // Joined on the eval run the pipeline run is compared with, so a
        // run compared outside a setup comparison is queued too.
        .innerJoin(
            runs,
            sql`${runs.id}::text = ${workflowRuns.configSnapshot} #>> '{comparison,runId}'`,
        )
        .where(
            and(
                eq(workflowRuns.status, "running"),
                notInArray(runs.status, ["pending", "running"]),
                evalRunId ? eq(runs.id, evalRunId) : undefined,
                sql`not exists (
                    select 1 from ${workflowRunCells}
                    where ${workflowRunCells.workflowRunId} = ${workflowRuns.id}
                      and ${workflowRunCells.status} in ('pending', 'running')
                )`,
            ),
        );
    for (const run of waiting) await enqueueWorkflowRun(run.id);
    if (waiting.length > 0)
        logWorkerEvent("info", "comparison.pipelines_queued_for_scoring", {
            queue: WORKFLOW_RUN_QUEUE,
            ...(evalRunId ? { runId: evalRunId } : {}),
            recoveredCount: waiting.length,
        });
    return waiting.length;
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
        await b.work<IWorkflowRunJob, void, { includeMetadata: true }>(
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
                        // Setup failed: the run is failed with the error and
                        // the app offers Retry, so the job is not retried.
                        const failedBeforeStart =
                            await failWorkflowRunThatNeverStarted(
                                job.data.workflowRunId,
                                error,
                            ).catch((markError: unknown) => {
                                logWorkerEvent(
                                    "error",
                                    "run.failure_persist_failed",
                                    {
                                        queue: WORKFLOW_RUN_QUEUE,
                                        workflowRunId: job.data.workflowRunId,
                                        ...safeWorkerError(markError),
                                    },
                                );
                                return false;
                            });
                        if (failedBeforeStart) continue;
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
                                .set({
                                    status: "failed",
                                    error: runErrorText(error),
                                })
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

const MAX_RUN_ERROR_CHARS = 1_000;

function runErrorText(error: unknown): string {
    return redactSecrets(errorMessage(error)).slice(0, MAX_RUN_ERROR_CHARS);
}

/**
 * A pipeline run whose pass failed during setup (still pending: the worker
 * sets it running once setup is done) is marked failed with the redacted
 * error, so the app shows why and offers Retry instead of leaving it
 * pending. Returns whether it did; a run that had started is left to the
 * job's retries.
 */
export async function failWorkflowRunThatNeverStarted(
    workflowRunId: string,
    error: unknown,
): Promise<boolean> {
    const rows = await db
        .update(workflowRuns)
        .set({ status: "failed", error: runErrorText(error) })
        .where(
            and(
                eq(workflowRuns.id, workflowRunId),
                eq(workflowRuns.status, "pending"),
            ),
        )
        .returning({ id: workflowRuns.id });
    return rows.length > 0;
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
