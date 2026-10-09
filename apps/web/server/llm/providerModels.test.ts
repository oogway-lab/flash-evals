import { describe, expect, it, vi } from "vitest";
import {
    listAvailableModelMetadata,
    listAvailableModels,
} from "@mosaic/llm-core";

describe("listAvailableModels", () => {
    it("requires an OpenAI key for direct OpenAI model discovery", async () => {
        await expect(
            listAvailableModels({}, { provider: "openai" }),
        ).rejects.toThrow(/OpenAI API key/);
    });

    it("requires an AI Gateway key for Gateway model discovery", async () => {
        await expect(
            listAvailableModels({}, { provider: "gateway" }),
        ).rejects.toThrow(/AI Gateway API key/);
    });

    it("lists language models from the Gateway metadata provider", async () => {
        const createGatewayProvider = vi.fn(() => ({
            getAvailableModels: vi.fn(async () => ({
                models: [
                    {
                        id: "openai/gpt-4o",
                        name: "GPT-4o",
                        modelType: "language" as const,
                        pricing: {
                            input: "0.0000025",
                            output: "0.00001",
                        },
                        specification: {
                            specificationVersion: "v4" as const,
                            provider: "gateway",
                            modelId: "openai/gpt-4o",
                        },
                    },
                    {
                        id: "openai/text-embedding-3-small",
                        name: "Embedding",
                        modelType: "embedding" as const,
                        specification: {
                            specificationVersion: "v4" as const,
                            provider: "gateway",
                            modelId: "openai/text-embedding-3-small",
                        },
                    },
                ],
            })),
        }));

        const models = await listAvailableModels(
            { gateway: "vck-test" },
            { provider: "gateway", createGatewayProvider },
        );

        expect(models).toEqual(["openai/gpt-4o"]);
        expect(createGatewayProvider).toHaveBeenCalledWith("vck-test");
    });

    it("normalizes Gateway pricing metadata for language models", async () => {
        const createGatewayProvider = vi.fn(() => ({
            getAvailableModels: vi.fn(async () => ({
                models: [
                    {
                        id: "anthropic/claude-sonnet-4.5",
                        name: "Claude Sonnet 4.5",
                        type: "language" as const,
                        pricing: {
                            input: "0.000003",
                            input_tiers: [
                                { cost: "0.000003", min: 0, max: 200001 },
                                { cost: "0.000006", min: 200001 },
                            ],
                            output: "0.000015",
                            output_tiers: [
                                { cost: "0.000015", min: 0, max: 200001 },
                                { cost: "0.0000225", min: 200001 },
                            ],
                            web_search: "10",
                        },
                        specification: {
                            specificationVersion: "v4" as const,
                            provider: "gateway",
                            modelId: "anthropic/claude-sonnet-4.5",
                        },
                    },
                ],
            })),
        }));

        const models = await listAvailableModelMetadata(
            { gateway: "vck-test" },
            { provider: "gateway", createGatewayProvider },
        );

        expect(models).toEqual([
            {
                id: "anthropic/claude-sonnet-4.5",
                pricing: {
                    promptPricePerToken: 0.000003,
                    completionPricePerToken: 0.000015,
                    promptTiers: [
                        {
                            minTokens: 0,
                            maxTokens: 200001,
                            pricePerToken: 0.000003,
                        },
                        {
                            minTokens: 200001,
                            pricePerToken: 0.000006,
                        },
                    ],
                    completionTiers: [
                        {
                            minTokens: 0,
                            maxTokens: 200001,
                            pricePerToken: 0.000015,
                        },
                        {
                            minTokens: 200001,
                            pricePerToken: 0.0000225,
                        },
                    ],
                },
            },
        ]);
    });

    it("omits pricing when Gateway metadata lacks input or output prices", async () => {
        const createGatewayProvider = vi.fn(() => ({
            getAvailableModels: vi.fn(async () => ({
                models: [
                    {
                        id: "provider/model",
                        name: "Incomplete",
                        type: "language" as const,
                        pricing: { input: "0.000001", output: "" },
                        specification: {
                            specificationVersion: "v4" as const,
                            provider: "gateway",
                            modelId: "provider/model",
                        },
                    },
                ],
            })),
        }));

        const models = await listAvailableModelMetadata(
            { gateway: "vck-test" },
            { provider: "gateway", createGatewayProvider },
        );

        expect(models).toEqual([{ id: "provider/model" }]);
    });
});
