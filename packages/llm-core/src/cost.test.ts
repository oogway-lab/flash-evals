import { describe, expect, it } from "vitest";
import {
    completionCostFields,
    computeCostFromUsageWithPricing,
} from "./cost.js";

describe("computeCostFromUsageWithPricing", () => {
    it("includes reasoning and cache charges without double-charging cached input", () => {
        expect(
            computeCostFromUsageWithPricing(
                {
                    promptTokens: 100,
                    completionTokens: 20,
                    reasoningTokens: 5,
                    cacheReadTokens: 40,
                    cacheWriteTokens: 10,
                },
                {
                    promptPricePerToken: 0.01,
                    completionPricePerToken: 0.03,
                    reasoningPricePerToken: 0.03,
                    cacheReadPricePerToken: 0.0025,
                    cacheWritePricePerToken: 0.0125,
                },
            ),
        ).toBeCloseTo(1.325);
    });
    it("charges cache writes once: the prompt total already includes them", () => {
        // 1,000 input tokens, of which 800 were written to the cache.
        expect(
            computeCostFromUsageWithPricing(
                {
                    promptTokens: 1_000,
                    completionTokens: 0,
                    cacheWriteTokens: 800,
                },
                {
                    promptPricePerToken: 1,
                    completionPricePerToken: 0,
                    cacheWritePricePerToken: 1.25,
                },
            ),
        ).toBeCloseTo(200 + 800 * 1.25);
    });
    it("picks the long-context tier from the whole prompt, cached tokens included", () => {
        const tiered = {
            promptPricePerToken: 1,
            completionPricePerToken: 0,
            cacheReadPricePerToken: 0.1,
            promptTiers: [
                { minTokens: 0, maxTokens: 200_000, pricePerToken: 1 },
                { minTokens: 200_000, pricePerToken: 2 },
            ],
        };
        expect(
            computeCostFromUsageWithPricing(
                {
                    promptTokens: 250_000,
                    completionTokens: 0,
                    cacheReadTokens: 100_000,
                },
                tiered,
            ),
        ).toBeCloseTo(150_000 * 2 + 100_000 * 0.1);
    });
    it("charges OpenRouter completion totals only once when all output is reasoning", () => {
        expect(
            computeCostFromUsageWithPricing(
                { promptTokens: 5, completionTokens: 28, reasoningTokens: 28 },
                {
                    promptPricePerToken: 0.75 / 1_000_000,
                    completionPricePerToken: 3.75 / 1_000_000,
                },
            ),
        ).toBeCloseTo(0.00010875, 10);
    });
});

describe("completionCostFields", () => {
    const pricing = {
        promptPricePerToken: 0.01,
        completionPricePerToken: 0.03,
    };
    it.each([0, 0.000042])(
        "prefers the actual provider charge %s over catalog estimates",
        (usd) => {
            expect(
                completionCostFields(
                    {
                        usage: { promptTokens: 10, completionTokens: 5 },
                        cost: { usd, source: "provider_reported" },
                    },
                    pricing,
                ),
            ).toEqual({
                costUsd: usd,
                costSource: "computed",
                costBasis: "reported",
            });
        },
    );
    it("keeps a cost priced from Bifrost's list over the registry's list price", () => {
        expect(
            completionCostFields(
                {
                    usage: { promptTokens: 10, completionTokens: 5 },
                    cost: { usd: 0.5, source: "bifrost_list_price" },
                },
                pricing,
            ),
        ).toEqual({
            costUsd: 0.5,
            costSource: "computed",
            costBasis: "bifrost_list_price",
        });
    });
    it("estimates from pricing when the provider has no charge", () => {
        const fields = completionCostFields(
            { usage: { promptTokens: 10, completionTokens: 5 } },
            pricing,
        );
        expect(fields.costUsd).toBeCloseTo(0.25);
        expect(fields.costBasis).toBe("registry_list_price");
    });
    it.each([undefined, -1, NaN, Infinity])(
        "keeps missing or invalid charge %s unavailable without pricing",
        (usd) => {
            expect(
                completionCostFields(
                    {
                        usage: {},
                        ...(usd === undefined
                            ? {}
                            : {
                                  cost: {
                                      usd,
                                      source: "provider_reported" as const,
                                  },
                              }),
                    },
                    undefined,
                ),
            ).toEqual({ costSource: "unavailable" });
        },
    );
});
