import { describe, expect, it, vi } from "vitest";
import {
    bifrostApiBaseUrl,
    bifrostRoutesViaOpenRouter,
    bifrostUpstream,
    bifrostModelIdMatches,
    registryEntryForBifrostModel,
    registryModelFor,
} from "./bifrost.js";
import { thinkingPlanFor } from "./thinking.js";

describe("Bifrost", () => {
    it("accepts the base URL with or without /v1", () => {
        for (const url of [
            "https://gateway.example.test",
            "https://gateway.example.test/",
            "https://gateway.example.test/v1",
            "https://gateway.example.test/v1/",
        ])
            expect(bifrostApiBaseUrl(url)).toBe(
                "https://gateway.example.test/v1",
            );
        expect(bifrostApiBaseUrl("https://example.test/bifrost")).toBe(
            "https://example.test/bifrost/v1",
        );
    });

    it("reads the upstream from a Bifrost model id", () => {
        expect(bifrostUpstream("openrouter/google/gemini-2.5-flash")).toBe(
            "openrouter",
        );
        expect(bifrostUpstream("gemini/gemini-2.5-flash")).toBe("gemini");
        expect(bifrostUpstream("gpt-4o")).toBeUndefined();
        expect(bifrostRoutesViaOpenRouter("openrouter/openai/gpt-4o")).toBe(
            true,
        );
        expect(bifrostRoutesViaOpenRouter("openai/gpt-4o")).toBe(false);
    });

    it("finds the registry model behind a Bifrost id for its price", () => {
        const viaOpenRouter = registryEntryForBifrostModel(
            "openrouter/openai/gpt-4o",
        );
        expect(viaOpenRouter?.id).toBe("gpt-4o");
        expect(registryEntryForBifrostModel("openai/gpt-4o")?.id).toBe(
            "gpt-4o",
        );
        expect(
            registryEntryForBifrostModel("openrouter/nobody/unknown-model"),
        ).toBeUndefined();
    });
});

