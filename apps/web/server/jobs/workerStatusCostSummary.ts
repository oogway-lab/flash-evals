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

export async function loadWorkerCostSummary(
    pool: Pool,
): Promise<IWorkerCostSummaryRow[]> {
    const result = await pool.query<IWorkerCostSummaryRow>(
        `select false as workflow,
                coalesce(c.provider_metadata->>'provider', m.model_id, 'unknown') as "providerOrModel",
                coalesce(c.cost_source::text, 'unavailable') as "costSource",
                count(*)::int as cells,
                sum(c.cost_usd) as "estimatedCostUsd",
                coalesce(sum(c.prompt_tokens), 0)::int as "inputTokens",
                coalesce(sum(c.completion_tokens), 0)::int as "outputTokens"
         from run_cells c
         join run_models m on m.id = c.run_model_id
         where c.status <> 'cached'
           and c.created_at >= now() - interval '24 hours'
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
         where c.status <> 'cached'
           and c.created_at >= now() - interval '24 hours'
         group by 2, 3
         order by 1, 2, 3`,
    );
    return result.rows;
}
