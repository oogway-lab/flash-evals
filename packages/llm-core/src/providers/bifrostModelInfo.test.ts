import { beforeEach, describe, expect, it, vi } from "vitest";
import {
    registryEntryFor,
    transportCapabilityForModel,
} from "../models/registry.js";
import {
    bifrostListedThinkingLevels,
    bifrostListPricing,
    bifrostModelInfo,
    bifrostModelListKey,
    bifrostModelListKeyFor,
    bifrostOutputLimitWarning,
    bifrostModelInfoFromListing,
    loadBifrostModelInfo,
    resetBifrostModelInfo,
} from "./bifrostModelInfo.js";

beforeEach(() => resetBifrostModelInfo());

describe("bifrostModelInfoFromListing", () => {
    it("reads OpenRouter's supported parameters and output maximum", () => {
        expect(
            bifrostModelInfoFromListing({
                id: "openrouter/acme/model-1",
                supported_parameters: [
                    "reasoning",
                    "include_reasoning",
                    "response_format",
                ],
                max_output_tokens: 65_536,
            }),
        ).toEqual({
            id: "openrouter/acme/model-1",
            reasoning: true,
            reasoningEffort: false,
            structuredOutput: true,
            maxOutputTokens: 65_536,
        });
    });

    it("leaves unknown what the list doesn't say", () => {
        expect(bifrostModelInfoFromListing({ id: "acme/model-2" })).toEqual({
            id: "acme/model-2",
        });
        expect(bifrostModelInfoFromListing({ name: "no id" })).toBeUndefined();
        expect(
            bifrostModelInfoFromListing({
                id: "acme/model-3",
                max_output_tokens: -1,
            }),
        ).toEqual({ id: "acme/model-3" });
    });
});

describe("Bifrost list prices", () => {
    it("reads OpenRouter's per-token prices for each id", async () => {
        await loadBifrostModelInfo("key", async () => [
            {
                id: "openrouter/acme/glm-like",
                pricing: {
                    prompt: "0.0000006",
                    completion: "0.0000022",
                    input_cache_read: "0.00000011",
                    internal_reasoning: "0",
                    request: "0",
                },
            },
            {
                id: "openrouter/acme/free",
                pricing: { prompt: "0", completion: "0" },
            },
            {
                id: "openrouter/auto",
                pricing: { prompt: "-1", completion: "-1" },
            },
            { id: "openrouter/acme/unpriced", pricing: { prompt: "abc" } },
            { id: "gemini/acme-1" },
        ]);

        expect(bifrostListPricing("key", "openrouter/acme/glm-like")).toEqual({
            promptPricePerToken: 0.0000006,
            completionPricePerToken: 0.0000022,
            cacheReadPricePerToken: 0.00000011,
        });
        expect(bifrostListPricing("key", "openrouter/acme/free")).toEqual({
            promptPricePerToken: 0,
            completionPricePerToken: 0,
        });
        expect(bifrostListPricing("key", "openrouter/auto")).toBeUndefined();
        expect(
            bifrostListPricing("key", "openrouter/acme/unpriced"),
        ).toBeUndefined();
        expect(bifrostListPricing("key", "gemini/acme-1")).toBeUndefined();
        expect(bifrostListPricing("key", "never/listed")).toBeUndefined();
    });

    it("keeps a separate thinking price when the list gives one", () => {
        expect(
            bifrostModelInfoFromListing({
                id: "openrouter/acme/thinker",
                pricing: {
                    prompt: 0.000001,
                    completion: "0.000004",
                    internal_reasoning: "0.000003",
                    input_cache_write: "0.0000012",
                },
            })?.pricing,
        ).toEqual({
            promptPricePerToken: 0.000001,
            completionPricePerToken: 0.000004,
            reasoningPricePerToken: 0.000003,
            cacheWritePricePerToken: 0.0000012,
        });
    });
});

describe("bifrostListedThinkingLevels", () => {
    it("uses the registry's levels when the list says the model thinks", async () => {
        await loadBifrostModelInfo("key", async () => [
            {
                id: "openrouter/minimax/minimax-m3",
                supported_parameters: ["reasoning"],
            },
        ]);
        expect(
            bifrostListedThinkingLevels(
                "key",
                "openrouter/minimax/minimax-m3",
                ["low", "medium", "high"],
            ),
        ).toEqual(["low", "medium", "high"]);
        expect(
            bifrostListedThinkingLevels(
                "key",
                "openrouter/acme/unlisted",
                undefined,
            ),
        ).toBeUndefined();
    });
});

