import { PgBoss } from "pg-boss";
import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";

export const RUN_QUEUE = "eval-run";
export const WORKFLOW_RUN_QUEUE = "workflow-run";
/** Must match the worker's MODEL_CATALOG_QUEUE. */
export const MODEL_CATALOG_QUEUE = "model-catalog-refresh";
/** pg-boss 11+ cannot migrate the v10 schema; must match the worker's PG_BOSS_SCHEMA. */
export const PG_BOSS_SCHEMA = "pgboss_v12";
/** pg-boss's longest allowed expiry; must match the worker's RUN_JOB_EXPIRE_SECONDS. */
const RUN_JOB_EXPIRE_SECONDS = 24 * 60 * 60;
/**
 * Eval-run jobs: a 24-hour expiry so a long run is not expired and retried
 * while it is still running, and no pg-boss retries (the worker recovers
 * interrupted runs itself). Must match the worker's RUN_JOB_OPTIONS.
 */
export const RUN_JOB_OPTIONS = {
    expireInSeconds: RUN_JOB_EXPIRE_SECONDS,
    retryLimit: 0,
} as const;
/** Must match the worker's WORKFLOW_RUN_JOB_OPTIONS. */
export const WORKFLOW_RUN_JOB_OPTIONS = {
    expireInSeconds: RUN_JOB_EXPIRE_SECONDS,
    retryLimit: 3,
    retryBackoff: true,
} as const;
const WORKFLOW_RUN_QUEUE_OPTIONS = {
    name: WORKFLOW_RUN_QUEUE,
    policy: "stately",
    ...WORKFLOW_RUN_JOB_OPTIONS,
} as const;

let boss: Promise<PgBoss> | undefined;
let workflowQueueReady: Promise<void> | undefined;

/**
 * pg-boss enforces `singletonKey` only on non-standard queues. "stately"
 * allows one created and one active job per key, so a run cannot be queued
 * twice while still letting a retry queue behind a finishing job. Every send
 * to this queue must carry a singletonKey. The worker applies the same policy.
 * The policy is fixed at creation: pg-boss 11+ rejects policy updates.
 */
function ensureWorkflowRunQueue(b: PgBoss): Promise<void> {
    workflowQueueReady ??= (async () => {
        await b.createQueue(WORKFLOW_RUN_QUEUE, WORKFLOW_RUN_QUEUE_OPTIONS);
        await b.updateQueue(WORKFLOW_RUN_QUEUE, WORKFLOW_RUN_JOB_OPTIONS);
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
                schema: PG_BOSS_SCHEMA,
            });
            instance.on("error", () => console.error("pg-boss error"));
            instance.on("warning", (warning) =>
                console.warn("pg-boss warning", {
                    type: warningType(warning),
                }),
            );
            try {
                await instance.start();
                await instance.createQueue(RUN_QUEUE, RUN_JOB_OPTIONS);
                // createQueue keeps an existing queue's settings.
                await instance.updateQueue(RUN_QUEUE, RUN_JOB_OPTIONS);
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
                      ...RUN_JOB_OPTIONS,
                      id: publication.jobId,
                      db: {
                          executeSql: (text, values) =>
                              publication.db.query(text, values),
                      },
                  }
                : RUN_JOB_OPTIONS,
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
        { ...WORKFLOW_RUN_JOB_OPTIONS, singletonKey: workflowRunId },
    );
}

/**
 * Ask the worker to fetch the public Vercel and OpenRouter price lists now
 * instead of waiting for the daily refresh. No keys or model calls involved.
 */
export async function enqueueModelCatalogRefresh(
    config: IApiConfig,
): Promise<void> {
    const b = await getBoss(config);
    await b.createQueue(MODEL_CATALOG_QUEUE);
    const jobId = await b.send(MODEL_CATALOG_QUEUE, {});
    if (!jobId) throw new Error("Price list refresh was not queued.");
}

/** The warning's type only; its message can quote SQL or database errors. */
function warningType(warning: unknown): string {
    const data =
        typeof warning === "object" && warning !== null && "data" in warning
            ? (warning as { data?: { type?: unknown } }).data
            : undefined;
    return typeof data?.type === "string" ? data.type : "unknown";
}
