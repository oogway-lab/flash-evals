import type {
    CompletionResult,
    CostBasis,
    CostSource,
    UsageData,
} from "./types.js";

export interface ICostPricingTier {
    minTokens: number;
    maxTokens?: number;
    pricePerToken: number;
}

export interface ICostPricing {
    promptPricePerToken: number;
    completionPricePerToken: number;
    /** Rate for the reasoning portion of output; defaults to the normal output rate. */
    reasoningPricePerToken?: number;
    /** Defaults to the normal input rate when a provider does not publish a cache rate. */
    cacheReadPricePerToken?: number;
    cacheWritePricePerToken?: number;
    promptTiers?: readonly ICostPricingTier[];
    completionTiers?: readonly ICostPricingTier[];
}

export function calculateCost(
    promptTokens: number,
    completionTokens: number,
    promptPricePerToken: number,
    completionPricePerToken: number,
): number {
    return (
        promptTokens * promptPricePerToken +
        completionTokens * completionPricePerToken
    );
}

/**
 * Compute cost from a UsageData + pricing, returning undefined when usage is
 * missing so callers can record a `cost_source: "unavailable"` cell rather than
 * a misleading $0.
 */
export function computeCostFromUsage(
    usage: UsageData,
    promptPricePerToken: number,
    completionPricePerToken: number,
): number | undefined {
    if (
        usage.promptTokens === undefined ||
        usage.completionTokens === undefined
    )
        return undefined;
    return calculateCost(
        usage.promptTokens,
        usage.completionTokens,
        promptPricePerToken,
        completionPricePerToken,
    );
}

export function computeCostFromUsageWithPricing(
    usage: UsageData,
    pricing: ICostPricing,
): number | undefined {
    if (
        usage.promptTokens === undefined ||
        usage.completionTokens === undefined
    )
        return undefined;
    const cacheReadTokens = usage.cacheReadTokens ?? 0;
    const cacheWriteTokens = usage.cacheWriteTokens ?? 0;
    const reasoningTokens = Math.min(
        usage.reasoningTokens ?? 0,
        usage.completionTokens,
    );
    // `promptTokens` is the whole input: it includes cache reads and cache
    // writes (the AI SDK's inputTokens, OpenAI-compatible prompt_tokens).
    // Charge each cached part once, at its own rate.
    const billablePromptTokens = Math.max(
        0,
        usage.promptTokens - cacheReadTokens - cacheWriteTokens,
    );
    const base = calculateCost(
        billablePromptTokens,
        usage.completionTokens - reasoningTokens,
        // Long-context tiers go by the whole prompt, cached tokens included.
        priceForTokenCount(
            usage.promptTokens,
            pricing.promptPricePerToken,
            pricing.promptTiers,
        ),
        priceForTokenCount(
            usage.completionTokens,
            pricing.completionPricePerToken,
            pricing.completionTiers,
        ),
    );
    return (
        base +
        cacheReadTokens *
            (pricing.cacheReadPricePerToken ?? pricing.promptPricePerToken) +
        cacheWriteTokens *
            (pricing.cacheWritePricePerToken ?? pricing.promptPricePerToken) +
        reasoningTokens *
            (pricing.reasoningPricePerToken ?? pricing.completionPricePerToken)
    );
}

function priceForTokenCount(
    tokens: number,
    fallbackPricePerToken: number,
    tiers: readonly ICostPricingTier[] | undefined,
): number {
    if (!tiers || tiers.length === 0) return fallbackPricePerToken;
    return (
        tiers.find(
            (tier) =>
                tokens >= tier.minTokens &&
                (tier.maxTokens === undefined || tokens < tier.maxTokens),
        )?.pricePerToken ?? fallbackPricePerToken
    );
}

export function projectProductionCost(
    perItemCostsUsd: number[],
    volume = 1000,
): number | undefined {
    if (perItemCostsUsd.length === 0) return undefined;
    const mean =
        perItemCostsUsd.reduce((sum, c) => sum + c, 0) / perItemCostsUsd.length;
    return mean * volume;
}

export function formatCost(costUsd: number | null | undefined): string {
    if (costUsd === null || costUsd === undefined) return "–";
    if (costUsd === 0) return "$0.00";
    if (costUsd < 0.01) return `${(costUsd * 100).toFixed(2)}¢`;
    if (costUsd < 1.0) return `$${costUsd.toFixed(4)}`;
    return `$${costUsd.toFixed(2)}`;
}

/**
 * Resolve known charges before estimating from tokens: a cost the provider
 * reported (or Bifrost's list priced), else `pricing` (the registry's list
 * price). The legacy cell enum uses computed for known costs, including
 * provider charges; `costBasis` says which it was.
 */
export function completionCostFields(
    completion: Pick<CompletionResult, "usage" | "cost">,
    pricing: ICostPricing | undefined,
): { costUsd?: number; costSource: CostSource; costBasis?: CostBasis } {
    const known = completion.cost?.usd;
    const usable = (usd: number | undefined): usd is number =>
        usd !== undefined && Number.isFinite(usd) && usd >= 0;
    if (usable(known))
        return {
            costUsd: known,
            costSource: "computed",
            costBasis:
                completion.cost?.source === "bifrost_list_price"
                    ? "bifrost_list_price"
                    : "reported",
        };
    const estimated = pricing
        ? computeCostFromUsageWithPricing(completion.usage, pricing)
        : undefined;
    return usable(estimated)
        ? {
              costUsd: estimated,
              costSource: "computed",
              costBasis: "registry_list_price",
          }
        : { costSource: "unavailable" };
}
