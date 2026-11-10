import { describe, expect, it, vi } from "vitest";
import type { LanguageModel, LanguageModelUsage } from "ai";
import {
    DIRECT_MAKER_HOSTS,
    directMakerModelIds,
    registryEntryFor,
    transportCapabilityForModel,
    transportsForModel,
} from "../models/registry.js";
import type { IEvalCompletionProvider } from "../types.js";
import { getEvalProvider } from "./factory.js";
import { listAvailableModelMetadata } from "./models.js";
import { VercelAIEvalProvider } from "./vercelAi.js";

function usage(cacheReadTokens?: number): LanguageModelUsage {
    return {
        inputTokens: 120,
        inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens,
            cacheWriteTokens: undefined,
        },
        outputTokens: 30,
        outputTokenDetails: { textTokens: undefined, reasoningTokens: 10 },
        totalTokens: 150,
    };
}

function modelFor(model: string): LanguageModel {
    return { provider: "test", modelId: model } as LanguageModel;
}

function fakeGenerate(cacheReadTokens?: number) {
    return vi.fn(async () => ({
        text: "ok",
        output: "ok",
        usage: usage(cacheReadTokens),
        response: { id: "msg_test_1", modelId: "claude-sonnet-5-5" },
    }));
}

function provider(): IEvalCompletionProvider {
    return {
        complete: vi.fn(async () => ({ text: "", usage: {}, latencyMs: 1 })),
    };
}

describe("direct maker registry entries", () => {
    it("adds the maker's own model id next to the gateway ids", () => {
        expect(transportsForModel("anthropic/claude-sonnet-5.5")).toMatchObject(
            {
                gateway: "anthropic/claude-sonnet-5.5",
                anthropic: "claude-sonnet-5-5",
            },
        );
        expect(transportsForModel("anthropic/claude-opus-5.5")?.anthropic).toBe(
            "claude-opus-5-5",
        );
        expect(
            transportsForModel("anthropic/claude-haiku-5.5")?.anthropic,
        ).toBe("claude-haiku-5-5");
        expect(
            transportsForModel("anthropic/claude-sonnet-4.6")?.anthropic,
        ).toBe("claude-sonnet-4-6");
        expect(transportsForModel("google/gemini-3-flash")?.google).toBe(
            "gemini-3-flash-preview",
        );
        expect(transportsForModel("google/gemini-3.5-flash-lite")?.google).toBe(
            "gemini-3.5-flash-lite",
        );
        expect(transportsForModel("google/gemma-4-31b-it")?.google).toBe(
            "gemma-4-31b-it",
        );
        // A direct id resolves back to the same model.
        expect(registryEntryFor("claude-sonnet-5-5")?.id).toBe(
            "anthropic/claude-sonnet-5.5",
        );
    });

    it("does not offer a direct route for models without a confirmed id", () => {
        expect(transportsForModel("anthropic/claude-opus-4.6")?.anthropic).toBe(
            undefined,
        );
        expect(transportsForModel("google/gemini-2.5-pro")?.google).toBe(
            undefined,
        );
    });

    it("prices direct calls at the maker's list price", () => {
        const sonnet = registryEntryFor("anthropic/claude-sonnet-5.5");
        expect(sonnet?.pricingByTransport?.anthropic).toMatchObject({
            promptPricePerToken: 2 / 1e6,
            completionPricePerToken: 10 / 1e6,
            cacheReadPricePerToken: 0.1 / 1e6,
            cacheWritePricePerToken: 2.5 / 1e6,
        });
        const haiku = registryEntryFor("anthropic/claude-haiku-5.5");
        expect(haiku?.pricingByTransport?.anthropic?.promptTiers).toEqual([
            { minTokens: 0, maxTokens: 100_001, pricePerToken: 0.1 / 1e6 },
            { minTokens: 100_001, pricePerToken: 0.5 / 1e6 },
        ]);
        expect(
            registryEntryFor("google/gemini-3-flash")?.pricingByTransport
                ?.google,
        ).toMatchObject({
            promptPricePerToken: 0.5 / 1e6,
            completionPricePerToken: 3 / 1e6,
        });
        // Gemma 4 on the Gemini API is free of charge.
        expect(
            registryEntryFor("google/gemma-4-31b-it")?.pricingByTransport
                ?.google,
        ).toEqual({ promptPricePerToken: 0, completionPricePerToken: 0 });
    });

    it("needs no live discovery and no upstream routing", () => {
        expect(
            transportCapabilityForModel("google/gemini-3-flash", "google"),
        ).toMatchObject({
            transportModelId: "gemini-3-flash-preview",
            upstreamRoutingModes: ["none"],
            requiresCurrentDiscovery: false,
        });
    });

    it("lists direct models from the registry without calling the maker", async () => {
        await expect(
            listAvailableModelMetadata({}, { provider: "anthropic" }),
        ).rejects.toThrow("Anthropic API key");
        const listed = await listAvailableModelMetadata(
            { google: "test-google-key" },
            { provider: "google" },
        );
        expect(listed.map((model) => model.id).sort()).toEqual([
            "gemini-3-flash-preview",
            "gemini-3.5-flash-lite",
            "gemma-4-31b-it",
        ]);
        expect(directMakerModelIds("anthropic")).toHaveLength(4);
    });
});

