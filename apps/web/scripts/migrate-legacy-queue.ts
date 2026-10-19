import { Pool, type PoolClient } from "pg";
import { PgBoss, type JobInsert } from "pg-boss";
import {
    LEGACY_PG_BOSS_SCHEMA,
    PG_BOSS_SCHEMA,
    RUN_QUEUE,
    WORKFLOW_RUN_QUEUE,
    WORKFLOW_RUN_QUEUE_OPTIONS,
} from "../server/jobs/queueNames";
import { safeWorkerError } from "../server/jobs/workerObservability";

/**
 * One-off cutover from the pg-boss 10 schema to pg-boss 12, which cannot
 * migrate it. Waiting eval/workflow jobs are copied with their original ids
 * (the API's outbox and retry guard look jobs up by id) and the legacy rows
 * are cancelled in the same transaction, so a rollback to the old release
 * cannot run a job twice. Safe to re-run. Model-catalog jobs are not copied:
 * the worker re-creates its schedule and bootstrap job on start.
 *
 * Usage: worker:migrate-legacy-queue [--dry-run] [--allow-active]
 */

const QUEUES = [RUN_QUEUE, WORKFLOW_RUN_QUEUE];
const BATCH_SIZE = 500;

interface ILegacyJob {
    id: string;
    name: string;
    data: object | null;
    priority: number;
    retryLimit: number;
    retryCount: number;
    retryDelay: number;
    retryBackoff: boolean;
    startAfter: Date;
    singletonKey: string | null;
    expireInSeconds: number;
}

function log(event: string, fields: Record<string, unknown> = {}): void {
    console.info(
        JSON.stringify({
            timestamp: new Date().toISOString(),
            service: "flash-evals-queue-migration",
            event,
            ...fields,
        }),
    );
}

/** pg-boss counts attempts from zero, so carry over only the attempts left. */
function toInsert(job: ILegacyJob): JobInsert {
    return {
        id: job.id,
        data: job.data ?? {},
        priority: job.priority,
        retryLimit: Math.max(0, job.retryLimit - job.retryCount),
        retryDelay: job.retryDelay,
        retryBackoff: job.retryBackoff,
        startAfter: job.startAfter,
        expireInSeconds: job.expireInSeconds,
        ...(job.singletonKey ? { singletonKey: job.singletonKey } : {}),
    };
}

async function copyWaitingJobs(
    client: PoolClient,
    boss: PgBoss,
): Promise<Record<string, { inserted: number; deduplicated: number }>> {
    const legacy = await client.query<ILegacyJob>(
        `select id, name, data, priority,
                retry_limit as "retryLimit", retry_count as "retryCount",
                retry_delay as "retryDelay", retry_backoff as "retryBackoff",
                start_after as "startAfter", singleton_key as "singletonKey",
                extract(epoch from expire_in)::int as "expireInSeconds"
         from ${LEGACY_PG_BOSS_SCHEMA}.job
         where name = any($1::text[]) and state in ('created', 'retry')
         order by created_on
         for update skip locked`,
        [QUEUES],
    );
    const db = {
        executeSql: (text: string, values?: unknown[]) =>
            client.query(text, values),
    };
    const copied: Record<string, { inserted: number; deduplicated: number }> =
        {};
    for (const name of QUEUES) {
        const jobs = legacy.rows.filter((job) => job.name === name);
        let inserted = 0;
        for (let i = 0; i < jobs.length; i += BATCH_SIZE) {
            // A job already queued under the same id or stately singletonKey
            // (e.g. republished by the new API) is skipped, not duplicated.
            const ids = await boss.insert(
                name,
                jobs.slice(i, i + BATCH_SIZE).map(toInsert),
                { db, returnId: true },
            );
            inserted += ids?.length ?? 0;
        }
        copied[name] = { inserted, deduplicated: jobs.length - inserted };
    }
    if (legacy.rows.length > 0)
        await client.query(
            `update ${LEGACY_PG_BOSS_SCHEMA}.job
             set state = 'cancelled', completed_on = now(),
                 output = jsonb_build_object('migratedTo', $2::text)
             where id = any($1::uuid[]) and name = any($3::text[])`,
            [legacy.rows.map((job) => job.id), PG_BOSS_SCHEMA, QUEUES],
        );
    return copied;
}

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");
    const dryRun = process.argv.includes("--dry-run");
    const allowActive = process.argv.includes("--allow-active");

    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
        const installed = await pool.query<{ installed: boolean }>(
            "select to_regclass($1) is not null as installed",
            [`${LEGACY_PG_BOSS_SCHEMA}.job`],
        );
        if (!installed.rows[0]?.installed) {
            log("legacy_schema_absent", { schema: LEGACY_PG_BOSS_SCHEMA });
            return;
        }
        const counts = await pool.query<{
            name: string;
            waiting: number;
            active: number;
        }>(
            `select name,
                    count(*) filter (where state in ('created', 'retry'))::int as waiting,
                    count(*) filter (where state = 'active')::int as active
             from ${LEGACY_PG_BOSS_SCHEMA}.job
             where name = any($1::text[])
             group by name`,
            [QUEUES],
        );
        const active = counts.rows.reduce((sum, row) => sum + row.active, 0);
        log("legacy_schema_found", { queues: counts.rows });
        if (dryRun) return;
        // An active legacy job means a pre-v12 worker may still be running.
        // Stop it first; jobs it abandons are recovered from their stale claims.
        if (active > 0 && !allowActive) {
            log("blocked_by_active_legacy_jobs", {
                active,
                action: "Stop the pre-v12 worker, or pass --allow-active if it is gone.",
            });
            process.exitCode = 1;
            return;
        }

        const boss = new PgBoss({
            connectionString: databaseUrl,
            max: 1,
            schema: PG_BOSS_SCHEMA,
            supervise: false,
            schedule: false,
            registerInstance: false,
        });
        boss.on("error", (error) => log("queue_error", safeWorkerError(error)));
        await boss.start();
        const client = await pool.connect();
        try {
            await boss.createQueue(RUN_QUEUE);
            await boss.createQueue(
                WORKFLOW_RUN_QUEUE,
                WORKFLOW_RUN_QUEUE_OPTIONS,
            );
            await client.query("begin");
            const copied = await copyWaitingJobs(client, boss);
            await client.query("commit");
            log("legacy_jobs_copied", { schema: PG_BOSS_SCHEMA, copied });
        } catch (error) {
            await client.query("rollback").catch(() => undefined);
            throw error;
        } finally {
            client.release();
            await boss.stop({ graceful: false });
        }
    } finally {
        await pool.end();
    }
}

void main().catch((error: unknown) => {
    log("failed", safeWorkerError(error));
    process.exitCode = 1;
});
