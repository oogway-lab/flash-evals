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
        ).toBeCloseTo(1.425);
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
            ).toEqual({ costUsd: usd, costSource: "computed" });
        },
    );
    it("estimates from pricing when the provider has no charge", () => {
        expect(
            completionCostFields(
                { usage: { promptTokens: 10, completionTokens: 5 } },
                pricing,
            ).costUsd,
        ).toBeCloseTo(0.25);
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
