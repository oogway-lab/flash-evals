import PgBoss from "pg-boss";
import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";

export const RUN_QUEUE = "eval-run";
export const WORKFLOW_RUN_QUEUE = "workflow-run";
const WORKFLOW_RUN_QUEUE_OPTIONS = {
    name: WORKFLOW_RUN_QUEUE,
    policy: "stately",
} as const;

let boss: Promise<PgBoss> | undefined;
let workflowQueueReady: Promise<void> | undefined;

/**
 * pg-boss 10 enforces `singletonKey` only on non-standard queues. "stately"
 * allows one created and one active job per key, so a run cannot be queued
 * twice while still letting a retry queue behind a finishing job. Every send
 * to this queue must carry a singletonKey. The worker applies the same policy.
 */
function ensureWorkflowRunQueue(b: PgBoss): Promise<void> {
    workflowQueueReady ??= (async () => {
        await b.createQueue(WORKFLOW_RUN_QUEUE, WORKFLOW_RUN_QUEUE_OPTIONS);
        await b.updateQueue(WORKFLOW_RUN_QUEUE, WORKFLOW_RUN_QUEUE_OPTIONS);
    })().catch((error: unknown) => {
        workflowQueueReady = undefined;
        throw error;
    });
    return workflowQueueReady;
}

async function getBoss(config: IApiConfig): Promise<PgBoss> {
    if (!boss) {
        boss = (async () => {
            const instance = new PgBoss({
                connectionString: config.databaseUrl,
                max: 2,
            });
            instance.on("error", () => console.error("pg-boss error"));
            try {
                await instance.start();
                await instance.createQueue(RUN_QUEUE);
                return instance;
            } catch (error) {
                await instance.stop().catch(() => undefined);
                boss = undefined;
                throw error;
            }
        })();
    }
    return boss;
}

export async function enqueueRun(
    config: IApiConfig,
    runId: string,
    publication?: { db: IDb; jobId: string },
): Promise<void> {
    try {
        const b = await getBoss(config);
        const jobId = await b.send(
            RUN_QUEUE,
            { runId },
            publication
                ? {
                      id: publication.jobId,
                      db: {
                          executeSql: (text, values) =>
                              publication.db.query(text, values),
                      },
                  }
                : {},
        );
        if (!jobId)
            throw new Error("Eval run queue did not accept publication.");
    } catch (error) {
        console.error("eval run queue publication failed", {
            runId,
            message: "Queue publication failed",
        });
        throw error;
    }
}

export async function enqueueWorkflowRun(
    config: IApiConfig,
    workflowRunId: string,
): Promise<void> {
    const b = await getBoss(config);
    await ensureWorkflowRunQueue(b);
    await b.send(
        WORKFLOW_RUN_QUEUE,
        { workflowRunId },
        { singletonKey: workflowRunId },
    );
}
