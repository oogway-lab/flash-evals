import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
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

import { listAvailableModelMetadata } from "@mosaic/llm-core";
import { availableModelOptions } from "./modelRegistry.js";

describe("availableModelOptions", () => {
    beforeEach(() => vi.mocked(listAvailableModelMetadata).mockClear());

    it("includes OpenRouter-only models without requiring Gateway support", async () => {
        vi.mocked(listAvailableModelMetadata).mockResolvedValueOnce([
            { id: "google/gemini-3.8-flash" },
        ]);
        const result = await availableModelOptions({ openrouter: "test-key" });
        expect(result.models).toContainEqual(
            expect.objectContaining({
                id: "google/gemini-3.8-flash",
                available: true,
                transports: ["openrouter"],
            }),
        );
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
