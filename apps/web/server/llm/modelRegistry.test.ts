import { REASONING_EFFORT_LEVELS } from "@mosaic/llm-core";
import { describe, expect, it } from "vitest";
import {
    MODEL_REGISTRY,
    gatewayModelIdFor,
    registryEntryFor,
    type IModelRegistryEntry,
} from "./modelRegistry";

const OPENAI_ALLOWLIST = [
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-4o",
    "gpt-4o-mini",
    "gpt-4.1",
    "gpt-4.1-mini",
    "gpt-4.1-nano",
] as const;

describe("modelRegistry", () => {
    it("keeps the existing OpenAI allowlist", () => {
        const ids = MODEL_REGISTRY.map((e) => e.id);
        for (const id of OPENAI_ALLOWLIST) {
            expect(ids).toContain(id);
        }
    });

    it("has unique ids", () => {
        const ids = MODEL_REGISTRY.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
    });

    it("flags the supported GPT and Gemini reasoning models", () => {
        const reasoning = MODEL_REGISTRY.filter((e) => e.reasoning).map(
            (e) => e.id,
        );
        expect(reasoning.sort()).toEqual(
            [
                "google/gemini-3.8-flash",
                "gpt-5.4",
                "gpt-5.4-mini",
                "gpt-5.4-nano",
                "gpt-5.5",
            ].sort(),
        );
    });

    it("defines effort capabilities for gpt-5.5 and gpt-5.4 family models", () => {
        expect(registryEntryFor("gpt-5.5")?.reasoningEffort).toEqual({
            supportedLevels: ["none", "low", "medium", "high", "xhigh"],
            defaultLevel: "medium",
        });
        expect(registryEntryFor("gpt-5.4")?.reasoningEffort).toEqual({
            supportedLevels: ["none", "low", "medium", "high", "xhigh"],
            defaultLevel: "medium",
        });
        expect(registryEntryFor("gpt-5.4-mini")?.reasoningEffort).toEqual({
            supportedLevels: ["none", "low", "medium", "high", "xhigh"],
            defaultLevel: "medium",
        });
    });

    it("gives every reasoning model a non-empty effort list with a valid default", () => {
        const openAiEffortLevels = new Set(REASONING_EFFORT_LEVELS);

        for (const entry of MODEL_REGISTRY.filter((e) => e.reasoning)) {
            expect(entry.reasoningEffort).toBeDefined();
            expect(
                entry.reasoningEffort?.supportedLevels.length,
            ).toBeGreaterThan(0);
            expect(entry.reasoningEffort?.supportedLevels).toContain(
                entry.reasoningEffort?.defaultLevel,
            );
            expect(
                openAiEffortLevels.has(entry.reasoningEffort!.defaultLevel),
            ).toBe(true);
            for (const level of entry.reasoningEffort!.supportedLevels) {
                expect(openAiEffortLevels.has(level)).toBe(true);
            }
        }
    });

    it("omits effort capabilities for non-reasoning models", () => {
        for (const entry of MODEL_REGISTRY.filter((e) => !e.reasoning)) {
            expect(entry.reasoningEffort).toBeUndefined();
        }
        expect(registryEntryFor("gpt-4o")?.reasoningEffort).toBeUndefined();
        expect(
            registryEntryFor("gpt-4.1-mini")?.reasoningEffort,
        ).toBeUndefined();
    });

    it("gives every priced entry positive prompt and completion pricing", () => {
        for (const entry of MODEL_REGISTRY.filter((e) => e.pricing)) {
            expect(entry.pricing!.promptPricePerToken).toBeGreaterThan(0);
            expect(entry.pricing!.completionPricePerToken).toBeGreaterThan(0);
        }
    });

    it("includes curated Gateway-only models with unavailable pricing", () => {
        const claude = registryEntryFor("anthropic/claude-sonnet-4.5");
        expect(claude).toMatchObject({
            provider: "anthropic",
            providerLabel: "Claude",
            supportsOpenAI: false,
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(claude?.pricing).toBeUndefined();
    });

    it("includes additional Gateway families for broader model comparisons", () => {
        expect(registryEntryFor("anthropic/claude-opus-4.8")).toMatchObject({
            providerLabel: "Claude",
            supportsGateway: true,
        });
        expect(registryEntryFor("google/gemini-3-pro-preview")).toMatchObject({
            providerLabel: "Gemini",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(registryEntryFor("google/gemma-4-26b-a4b-it")).toMatchObject({
            provider: "google",
            providerLabel: "Gemma",
            family: "gemma",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(registryEntryFor("google/gemma-4-31b-it")).toMatchObject({
            provider: "google",
            providerLabel: "Gemma",
            family: "gemma",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        for (const modelId of [
            "google/gemma-3n-e4b-it",
            "google/gemma-3-4b-it",
            "google/gemma-3-12b-it",
            "google/gemma-3-27b-it",
            "google/gemma-2-27b-it",
        ]) {
            expect(registryEntryFor(modelId)).toMatchObject({
                provider: "google",
                providerLabel: "Gemma",
                family: "gemma",
                supportsGateway: true,
                structuredOutput: true,
                judgeSuitable: true,
            });
        }
        expect(registryEntryFor("meta/llama-4-maverick")).toMatchObject({
            providerLabel: "Llama",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(registryEntryFor("alibaba/qwen3-max")).toMatchObject({
            providerLabel: "Qwen",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(registryEntryFor("xai/grok-4.3")).toMatchObject({
            providerLabel: "Grok",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
        expect(registryEntryFor("mistral/mistral-large-3")).toMatchObject({
            providerLabel: "Mistral",
            supportsGateway: true,
            structuredOutput: true,
            judgeSuitable: true,
        });
    });

    it("excludes DeepSeek and GLM models from curated Gateway options", () => {
        expect(registryEntryFor("deepseek/deepseek-v3.2")).toBeUndefined();
        expect(registryEntryFor("deepseek/deepseek-r1")).toBeUndefined();
        expect(registryEntryFor("zai/glm-4.7")).toBeUndefined();
        expect(registryEntryFor("zai/glm-5.1")).toBeUndefined();
    });

    it("returns undefined for removed legacy ids", () => {
        expect(registryEntryFor("o3")).toBeUndefined();
        expect(registryEntryFor("gpt-5")).toBeUndefined();
        expect(registryEntryFor("gpt-5-mini")).toBeUndefined();
    });

    it("declares an explicit boolean vision capability on every entry", () => {
        for (const entry of MODEL_REGISTRY) {
            expect(typeof entry.vision).toBe("boolean");
        }
    });

    it("declares Gateway model ids for every entry", () => {
        for (const entry of MODEL_REGISTRY) {
            expect(entry.gatewayModelId).toBe(
                entry.provider === "openai" ? `openai/${entry.id}` : entry.id,
            );
        }
    });

    it("declares provider and structured-output capabilities on every entry", () => {
        for (const entry of MODEL_REGISTRY) {
            expect(typeof entry.provider).toBe("string");
            expect(typeof entry.providerLabel).toBe("string");
            expect(typeof entry.structuredOutput).toBe("boolean");
            expect(typeof entry.judgeSuitable).toBe("boolean");
            expect(typeof entry.supportsOpenAI).toBe("boolean");
            expect(typeof entry.supportsGateway).toBe("boolean");
        }
    });

    it("surfaces vision capability through the prefix lookup", () => {
        expect(registryEntryFor("gpt-4o")?.vision).toBe(true);
        expect(registryEntryFor("gpt-4o-2024-08-06")?.vision).toBe(true);
    });

    describe("registryEntryFor", () => {
        it("matches an exact id", () => {
            expect(registryEntryFor("gpt-4o")?.id).toBe("gpt-4o");
        });

        it("matches an exact Gateway id", () => {
            expect(registryEntryFor("openai/gpt-4o")?.id).toBe("gpt-4o");
            expect(registryEntryFor("anthropic/claude-sonnet-4.5")?.id).toBe(
                "anthropic/claude-sonnet-4.5",
            );
        });

        it("prefers the most specific id over a shorter prefix", () => {
            expect(registryEntryFor("gpt-5.4-mini")?.id).toBe("gpt-5.4-mini");
            expect(registryEntryFor("gpt-4o-mini")?.id).toBe("gpt-4o-mini");
        });

        it("matches dated snapshot variants via the prefix rule", () => {
            expect(registryEntryFor("gpt-4o-2024-08-06")?.id).toBe("gpt-4o");
            expect(registryEntryFor("gpt-5.5-2026-04-23")?.id).toBe("gpt-5.5");
        });

        it("does not prefix-match provider ids", () => {
            expect(
                registryEntryFor("anthropic/claude-sonnet-4.5-extra"),
            ).toBeUndefined();
        });

        it("returns undefined for unknown ids", () => {
            expect(registryEntryFor("nonexistent-model")).toBeUndefined();
        });
    });

    it("exports entries conforming to IModelRegistryEntry", () => {
        const entry: IModelRegistryEntry | undefined = MODEL_REGISTRY[0];
        expect(entry).toBeDefined();
        expect(typeof entry?.label).toBe("string");
        expect(typeof entry?.family).toBe("string");
    });

    describe("gatewayModelIdFor", () => {
        it("returns the mapped Gateway id for a registry id", () => {
            expect(gatewayModelIdFor("gpt-4o")).toBe("openai/gpt-4o");
        });

        it("preserves explicit Gateway ids", () => {
            expect(gatewayModelIdFor("anthropic/claude-sonnet-4.6")).toBe(
                "anthropic/claude-sonnet-4.6",
            );
        });

        it("returns undefined for unknown direct ids", () => {
            expect(gatewayModelIdFor("nonexistent-model")).toBeUndefined();
        });
    });
});