describe("the registry model behind a Bifrost id", () => {
    // Bifrost ids as Bifrost lists them for OpenRouter, with the registry
    // model, its default thinking level and one level it takes.
    const OPENROUTER_IDS: Array<[string, string, string, string]> = [
        [
            "openrouter/anthropic/claude-sonnet-5.5",
            "anthropic/claude-sonnet-5.5",
            "low",
            "medium",
        ],
        ["openrouter/openai/gpt-6-luna", "gpt-6-luna", "medium", "low"],
        [
            "openrouter/deepseek/deepseek-v4.1-flash",
            "deepseek/deepseek-v4.1-flash",
            "low",
            "none",
        ],
        [
            "openrouter/google/gemini-3.5-flash-lite",
            "google/gemini-3.5-flash-lite",
            "low",
            "high",
        ],
        [
            "openrouter/anthropic/claude-haiku-5.5",
            "anthropic/claude-haiku-5.5",
            "low",
            "none",
        ],
        [
            "openrouter/anthropic/claude-sonnet-4.6",
            "anthropic/claude-sonnet-4.6",
            "low",
            "medium",
        ],
        [
            "openrouter/google/gemma-4-31b-it",
            "google/gemma-4-31b-it",
            "none",
            "medium",
        ],
        ["openrouter/z-ai/glm-5.2", "openrouter/z-ai/glm-5.2", "medium", "low"],
        [
            "openrouter/minimax/minimax-m3",
            "openrouter/minimax/minimax-m3",
            "medium",
            "high",
        ],
    ];

    it.each(OPENROUTER_IDS)(
        "%s is %s, with its thinking levels",
        (bifrostId, registryId, defaultLevel, level) => {
            const entry = registryModelFor(bifrostId);
            expect(entry?.id).toBe(registryId);
            expect(entry?.reasoningEffort?.defaultLevel).toBe(defaultLevel);
            expect(entry?.reasoningEffort?.supportedLevels).toContain(level);
            expect(entry?.structuredOutput).toBe(true);
            expect(
                thinkingPlanFor(bifrostId, "bifrost", level as never)?.outcome,
            ).toEqual({
                requested: level,
                sent: true,
                via: `reasoning.effort=${level} (passed to OpenRouter)`,
            });
        },
    );

    it("reads other upstreams, maker aliases, variants and release dates", () => {
        for (const [bifrostId, registryId] of [
            ["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
            [
                "anthropic/claude-sonnet-4-6-20260101",
                "anthropic/claude-sonnet-4.6",
            ],
            [
                "vertex/claude-sonnet-4-6@20260101",
                "anthropic/claude-sonnet-4.6",
            ],
            ["gemini/gemini-3.5-flash-lite", "google/gemini-3.5-flash-lite"],
            ["vertex/gemini-3.5-flash-lite", "google/gemini-3.5-flash-lite"],
            ["OpenRouter/OpenAI/GPT-4o", "gpt-4o"],
            ["openrouter/openai/gpt-4o-mini", "gpt-4o-mini"],
            ["openrouter/meta-llama/llama-4-scout", "meta/llama-4-scout"],
            [
                "openrouter/mistralai/magistral-medium-2506",
                "mistral/magistral-medium",
            ],
            ["openrouter/z-ai/glm-5.2:nitro", "openrouter/z-ai/glm-5.2"],
            ["openrouter/zai/glm-5.2", "openrouter/z-ai/glm-5.2"],
            ["openrouter/qwen/qwen3-max", "alibaba/qwen3-max"],
        ])
            expect(registryModelFor(bifrostId)?.id, bifrostId).toBe(registryId);
    });

    it("leaves unknown ids unknown", () => {
        expect(registryModelFor("openrouter/nobody/unknown-model")).toBe(
            undefined,
        );
        expect(registryModelFor("anthropic/claude-sonnet-4.5-extra")).toBe(
            undefined,
        );
        expect(registryModelFor("openrouter/openai/gpt-4o-max")).toBe(
            undefined,
        );
        expect(registryModelFor("nonexistent-model")).toBeUndefined();
    });

    it("matches listed ids with dots or dashes between version digits", () => {
        expect(
            bifrostModelIdMatches(
                "anthropic/claude-sonnet-4-6",
                "anthropic/claude-sonnet-4.6",
            ),
        ).toBe(true);
        expect(
            bifrostModelIdMatches(
                "openrouter/openai/gpt-4.1-mini",
                "openai/gpt-4.1",
            ),
        ).toBe(false);
    });
});

describe("Bifrost model ids for every call", () => {
    it("sends a registry id as its Bifrost id and a Bifrost id as it is", async () => {
        const { bifrostModelIdFor } = await import("./bifrost.js");
        expect(bifrostModelIdFor("gpt-4o")).toBe("openai/gpt-4o");
        expect(bifrostModelIdFor("openrouter/google/gemini-2.5-flash")).toBe(
            "openrouter/google/gemini-2.5-flash",
        );
    });

    it("maps a judge or optimizer call when Bifrost is the default provider", async () => {
        const { getEvalProvider } = await import("./factory.js");
        const complete = vi.fn().mockResolvedValue({
            text: "{}",
            usage: {},
            latencyMs: 1,
        });
        const provider = getEvalProvider(
            { bifrost: "key", bifrostBaseUrl: "https://gateway.example.test" },
            {
                provider: "bifrost",
                createOpenAICompatibleProvider: () => ({ complete }),
            },
        );
        await provider.complete({ model: "gpt-4o", prompt: "x", maxTokens: 5 });
        await provider.complete({
            model: "openrouter/openai/gpt-4o",
            prompt: "x",
            maxTokens: 5,
        });
        expect(complete.mock.calls.map(([req]) => req.model)).toEqual([
            "openai/gpt-4o",
            "openrouter/openai/gpt-4o",
        ]);
    });
});
