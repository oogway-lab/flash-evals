import { Pool } from "pg";
import { RUN_QUEUE, WORKFLOW_RUN_QUEUE } from "../server/jobs/queueNames";
import { parseStaleClaimMs } from "../server/jobs/claimLease";
import { safeWorkerError } from "../server/jobs/workerObservability";

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

interface ICostRow {
    workflow: boolean;
    providerOrModel: string;
    costSource: string;
    cells: number;
    estimatedCostUsd: number | null;
    inputTokens: number;
    outputTokens: number;
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
        const costs = await pool.query<ICostRow>(
            `select false as workflow,
                    coalesce(c.provider_metadata->>'provider', m.model_id, 'unknown') as "providerOrModel",
                    coalesce(c.cost_source::text, 'unavailable') as "costSource",
                    count(*)::int as cells,
                    sum(c.cost_usd) as "estimatedCostUsd",
                    coalesce(sum(c.prompt_tokens), 0)::int as "inputTokens",
                    coalesce(sum(c.completion_tokens), 0)::int as "outputTokens"
             from run_cells c
             join run_models m on m.id = c.run_model_id
             where c.created_at >= now() - interval '24 hours'
             group by 2, 3
             union all
             select true as workflow,
                    coalesce(
                        c.output_json #>> '{executionProvenance,actual,upstreamProvider}',
                        c.output_json #>> '{providerMetadata,provider}',
                        c.output_json #>> '{executionProvenance,actual,modelId}',
                        'unknown'
                    ) as "providerOrModel",
                    coalesce(
                        c.output_json #>> '{executionProvenance,currentCost,source}',
                        c.output_json #>> '{providerMetadata,costSource}',
                        'unavailable'
                    ) as "costSource",
                    count(*)::int as cells,
                    sum(c.cost_usd) as "estimatedCostUsd",
                    coalesce(sum(
                        case
                            when coalesce(c.output_json #>> '{usage,promptTokens}', c.output_json #>> '{usage,inputTokens}') ~ '^[0-9]+$'
                            then coalesce(c.output_json #>> '{usage,promptTokens}', c.output_json #>> '{usage,inputTokens}')::bigint
                            else 0
                        end
                    ), 0)::int as "inputTokens",
                    coalesce(sum(
                        case
                            when coalesce(c.output_json #>> '{usage,completionTokens}', c.output_json #>> '{usage,outputTokens}') ~ '^[0-9]+$'
                            then coalesce(c.output_json #>> '{usage,completionTokens}', c.output_json #>> '{usage,outputTokens}')::bigint
                            else 0
                        end
                    ), 0)::int as "outputTokens"
             from workflow_run_cells c
             where c.created_at >= now() - interval '24 hours'
             group by 2, 3
             order by 1, 2, 3`,
        );

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
                costsLast24Hours: costs.rows,
                costBasis:
                    "Persisted provider-reported or catalog-estimated values; missing costs stay unavailable.",
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
