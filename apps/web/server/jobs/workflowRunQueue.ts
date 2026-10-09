import PgBoss from "pg-boss";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { db } from "../db/client";
import { workflowRunCells, workflowRuns } from "../db/schema";
import { executeWorkflowRun } from "../workflowRuns/executor";
import { parseStaleClaimMs } from "./claimLease";

export const WORKFLOW_RUN_QUEUE = "workflow-run";
interface IWorkflowRunJob {
    workflowRunId: string;
}
const staleClaimMs = parseStaleClaimMs(process.env.WORKFLOW_STALE_CLAIM_MS);
let boss: PgBoss | undefined;
let workerStarted = false;

async function getBoss() {
    if (!boss) {
        const url = process.env.DATABASE_URL;
        if (!url) throw new Error("DATABASE_URL is not set");
        boss = new PgBoss({ connectionString: url, max: 2 });
        boss.on("error", (error) =>
            console.error("workflow pg-boss error:", error),
        );
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
}

export async function startWorkflowRunWorker() {
    if (workerStarted) return;
    workerStarted = true;
    try {
        await recoverOrphanedWorkflowRuns();
        await (
            await getBoss()
        ).work<IWorkflowRunJob>(
            WORKFLOW_RUN_QUEUE,
            { includeMetadata: true },
            async (jobs) => {
                for (const job of jobs) {
                    const heartbeat = startClaimHeartbeat(
                        job.data.workflowRunId,
                    );
                    try {
                        await executeWorkflowRun(job.data.workflowRunId);
                    } catch (error) {
                        if (job.retryCount >= job.retryLimit) {
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            await db
                                .update(workflowRunCells)
                                .set({
                                    status: "failed",
                                    claimedAt: null,
                                    error: `Workflow worker exhausted retries: ${message}`,
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
                        }
                        throw error;
                    } finally {
                        clearInterval(heartbeat);
                    }
                }
            },
        );
        startRecoverySweep();
    } catch (error) {
        workerStarted = false;
        throw error;
    }
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
                    console.error(
                        `workflow run ${workflowRunId} claim heartbeat failed:`,
                        error,
                    ),
                );
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    timer.unref();
    return timer;
}

function startRecoverySweep(): void {
    let active = false;
    const timer = setInterval(
        () => {
            if (active) return;
            active = true;
            void recoverOrphanedWorkflowRuns()
                .catch((error) =>
                    console.error(
                        "workflow stale-claim recovery failed:",
                        error,
                    ),
                )
                .finally(() => {
                    active = false;
                });
        },
        Math.max(10_000, Math.floor(staleClaimMs / 3)),
    );
    timer.unref();
}