describe("getEvalProvider direct maker transports", () => {
    it("routes an anthropic transport to the maker with its own model id", async () => {
        const anthropic = provider();
        const create = vi.fn(() => anthropic);
        await getEvalProvider(
            { anthropic: "test-anthropic-key", gateway: "gw-test" },
            { transport: "anthropic", createDirectMakerProvider: create },
        ).complete({
            model: "anthropic/claude-sonnet-5.5",
            prompt: "hi",
            maxTokens: 10,
        });
        expect(create).toHaveBeenCalledWith("anthropic", "test-anthropic-key");
        expect(anthropic.complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "claude-sonnet-5-5" }),
        );
    });

    it("routes a google transport with the Gemini key", async () => {
        const google = provider();
        const create = vi.fn(() => google);
        await getEvalProvider(
            { google: "test-gemini-key" },
            { transport: "google", createDirectMakerProvider: create },
        ).complete({
            model: "google/gemma-4-31b-it",
            prompt: "hi",
            maxTokens: 10,
        });
        expect(create).toHaveBeenCalledWith("google", "test-gemini-key");
        expect(google.complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "gemma-4-31b-it" }),
        );
    });

    it("asks for the key in Settings when it is missing", () => {
        expect(() =>
            getEvalProvider({ openai: "sk-test" }, { transport: "anthropic" }),
        ).toThrow("add your Anthropic API key in Settings");
        expect(() => getEvalProvider({}, { transport: "google" })).toThrow(
            "add your Gemini API key in Settings",
        );
    });

    it("rejects a model the maker does not serve directly", async () => {
        await expect(
            getEvalProvider(
                { anthropic: "test-anthropic-key" },
                {
                    transport: "anthropic",
                    createDirectMakerProvider: () => provider(),
                },
            ).complete({ model: "gpt-4o", prompt: "hi", maxTokens: 10 }),
        ).rejects.toThrow('does not support the "anthropic" transport');
    });

    it("auto mode calls the maker when only its key is saved", async () => {
        const anthropic = provider();
        await getEvalProvider(
            { anthropic: "test-anthropic-key" },
            {
                provider: "auto",
                createDirectMakerProvider: () => anthropic,
            },
        ).complete({
            model: "anthropic/claude-haiku-5.5",
            prompt: "hi",
            maxTokens: 10,
        });
        expect(anthropic.complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "claude-haiku-5-5" }),
        );
    });
});

