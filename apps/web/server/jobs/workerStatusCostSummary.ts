import type { Pool } from "pg";

export interface IWorkerCostSummaryRow {
    workflow: boolean;
    providerOrModel: string;
    costSource: string;
    cells: number;
    estimatedCostUsd: number | null;
    inputTokens: number;
    outputTokens: number;
}

/**
 * Spend paid in the last 24 hours, from the spend ledger the team daily cap
 * sums (spend_ledger, migration 0081), so a cell created earlier and retried
 * today counts, and one created today but paid earlier does not. Calls are
 * broken down by provider (or model) and cost source; tokens are each
 * cell's last call's. Spend of runs deleted since shows as "deleted runs".
 */
export async function loadWorkerCostSummary(
    pool: Pool,
): Promise<IWorkerCostSummaryRow[]> {
    const result = await pool.query<IWorkerCostSummaryRow>(
        `with paid as (
             select source_table, source_id, kind, sum(amount_usd) as amount
             from spend_ledger
             where paid_at >= now() - interval '24 hours'
             group by 1, 2, 3
         )
         -- A deleted run's cells are gone but its ledger rows stay (the
         -- daily cap counts them): a left join keeps them, as "deleted runs".
         select false as workflow,
                case when c.id is null then 'deleted runs'
                     else coalesce(c.provider_metadata->>'provider', m.model_id, 'unknown')
                end as "providerOrModel",
                case when c.id is null then 'deleted runs'
                     else coalesce(c.cost_source::text, 'unavailable')
                end as "costSource",
                count(*)::int as cells,
                sum(p.amount) as "estimatedCostUsd",
                coalesce(sum(c.prompt_tokens), 0)::int as "inputTokens",
                coalesce(sum(c.completion_tokens), 0)::int as "outputTokens"
         from paid p
         left join run_cells c on c.id = p.source_id
         left join run_models m on m.id = c.run_model_id
         where p.source_table = 'run_cells' and p.kind = 'call'
         group by 2, 3
         union all
         -- Judge calls that scored eval cells, cache hits included: scoring
         -- a reused answer still pays the judge.
         select false as workflow,
                'judge' as "providerOrModel",
                'judge' as "costSource",
                count(*)::int as cells,
                sum(p.amount) as "estimatedCostUsd",
                0 as "inputTokens",
                0 as "outputTokens"
         from paid p
         where p.source_table = 'run_cells' and p.kind = 'judge'
         having count(*) > 0
         union all
         select true as workflow,
                case when c.id is null then 'deleted runs' else coalesce(
                    c.output_json #>> '{executionProvenance,actual,identity,upstreamProvider}',
                    c.output_json #>> '{executionProvenance,actual,upstreamProvider}',
                    c.output_json #>> '{providerMetadata,provider}',
                    c.output_json #>> '{executionProvenance,actual,modelId}',
                    'unknown'
                ) end as "providerOrModel",
                case when c.id is null then 'deleted runs' else coalesce(
                    c.output_json #>> '{executionProvenance,currentCost,source}',
                    c.output_json #>> '{providerMetadata,costSource}',
                    'unavailable'
                ) end as "costSource",
                count(*)::int as cells,
                sum(p.amount) as "estimatedCostUsd",
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
         from paid p
         left join workflow_run_cells c on c.id = p.source_id
         where p.source_table = 'workflow_run_cells' and p.kind = 'call'
         group by 2, 3
         union all
         -- Judge calls that scored pipeline steps, and those that compared
         -- final answers with an eval run's reference.
         select true as workflow,
                'judge' as "providerOrModel",
                'judge' as "costSource",
                count(*)::int as cells,
                sum(p.amount) as "estimatedCostUsd",
                0 as "inputTokens",
                0 as "outputTokens"
         from paid p
         where p.source_table in ('workflow_run_cells', 'workflow_run_answers')
           and p.kind = 'judge'
         having count(*) > 0
         union all
         -- Pipelines' shared audio transcription, one row per item.
         select true as workflow,
                'transcription' as "providerOrModel",
                'transcription' as "costSource",
                count(*)::int as cells,
                sum(p.amount) as "estimatedCostUsd",
                0 as "inputTokens",
                0 as "outputTokens"
         from paid p
         where p.source_table = 'workflow_run_items'
         having count(*) > 0
         order by 1, 2, 3`,
    );
    return result.rows;
}
