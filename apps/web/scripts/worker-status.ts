import { Pool } from "pg";
import { RUN_QUEUE, WORKFLOW_RUN_QUEUE } from "../server/jobs/queueNames";
import { parseStaleClaimMs } from "../server/jobs/claimLease";
import { safeWorkerError } from "../server/jobs/workerObservability";
import { loadWorkerCostSummary } from "../server/jobs/workerStatusCostSummary";

interface IQueueRow {
    name: string;
    pending: number;
    active: number;
    failed: number;
    oldestPendingAt: Date | null;
}

interface IRunSummaryRow {
    pending: number;
    running: number;
    failed: number;
    stalled: number;
    oldestPendingAt: Date | null;
}

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");

    const pool = new Pool({ connectionString: databaseUrl, max: 2 });
    try {
        const checkedAt = new Date();
        await pool.query("select 1");
        const schema = await pool.query<{ installed: boolean }>(
            "select to_regclass('pgboss.job') is not null as installed",
        );
        if (!schema.rows[0]?.installed)
            throw new Error("pg-boss storage is not installed");

        const queues = await pool.query<IQueueRow>(
            `select name,
                    count(*) filter (where state in ('created', 'retry'))::int as pending,
                    count(*) filter (where state = 'active')::int as active,
                    count(*) filter (where state = 'failed')::int as failed,
                    min(created_on) filter (where state in ('created', 'retry')) as "oldestPendingAt"
             from pgboss.job
             where name = any($1::text[])
             group by name`,
            [[RUN_QUEUE, WORKFLOW_RUN_QUEUE]],
        );
        const runSummary = await pool.query<IRunSummaryRow>(
            `select count(*) filter (where r.status = 'pending')::int as pending,
                    count(*) filter (where r.status = 'running')::int as running,
                    count(*) filter (where r.status in ('failed', 'partial'))::int as failed,
                    count(*) filter (
                        where r.status = 'running'
                          and exists (select 1 from run_cells c where c.run_id = r.id)
                          and not exists (
                              select 1 from run_cells c
                              where c.run_id = r.id and c.claimed_at >= now() - ($1::int * interval '1 millisecond')
                          )
                    )::int as stalled,
                    min(coalesce(o.queued_at, r.created_at)) filter (where r.status = 'pending') as "oldestPendingAt"
             from runs r
             left join run_enqueue_outbox o on o.run_id = r.id`,
            [parseStaleClaimMs(process.env.RUN_STALE_CLAIM_MS)],
        );
        const workflowSummary = await pool.query<IRunSummaryRow>(
            `select count(distinct r.id) filter (where r.status = 'pending')::int as pending,
                    count(distinct r.id) filter (where r.status = 'running')::int as running,
                    count(distinct r.id) filter (where r.status = 'failed')::int as failed,
                    count(distinct r.id) filter (
                        where c.status = 'running'
                          and (c.claimed_at is null or c.claimed_at < now() - ($1::int * interval '1 millisecond'))
                    )::int as stalled,
                    min(coalesce(o.queued_at, r.created_at)) filter (where r.status = 'pending') as "oldestPendingAt"
             from workflow_runs r
             left join workflow_run_enqueue_outbox o on o.workflow_run_id = r.id
             left join workflow_run_cells c on c.workflow_run_id = r.id`,
            [parseStaleClaimMs(process.env.WORKFLOW_STALE_CLAIM_MS)],
        );
        const costs = await loadWorkerCostSummary(pool);

        const queueRows = new Map(queues.rows.map((row) => [row.name, row]));
        const run = runSummary.rows[0];
        const workflow = workflowSummary.rows[0];
        const queueSnapshot = [RUN_QUEUE, WORKFLOW_RUN_QUEUE].map((name) => {
            const row = queueRows.get(name);
            return {
                name,
                pending: row?.pending ?? 0,
                active: row?.active ?? 0,
                failed: row?.failed ?? 0,
                oldestPendingAt: row?.oldestPendingAt?.toISOString() ?? null,
                oldestPendingAgeSeconds: ageSeconds(
                    checkedAt,
                    row?.oldestPendingAt,
                ),
            };
        });
        console.info(
            JSON.stringify({
                timestamp: checkedAt.toISOString(),
                service: "mosaic-worker-status",
                readiness: "queue_backend_ready",
                database: "ok",
                workerProcess: "check through its process supervisor",
                queues: queueSnapshot,
                runs: {
                    eval: summary(run, checkedAt),
                    workflow: summary(workflow, checkedAt),
                },
                usageForCellsCreatedLast24Hours: costs,
                costBasis:
                    "Non-cached persisted usage/cost for cells created in the last 24 hours. Cell creation time is not provider execution time; provider-reported and catalog-estimated values are not billing records.",
            }),
        );
    } finally {
        await pool.end();
    }
}

function summary(row: IRunSummaryRow | undefined, checkedAt: Date) {
    return {
        pending: row?.pending ?? 0,
        running: row?.running ?? 0,
        failed: row?.failed ?? 0,
        stalled: row?.stalled ?? 0,
        oldestPendingAt: row?.oldestPendingAt?.toISOString() ?? null,
        oldestPendingAgeSeconds: ageSeconds(checkedAt, row?.oldestPendingAt),
    };
}

function ageSeconds(now: Date, value: Date | null | undefined): number | null {
    return value
        ? Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1_000))
        : null;
}

void main().catch((error: unknown) => {
    console.error(
        JSON.stringify({
            timestamp: new Date().toISOString(),
            level: "error",
            service: "mosaic-worker-status",
            event: "status.failed",
            ...safeWorkerError(error),
            readiness: "not_ready",
        }),
    );
    process.exitCode = 1;
});