describe("VercelAIEvalProvider as a direct maker call", () => {
    it("passes effort as the shared reasoning level and records the maker as host", async () => {
        const generateText = fakeGenerate(40);
        const result = await new VercelAIEvalProvider("test-key", {
            generateText,
            modelFor,
            directMaker: "anthropic",
            providerLabel: "Anthropic",
        }).complete({
            model: "claude-sonnet-5-5",
            prompt: "hi",
            maxTokens: 50,
            temperature: 0.2,
            reasoningEffort: "high",
            maxRetries: 0,
            timeoutMs: 5_000,
        });
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                reasoning: "high",
                // Claude 5.5 refuses sampling settings; none is sent.
                temperature: undefined,
                maxRetries: 0,
                timeout: 5_000,
            }),
        );
        const call = (generateText.mock.calls[0] as unknown[])[0] as Record<
            string,
            unknown
        >;
        expect(call.providerOptions).toBeUndefined();
        expect(result.providerMetadata).toEqual({ servedBy: "anthropic" });
        expect(result.actualRoute).toEqual({
            status: "resolved",
            transport: "anthropic",
            modelId: "claude-sonnet-5-5",
            upstreamProvider: "anthropic",
            generationId: "msg_test_1",
            evidenceCompleteness: "complete",
        });
        expect(result.usage.cacheReadTokens).toBe(40);
        expect(result.cache).toEqual({
            status: "provider_cache",
            kind: "prompt",
            hit: true,
        });
    });

    it("reports cache writes so they are charged at the cache-write rate", async () => {
        const generateText = vi.fn(async () => ({
            text: "ok",
            output: "ok",
            usage: {
                ...usage(10),
                inputTokenDetails: {
                    noCacheTokens: 30,
                    cacheReadTokens: 10,
                    cacheWriteTokens: 80,
                },
            },
            response: { id: "msg_test_2", modelId: "claude-sonnet-5-5" },
        }));
        const result = await new VercelAIEvalProvider("test-key", {
            generateText,
            modelFor,
            directMaker: "anthropic",
            providerLabel: "Anthropic",
        }).complete({
            model: "claude-sonnet-5-5",
            prompt: "hi",
            maxTokens: 50,
        });
        expect(result.usage).toMatchObject({
            promptTokens: 120,
            cacheReadTokens: 10,
            cacheWriteTokens: 80,
        });
    });

    it("leaves reasoning unset when the run has no effort", async () => {
        const generateText = fakeGenerate();
        const result = await new VercelAIEvalProvider("test-key", {
            generateText,
            modelFor,
            directMaker: "google",
        }).complete({
            model: "gemini-3-flash-preview",
            prompt: "hi",
            maxTokens: 5,
        });
        const call = (generateText.mock.calls[0] as unknown[])[0] as Record<
            string,
            unknown
        >;
        expect("reasoning" in call).toBe(false);
        expect(result.providerMetadata).toEqual({ servedBy: "google" });
        expect(result.cache).toEqual({ status: "miss" });
    });

    it("follows host rules that allow the maker and refuses the rest", async () => {
        const generateText = fakeGenerate();
        const google = new VercelAIEvalProvider("test-key", {
            generateText,
            modelFor,
            directMaker: "google",
            providerLabel: "Gemini API",
        });
        const req = { model: "gemma-4-31b-it", prompt: "hi", maxTokens: 5 };
        await expect(
            google.complete({
                ...req,
                dataPolicy: { onlyHosts: ["google-ai-studio"] },
            }),
        ).resolves.toMatchObject({ text: "ok" });
        await expect(
            google.complete({ ...req, dataPolicy: { onlyHosts: ["vertex"] } }),
        ).rejects.toThrow('don\'t allow "google"');
        await expect(
            google.complete({
                ...req,
                dataPolicy: { zeroDataRetention: true },
            }),
        ).rejects.toThrow("can't promise zero data retention");
        await expect(
            google.complete({
                ...req,
                dataPolicy: {
                    onlyHosts: ["google"],
                    disallowPromptTraining: true,
                },
            }),
        ).rejects.toThrow("no training on prompts");
        expect(generateText).toHaveBeenCalledTimes(1);
        expect(DIRECT_MAKER_HOSTS.anthropic).toEqual(["anthropic"]);
    });

    it("names the maker when the call fails", async () => {
        const generateText = vi.fn(async () => {
            throw new Error("overloaded");
        });
        await expect(
            new VercelAIEvalProvider("test-key", {
                generateText,
                modelFor,
                directMaker: "anthropic",
                providerLabel: "Anthropic",
            }).complete({
                model: "claude-opus-5-5",
                prompt: "hi",
                maxTokens: 5,
            }),
        ).rejects.toThrow(
            "Anthropic request failed for claude-opus-5-5: overloaded",
        );
    });
});
