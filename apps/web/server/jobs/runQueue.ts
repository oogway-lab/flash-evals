import PgBoss from "pg-boss";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { runs, runCells } from "../db/schema";
import { executeRun } from "../runs/executor";
import { parseStaleClaimMs } from "./claimLease";

export const RUN_QUEUE = "eval-run";

interface RunJob {
    runId: string;
}

let boss: PgBoss | undefined;
let workerStarted = false;
const staleClaimMs = parseStaleClaimMs(process.env.RUN_STALE_CLAIM_MS);

async function getBoss(): Promise<PgBoss> {
    if (!boss) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        const instance = new PgBoss({ connectionString: url, max: 2 });
        instance.on("error", (e) => console.error("pg-boss error:", e));
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
    workerStarted = true;
    try {
        await recoverOrphanedRuns();
        const b = await getBoss();
        await b.work<RunJob>(RUN_QUEUE, async (jobs) => {
            for (const job of jobs) {
                const heartbeat = startClaimHeartbeat(job.data.runId);
                try {
                    await executeRun(job.data.runId);
                } catch (err) {
                    console.error(`run ${job.data.runId} failed:`, err);
                } finally {
                    clearInterval(heartbeat);
                }
            }
        });
        startRecoverySweep();
    } catch (error) {
        workerStarted = false;
        throw error;
    }
}

function startRecoverySweep(): void {
    let active = false;
    const timer = setInterval(
        () => {
            if (active) return;
            active = true;
            void recoverOrphanedRuns()
                .catch((error) =>
                    console.error("run stale-claim recovery failed:", error),
                )
                .finally(() => {
                    active = false;
                });
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    timer.unref();
}

function startClaimHeartbeat(runId: string): ReturnType<typeof setInterval> {
    const timer = setInterval(
        () => {
            void db
                .update(runCells)
                .set({ claimedAt: new Date() })
                .where(eq(runCells.runId, runId))
                .catch((error) =>
                    console.error(
                        `run ${runId} claim heartbeat failed:`,
                        error,
                    ),
                );
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    timer.unref();
    return timer;
}

export async function recoverOrphanedRuns(nowMs = Date.now()): Promise<void> {
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
    console.info(`recovered ${ids.length} orphaned run(s)`);
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
