import { describe, expect, it } from "vitest";
import { gatewayDataOptions } from "../providers/gateway.js";
import { makerOfModel, thinkingPlanFor } from "../providers/thinking.js";
import {
    registryEntryFor,
    transportCapabilityForModel,
    transportModelIdFor,
    transportsForModel,
} from "./registry.js";

describe("transportsForModel", () => {
    it("supports Gemini 3.8 Flash image and structured output on OpenRouter", () => {
        expect(transportsForModel("google/gemini-3.8-flash")).toEqual({
            openrouter: "google/gemini-3.8-flash",
            gateway: "google/gemini-3.8-flash",
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
            openrouter: "google/gemini-3.1-flash-lite",
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

    it("maps a model's id on one provider to its id on another", () => {
        // OpenRouter spells the maker "z-ai", Vercel "zai".
        expect(transportModelIdFor("z-ai/glm-5.2", "gateway")).toBe(
            "zai/glm-5.2",
        );
        expect(transportModelIdFor("zai/glm-5.2", "openrouter")).toBe(
            "z-ai/glm-5.2",
        );
        expect(
            transportModelIdFor("openrouter/z-ai/glm-5.2", "gateway"),
        ).toBeUndefined();
        expect(
            transportModelIdFor("unknown-vendor/model-x", "gateway"),
        ).toBeUndefined();
    });

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

describe("Muse Ember", () => {
    it("is registered for Vercel AI Gateway with structured output and thinking", () => {
        expect(transportsForModel("meta/muse-ember")).toEqual({
            gateway: "meta/muse-ember",
            bifrost: "meta/muse-ember",
        });
        expect(registryEntryFor("meta/muse-ember")).toMatchObject({
            label: "Muse Ember",
            provider: "meta",
            providerLabel: "Meta",
            structuredOutput: true,
            judgeSuitable: true,
            reasoning: true,
            reasoningEffort: {
                supportedLevels: ["low", "medium", "high"],
                defaultLevel: "medium",
            },
        });
        expect(
            transportCapabilityForModel("meta/muse-ember", "gateway"),
        ).toMatchObject({
            transportModelId: "meta/muse-ember",
            supportsStructuredOutput: true,
            supportedGenerationControls: [
                "maxOutputTokens",
                "reasoningEffort",
                "temperature",
                "topP",
                "seed",
            ],
        });
    });

    it("prices input, output and cached input per token", () => {
        const pricing = registryEntryFor("meta/muse-ember")?.pricing;
        expect(pricing?.promptPricePerToken).toBeCloseTo(0.1 / 1e6, 15);
        expect(pricing?.completionPricePerToken).toBeCloseTo(0.5 / 1e6, 15);
        expect(pricing?.cacheReadPricePerToken).toBeCloseTo(0.004 / 1e6, 15);
    });

    it("treats meta as the maker host for thinking and allowed-host rules", () => {
        expect(makerOfModel("meta/muse-ember")).toBe("meta");
        expect(
            thinkingPlanFor("meta/muse-ember", "gateway", "high")?.outcome,
        ).toMatchObject({ sent: false });
        expect(gatewayDataOptions({ onlyHosts: ["meta"] })).toEqual({
            only: ["meta"],
        });
    });
});
