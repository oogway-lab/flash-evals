import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@flash-evals/llm-core";

vi.mock("@flash-evals/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        listAvailableModelMetadata: vi.fn(async (_keys, options) => {
            if (options?.provider === "gateway") {
                return [{ id: "anthropic/claude-sonnet-4.5" }];
            }
            if (options?.provider === "openrouter") {
                return [
                    { id: "openai/gpt-4o" },
                    { id: "anthropic/claude-sonnet-4.5" },
                ];
            }
            return [{ id: "gpt-4o" }];
        }),
    };
});

import { listAvailableModelMetadata } from "@flash-evals/llm-core";
import { availableModelOptions } from "./modelRegistry.js";

describe("availableModelOptions", () => {
    beforeEach(() => vi.mocked(listAvailableModelMetadata).mockClear());

    it.each(["google/gemini-3.8-flash", "google/gemini-3.5-flash-lite"])(
        "includes catalog model %s through authenticated provider discovery",
        async (id) => {
            vi.mocked(listAvailableModelMetadata).mockResolvedValueOnce([
                { id },
            ]);
            const result = await availableModelOptions({
                openrouter: "test-key",
            });
            expect(result.models).toContainEqual(
                expect.objectContaining({
                    id,
                    available: true,
                    transports: ["openrouter"],
                }),
            );
        },
    );

    it("makes direct maker models available with only the maker's key", async () => {
        vi.mocked(listAvailableModelMetadata).mockImplementation(
            async (_keys, options) =>
                options?.provider === "anthropic"
                    ? [{ id: "claude-haiku-5-5" }]
                    : [],
        );
        try {
            const result = await availableModelOptions({
                anthropic: "test-anthropic",
            });
            expect(
                result.models.find(
                    (model) => model.id === "anthropic/claude-haiku-5.5",
                ),
            ).toMatchObject({ available: true, transports: ["anthropic"] });
            expect(listAvailableModelMetadata).toHaveBeenCalledWith(
                { anthropic: "test-anthropic" },
                { provider: "anthropic" },
            );
        } finally {
            vi.mocked(listAvailableModelMetadata).mockReset();
        }
    });

    it("lists models a provider without a key carries, with the missing key named", async () => {
        const result = await availableModelOptions({
            gateway: "stored-gateway",
        });
        const openRouterOnly = result.models.find(
            (model) =>
                model.providers?.length === 1 &&
                model.providers[0]?.transport === "openrouter",
        );
        expect(openRouterOnly).toMatchObject({
            available: false,
            transports: [],
            disabledReason: "No key for OpenRouter.",
        });
        const both = result.models.find(
            (model) => model.id === "anthropic/claude-sonnet-4.5",
        );
        expect(both?.providers?.map((offer) => offer.transport)).toEqual([
            "gateway",
            "openrouter",
        ]);
        expect(both?.providers?.map((offer) => offer.keySaved)).toEqual([
            true,
            false,
        ]);
    });

    it("starts from the preferred provider when it has a key", async () => {
        const keys = { gateway: "stored-gateway", openrouter: "stored-or" };
        const plain = await availableModelOptions(keys);
        const preferred = await availableModelOptions(keys, {
            preferredProvider: "openrouter",
        });
        const sonnet = (models: typeof plain.models) =>
            models.find((model) => model.id === "anthropic/claude-sonnet-4.5")
                ?.transports;
        expect(sonnet(plain.models)).toEqual(["gateway", "openrouter"]);
        expect(sonnet(preferred.models)).toEqual(["openrouter", "gateway"]);
    });

    it("unions models and transports enabled by effective provider keys", async () => {
        const result = await availableModelOptions({
            openai: "env-openai",
            gateway: "stored-gateway",
            openrouter: "stored-openrouter",
        });

        expect(result.models).toContainEqual(
            expect.objectContaining({
                id: "gpt-4o",
                transports: ["openai", "gateway", "openrouter"],
            }),
        );
        expect(result.models).toContainEqual(
            expect.objectContaining({
                id: "anthropic/claude-sonnet-4.5",
                transports: ["gateway", "openrouter"],
            }),
        );
        expect(vi.mocked(listAvailableModelMetadata)).toHaveBeenCalledTimes(3);
    });

    it("keeps other enabled transports when one live listing fails", async () => {
        vi.mocked(listAvailableModelMetadata).mockImplementation(
            async (_keys, options) => {
                if (options?.provider === "gateway")
                    throw new Error("gateway unavailable");
                return [{ id: "gpt-4o" }];
            },
        );

        const result = await availableModelOptions({
            openai: "openai",
            gateway: "gateway",
        });

        expect(result.degraded).toBe(true);
        expect(result.models).toContainEqual(
            expect.objectContaining({ id: "gpt-4o", available: true }),
        );
        expect(result.models).toContainEqual(
            expect.objectContaining({ id: "anthropic/claude-sonnet-4.5" }),
        );
    });

    it("skips a transport whose pre-listing check fails and keeps the others", async () => {
        vi.mocked(listAvailableModelMetadata).mockImplementation(async () => [
            { id: "gpt-4o" },
        ]);
        const beforeListing = vi.fn(async (transport: string) => {
            if (transport === "bifrost") throw new Error("host lookup failed");
        });

        const result = await availableModelOptions(
            {
                openai: "openai",
                bifrost: "bifrost",
                bifrostBaseUrl: "https://bifrost.example/v1",
            },
            { beforeListing },
        );

        expect(beforeListing).toHaveBeenCalledWith("openai");
        expect(beforeListing).toHaveBeenCalledWith("bifrost");
        expect(vi.mocked(listAvailableModelMetadata)).toHaveBeenCalledTimes(1);
        expect(vi.mocked(listAvailableModelMetadata)).toHaveBeenCalledWith(
            expect.anything(),
            { provider: "openai" },
        );
        expect(result.degraded).toBe(true);
        expect(result.models).toContainEqual(
            expect.objectContaining({ id: "gpt-4o", available: true }),
        );
    });

    it("includes a newly discovered provider model without a catalog code edit", async () => {
        vi.mocked(listAvailableModelMetadata).mockImplementation(
            async (_keys, options) =>
                options?.provider === "gateway"
                    ? [
                          {
                              id: "new-provider/new-model",
                              pricing: {
                                  promptPricePerToken: 1 / 1_000_000,
                                  completionPricePerToken: 2 / 1_000_000,
                              },
                          },
                      ]
                    : [],
        );

        const result = await availableModelOptions({ gateway: "gateway" });

        expect(result.models).toContainEqual(
            expect.objectContaining({
                id: "new-provider/new-model",
                transports: ["gateway"],
                costAvailable: true,
                providerListed: true,
            }),
        );
    });
});