describe("one Bifrost's list applies only to that Bifrost", () => {
    it("keeps each address and key's prices and thinking apart", async () => {
        const teamA = bifrostModelListKey("https://a.example/v1", "key-a");
        const teamB = bifrostModelListKey("https://b.example/v1", "key-b");
        expect(teamA).not.toBe(teamB);
        expect(
            bifrostModelListKeyFor({
                bifrost: "key-a",
                bifrostBaseUrl: "https://a.example",
            }),
        ).toBe(teamA);
        await loadBifrostModelInfo(teamA, async () => [
            {
                id: "openrouter/acme/model-1",
                supported_parameters: [],
                max_output_tokens: 10,
                pricing: { prompt: "1", completion: "1" },
            },
        ]);
        expect(bifrostListPricing(teamA, "openrouter/acme/model-1")).toEqual({
            promptPricePerToken: 1,
            completionPricePerToken: 1,
        });
        expect(
            bifrostListPricing(teamB, "openrouter/acme/model-1"),
        ).toBeUndefined();
        expect(
            bifrostListedThinkingLevels(teamB, "openrouter/acme/model-1", [
                "low",
            ]),
        ).toBeUndefined();
        expect(
            bifrostOutputLimitWarning(teamB, "openrouter/acme/model-1", 100),
        ).toBeUndefined();
        expect(
            bifrostModelInfo(undefined, "openrouter/acme/model-1"),
        ).toBeUndefined();
    });
});

describe("loadBifrostModelInfo", () => {
    it("fetches once per ten minutes and survives a failed fetch", async () => {
        let now = 0;
        const list = vi
            .fn<() => Promise<unknown[]>>()
            .mockRejectedValueOnce(new Error("down"))
            .mockResolvedValue([{ id: "openrouter/acme/model-1" }]);
        await loadBifrostModelInfo("key", list, () => now);
        expect(
            bifrostModelInfo("key", "openrouter/acme/model-1"),
        ).toBeUndefined();
        await loadBifrostModelInfo("key", list, () => now);
        expect(list).toHaveBeenCalledTimes(1);
        now = 61_000;
        await loadBifrostModelInfo("key", list, () => now);
        expect(bifrostModelInfo("key", "openrouter/acme/model-1")).toEqual({
            id: "openrouter/acme/model-1",
        });
        now += 5 * 60 * 1000;
        await loadBifrostModelInfo("key", list, () => now);
        expect(list).toHaveBeenCalledTimes(2);
    });
});

describe("registry thinking for open-weight models", () => {
    it.each([
        ["google/gemini-3-flash", ["minimal", "low", "medium", "high"]],
        ["google/gemma-4-31b-it", ["none", "low", "medium", "high"]],
        ["zai/glm-5.2", ["none", "low", "medium", "high"]],
        ["openrouter/z-ai/glm-5.2", ["none", "low", "medium", "high"]],
        ["minimax/minimax-m3", ["low", "medium", "high"]],
        ["openrouter/minimax/minimax-m3", ["low", "medium", "high"]],
    ])("lists %s as thinking at %j", (id, levels) => {
        const entry = registryEntryFor(id);
        expect(entry?.reasoning).toBe(true);
        expect(entry?.reasoningEffort?.supportedLevels).toEqual(levels);
    });

    it("takes structured output for GLM 5.2 and MiniMax M3 via OpenRouter", () => {
        expect(
            registryEntryFor("openrouter/z-ai/glm-5.2")?.structuredOutput,
        ).toBe(true);
        expect(
            registryEntryFor("openrouter/minimax/minimax-m3")?.structuredOutput,
        ).toBe(true);
    });

    it("keeps temperature for thinking models that take it", () => {
        expect(
            transportCapabilityForModel("google/gemma-4-31b-it", "gateway")
                ?.supportedGenerationControls,
        ).toEqual(expect.arrayContaining(["reasoningEffort", "temperature"]));
        expect(
            transportCapabilityForModel("gpt-6-luna", "openai")
                ?.supportedGenerationControls,
        ).not.toContain("temperature");
    });
});
