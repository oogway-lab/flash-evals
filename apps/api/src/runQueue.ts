import PgBoss from "pg-boss";
import type { IApiConfig } from "./config.js";

export const RUN_QUEUE = "eval-run";
export const WORKFLOW_RUN_QUEUE = "workflow-run";

let boss: PgBoss | undefined;

async function getBoss(config: IApiConfig): Promise<PgBoss> {
    if (!boss) {
        const instance = new PgBoss({
            connectionString: config.databaseUrl,
            max: 2,
        });
        instance.on("error", (err) => console.error("pg-boss error:", err));
        await instance.start();
        await instance.createQueue(RUN_QUEUE);
        boss = instance;
    }
    return boss;
}

export async function enqueueRun(
    config: IApiConfig,
    runId: string,
): Promise<void> {
    try {
        const b = await getBoss(config);
        await b.send(RUN_QUEUE, { runId });
    } catch (error) {
        console.error("eval run queue publication failed", {
            runId,
            errorName: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
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
