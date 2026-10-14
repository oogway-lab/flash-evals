import PgBoss from "pg-boss";
import { refreshModelCatalog } from "@mosaic/llm-core";
import { modelCatalogStore } from "../llm/catalog";
import { logWorkerEvent, safeWorkerError } from "./workerObservability";

export const MODEL_CATALOG_QUEUE = "model-catalog-refresh";
export const MODEL_CATALOG_CRON = "17 2 * * *";
let boss: PgBoss | undefined;
let starting: Promise<void> | undefined;
let stopping = false;
let activeJobs = 0;

/** Public catalogs only: this job never reads team credentials or sends model calls. */
export function startModelCatalogWorker(): Promise<void> {
    if (starting) return starting;
    stopping = false;
    starting = (async () => {
        const instance = new PgBoss({
            connectionString: process.env.DATABASE_URL,
            max: 1,
        });
        boss = instance;
        instance.on("error", (error) =>
            logWorkerEvent(
                "error",
                "catalog.queue_error",
                safeWorkerError(error),
            ),
        );
        await instance.start();
        await instance.createQueue(MODEL_CATALOG_QUEUE);
        if (stopping) return;
        await instance.work(MODEL_CATALOG_QUEUE, async () => {
            activeJobs++;
            try {
                const results = await refreshModelCatalog(modelCatalogStore);
                for (const result of results) {
                    logWorkerEvent(
                        result.ok ? "info" : "warn",
                        result.ok
                            ? "catalog.refreshed"
                            : "catalog.refresh_failed",
                        { queue: MODEL_CATALOG_QUEUE, phase: result.source },
                    );
                }
                if (results.some((result) => !result.ok))
                    throw new Error(
                        "Some model catalog sources failed to refresh",
                    );
            } finally {
                activeJobs--;
            }
        });
        await instance.schedule(
            MODEL_CATALOG_QUEUE,
            MODEL_CATALOG_CRON,
            {},
            { tz: "UTC", retryLimit: 2, retryDelay: 60 },
        );
        // Populate a new install immediately; replicas coalesce this bootstrap job.
        await instance.send(
            MODEL_CATALOG_QUEUE,
            {},
            {
                singletonKey: "bootstrap",
                singletonSeconds: 3600,
                retryLimit: 2,
                retryDelay: 60,
            },
        );
        logWorkerEvent("info", "worker.queue_ready", {
            queue: MODEL_CATALOG_QUEUE,
        });
    })();
    return starting;
}

export async function stopModelCatalogWorker(
    timeoutMs = 20_000,
): Promise<{ remainingInFlight: number }> {
    stopping = true;
    await starting?.catch(() => undefined);
    const instance = boss;
    if (instance) {
        await instance.offWork(MODEL_CATALOG_QUEUE);
        await instance.stop({ graceful: true, timeout: timeoutMs });
    }
    boss = undefined;
    starting = undefined;
    return { remainingInFlight: activeJobs };
}
