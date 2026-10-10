import PgBoss from "pg-boss";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { runs, runCells } from "../db/schema";
import { executeRun } from "../runs/executor";
import { parseStaleClaimMs } from "./claimLease";
import { logWorkerEvent, safeWorkerError } from "./workerObservability";
import { RUN_QUEUE } from "./queueNames";

export { RUN_QUEUE } from "./queueNames";

interface RunJob {
    runId: string;
}

let boss: PgBoss | undefined;
let workerStarted = false;
let stopping = false;
let recoveryTimer: ReturnType<typeof setInterval> | undefined;
let recoveryInFlight: Promise<void> | undefined;
let stopPromise: Promise<{ remainingInFlight: number }> | undefined;
let activeJobs = 0;
const staleClaimMs = parseStaleClaimMs(process.env.RUN_STALE_CLAIM_MS);

async function getBoss(): Promise<PgBoss> {
    if (!boss) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        const instance = new PgBoss({ connectionString: url, max: 2 });
        instance.on("error", (error) => {
            logWorkerEvent("error", "queue.error", {
                queue: RUN_QUEUE,
                ...safeWorkerError(error),
            });
        });
        await instance.start();
        await instance.createQueue(RUN_QUEUE);
        boss = instance;
    }
    return boss;
}

export async function enqueueRun(runId: string): Promise<void> {
    const b = await getBoss();
    await b.send(RUN_QUEUE, { runId });
}

export async function startRunWorker(): Promise<void> {
    if (workerStarted) return;
    stopping = false;
    stopPromise = undefined;
    workerStarted = true;
    try {
        await recoverOrphanedRuns();
        const b = await getBoss();
        await b.work<RunJob>(
            RUN_QUEUE,
            { includeMetadata: true },
            async (jobs) => {
                for (const job of jobs) {
                    const startedAt = Date.now();
                    activeJobs += 1;
                    logWorkerEvent("info", "job.started", {
                        queue: RUN_QUEUE,
                        runId: job.data.runId,
                        jobId: job.id,
                        retryCount: job.retryCount,
                        retryLimit: job.retryLimit,
                    });
                    const heartbeat = startClaimHeartbeat(job.data.runId);
                    try {
                        await executeRun(job.data.runId);
                        logWorkerEvent("info", "job.completed", {
                            queue: RUN_QUEUE,
                            runId: job.data.runId,
                            jobId: job.id,
                            durationMs: Date.now() - startedAt,
                        });
                    } catch (error) {
                        logWorkerEvent("error", "job.failed", {
                            queue: RUN_QUEUE,
                            runId: job.data.runId,
                            jobId: job.id,
                            retryCount: job.retryCount,
                            retryLimit: job.retryLimit,
                            durationMs: Date.now() - startedAt,
                            ...safeWorkerError(error),
                        });
                    } finally {
                        clearInterval(heartbeat);
                        activeJobs -= 1;
                    }
                }
            },
        );
        startRecoverySweep();
        logWorkerEvent("info", "worker.queue_ready", { queue: RUN_QUEUE });
    } catch (error) {
        workerStarted = false;
        throw error;
    }
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
    const instance = boss;
    boss = undefined;
    workerStarted = false;

    stopPromise = (async () => {
        await recoveryInFlight;
        if (instance) {
            await instance.stop({ graceful: true, timeout: timeoutMs });
        }
        return { remainingInFlight: activeJobs };
    })();
    return stopPromise;
}

function startClaimHeartbeat(runId: string): ReturnType<typeof setInterval> {
    const timer = setInterval(
        () => {
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
