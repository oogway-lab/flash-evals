import { eq, sql } from "drizzle-orm";
import type { ApiKeys, EvalProviderTransport } from "@flash-evals/llm-core";
import type { db } from "../db/client";
import { runCells } from "../db/schema";
import { resolvePricingFor, type ModelPricing } from "../llm/pricing";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The judge costs that are known, added up; undefined when none is. */
export function totalJudgeCostUsd(
    ...costs: Array<number | undefined>
): number | undefined {
    const known = costs.filter(
        (cost): cost is number => cost !== undefined && Number.isFinite(cost),
    );
    return known.length > 0
        ? known.reduce((total, cost) => total + cost, 0)
        : undefined;
}

/**
 * Adds one scoring pass's judge cost to the cell. Every pass pays for its
 * judge calls, so the cost accumulates; the scores themselves are replaced,
 * so nothing reads judge cost from them for totals.
 */
export async function recordJudgeCost(
    tx: Pick<Transaction, "update">,
    cellId: string,
    costUsd: number | undefined,
): Promise<void> {
    if (costUsd === undefined || costUsd <= 0) return;
    await tx
        .update(runCells)
        .set({
            judgeCostUsd: sql`coalesce(${runCells.judgeCostUsd}, 0) + ${costUsd}`,
        })
        .where(eq(runCells.id, cellId));
}

/** Prices for a judge model, or undefined when none are known. */
export function judgePricing(
    apiKeys: ApiKeys,
): (
    modelId: string,
    transport?: EvalProviderTransport,
) => Promise<ModelPricing | undefined> {
    return (modelId, transport) =>
        resolvePricingFor(modelId, apiKeys, transport).catch(() => undefined);
}
