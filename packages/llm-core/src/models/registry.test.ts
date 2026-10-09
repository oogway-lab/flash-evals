import { describe, expect, it } from "vitest";
import {
    registryEntryFor,
    transportCapabilityForModel,
    transportsForModel,
} from "./registry.js";

describe("transportsForModel", () => {
    it("supports Gemini 3.8 Flash image and structured output on OpenRouter", () => {
        expect(transportsForModel("google/gemini-3.8-flash")).toEqual({
            openrouter: "google/gemini-3.8-flash",
        });
        expect(registryEntryFor("google/gemini-3.8-flash")).toMatchObject({
            vision: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
    });
    it("returns provider-specific ids for a model with multiple transports", () => {
        expect(transportsForModel("gpt-4o")).toEqual({
            openai: "gpt-4o",
            gateway: "openai/gpt-4o",
            openrouter: "openai/gpt-4o",
            bifrost: "openai/gpt-4o",
        });
    });

    it("returns only transports explicitly supported by the model", () => {
        expect(transportsForModel("alibaba/qwen3-max")).toEqual({
            gateway: "alibaba/qwen3-max",
            bifrost: "alibaba/qwen3-max",
        });
    });

    it("registers Gemini 3.1 Flash Lite for Gateway workflows", () => {
        expect(transportsForModel("google/gemini-3.1-flash-lite")).toEqual({
            gateway: "google/gemini-3.1-flash-lite",
            bifrost: "google/gemini-3.1-flash-lite",
        });
    });

    it.each(["zai/glm-5.2", "minimax/minimax-m3"])(
        "registers %s for Gateway workflows",
        (modelId) => {
            expect(transportsForModel(modelId)).toMatchObject({
                gateway: modelId,
            });
            expect(
                transportCapabilityForModel(modelId, "gateway"),
            ).toMatchObject({
                transport: "gateway",
                transportModelId: modelId,
                requiresCurrentDiscovery: true,
            });
        },
    );

    it.each(["openrouter/z-ai/glm-5.2", "openrouter/minimax/minimax-m3"])(
        "registers %s for Bifrost workflows",
        (modelId) => {
            expect(transportsForModel(modelId)).toEqual({ bifrost: modelId });
            expect(
                transportCapabilityForModel(modelId, "bifrost"),
            ).toMatchObject({
                transport: "bifrost",
                transportModelId: modelId,
                requiresCurrentDiscovery: true,
            });
        },
    );

    it("returns undefined for an unknown model", () => {
        expect(transportsForModel("unknown/model")).toBeUndefined();
    });
});

describe("transportCapabilityForModel", () => {
    it("describes OpenRouter routing without treating ordered providers as exact", () => {
        expect(transportCapabilityForModel("gpt-4o", "openrouter")).toEqual({
            transport: "openrouter",
            transportModelId: "openai/gpt-4o",
            upstreamRoutingModes: ["auto", "preference", "exact"],
            supportedGenerationControls: [
                "maxOutputTokens",
                "temperature",
                "topP",
                "seed",
            ],
            supportsStructuredOutput: true,
            requiresCurrentDiscovery: true,
        });
    });

    it("advertises verified Gemma mappings for OpenRouter", () => {
        for (const modelId of [
            "google/gemma-4-26b-a4b-it",
            "google/gemma-4-31b-it",
            "google/gemma-3n-e4b-it",
            "google/gemma-3-4b-it",
            "google/gemma-3-12b-it",
            "google/gemma-3-27b-it",
            "google/gemma-2-27b-it",
        ]) {
            expect(
                transportCapabilityForModel(modelId, "openrouter"),
            ).toMatchObject({
                transport: "openrouter",
                transportModelId: modelId,
                upstreamRoutingModes: ["auto", "preference", "exact"],
                supportsStructuredOutput: true,
                requiresCurrentDiscovery: true,
            });
        }
    });
});
