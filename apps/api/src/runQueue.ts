import PgBoss from "pg-boss";
import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";

export const RUN_QUEUE = "eval-run";
export const WORKFLOW_RUN_QUEUE = "workflow-run";

let boss: Promise<PgBoss> | undefined;

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
    await b.createQueue(WORKFLOW_RUN_QUEUE);
    await b.send(
        WORKFLOW_RUN_QUEUE,
        { workflowRunId },
        { singletonKey: workflowRunId },
    );
}
