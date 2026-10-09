import { describe, expect, it } from "vitest";
import { computeCostFromUsageWithPricing } from "./cost.js";

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
