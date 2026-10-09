import type { UsageData } from "./types.js";

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
    // Input token totals include cache reads for OpenAI-compatible providers.
    // Charge the cached portion at its published rate instead of charging it twice.
    const billablePromptTokens = Math.max(
        0,
        usage.promptTokens - cacheReadTokens,
    );
    const base = calculateCost(
        billablePromptTokens,
        usage.completionTokens - reasoningTokens,
        priceForTokenCount(
            billablePromptTokens,
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
