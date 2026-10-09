import { afterEach, describe, expect, it, vi } from "vitest";
import {
    getEvalProvider,
    type IEvalCompletionProvider,
} from "@mosaic/llm-core";

function provider(): IEvalCompletionProvider {
    return {
        complete: vi.fn(),
    };
}

const AUTO_REQUEST = {
    model: "gpt-4o",
    prompt: "hello",
    maxTokens: 10,
};

describe("getEvalProvider", () => {
    const originalProviderEnv = process.env.MOSAIC_LLM_PROVIDER;
    const originalGatewayFallbackModelsEnv =
        process.env.MOSAIC_GATEWAY_FALLBACK_MODELS;

    afterEach(() => {
        if (originalProviderEnv === undefined) {
            delete process.env.MOSAIC_LLM_PROVIDER;
        } else {
            process.env.MOSAIC_LLM_PROVIDER = originalProviderEnv;
        }
        if (originalGatewayFallbackModelsEnv === undefined) {
            delete process.env.MOSAIC_GATEWAY_FALLBACK_MODELS;
        } else {
            process.env.MOSAIC_GATEWAY_FALLBACK_MODELS =
                originalGatewayFallbackModelsEnv;
        }
    });

    it("selects the OpenAI SDK provider explicitly", () => {
        const openai = provider();
        const vercel = provider();

        const result = getEvalProvider(
            { openai: "sk-test" },
            {
                provider: "openai",
                createOpenAIProvider: () => openai,
                createVercelAIProvider: () => vercel,
            },
        );

        expect(result).toBe(openai);
    });

    it("lets explicit provider options override MOSAIC_LLM_PROVIDER", () => {
        process.env.MOSAIC_LLM_PROVIDER = "openai";
        const openai = provider();
        const vercel = provider();

        const result = getEvalProvider(
            { openai: "sk-test" },
            {
                provider: "vercel-ai",
                createOpenAIProvider: () => openai,
                createVercelAIProvider: () => vercel,
            },
        );

        expect(result).toBe(vercel);
    });

    it("selects the Vercel AI SDK provider explicitly", () => {
        const openai = provider();
        const vercel = provider();

        const result = getEvalProvider(
            { openai: "sk-test" },
            {
                provider: "vercel-ai",
                createOpenAIProvider: () => openai,
                createVercelAIProvider: () => vercel,
            },
        );

        expect(result).toBe(vercel);
    });

    it("routes unqualified auto-mode requests through the OpenAI transport", async () => {
        delete process.env.MOSAIC_LLM_PROVIDER;
        const openai = provider();
        const vercel = provider();

        const result = getEvalProvider(
            { openai: "sk-test" },
            {
                createOpenAIProvider: () => openai,
                createVercelAIProvider: () => vercel,
            },
        );

        await result.complete(AUTO_REQUEST);

        expect(openai.complete).toHaveBeenCalledWith(AUTO_REQUEST);
        expect(vercel.complete).not.toHaveBeenCalled();
    });

    it("selects providers from MOSAIC_LLM_PROVIDER", () => {
        const openai = provider();
        const vercel = provider();
        const gateway = provider();
        const openrouter = provider();
        const bifrost = provider();

        process.env.MOSAIC_LLM_PROVIDER = "openai";
        expect(
            getEvalProvider(
                { openai: "sk-test", gateway: "vck-test" },
                {
                    createOpenAIProvider: () => openai,
                    createGatewayProvider: () => gateway,
                    createVercelAIProvider: () => vercel,
                },
            ),
        ).toBe(openai);

        process.env.MOSAIC_LLM_PROVIDER = "vercel-ai";
        expect(
            getEvalProvider(
                { openai: "sk-test", gateway: "vck-test" },
                {
                    createOpenAIProvider: () => openai,
                    createGatewayProvider: () => gateway,
                    createVercelAIProvider: () => vercel,
                },
            ),
        ).toBe(vercel);

        process.env.MOSAIC_LLM_PROVIDER = "gateway";
        expect(
            getEvalProvider(
                { openai: "sk-test", gateway: "vck-test" },
                {
                    createOpenAIProvider: () => openai,
                    createGatewayProvider: () => gateway,
                    createVercelAIProvider: () => vercel,
                },
            ),
        ).toBe(gateway);

        process.env.MOSAIC_LLM_PROVIDER = "openrouter";
        expect(
            getEvalProvider(
                {
                    openai: "sk-test",
                    gateway: "vck-test",
                    openrouter: "or-test",
                },
                {
                    createOpenAIProvider: () => openai,
                    createGatewayProvider: () => gateway,
                    createVercelAIProvider: () => vercel,
                    createOpenAICompatibleProvider: (_apiKey, options) =>
                        options.providerLabel === "OpenRouter"
                            ? openrouter
                            : provider(),
                },
            ),
        ).toBe(openrouter);

        process.env.MOSAIC_LLM_PROVIDER = "bifrost";
        expect(
            getEvalProvider(
                {
                    openai: "sk-test",
                    gateway: "vck-test",
                    bifrost: "bf-test",
                    bifrostBaseUrl: "https://bifrost.example/v1",
                },
                {
                    createOpenAIProvider: () => openai,
                    createGatewayProvider: () => gateway,
                    createVercelAIProvider: () => vercel,
                    createOpenAICompatibleProvider: (_apiKey, options) =>
                        options.providerLabel === "Bifrost"
                            ? bifrost
                            : provider(),
                },
            ),
        ).toBe(bifrost);
    });

    it("throws on unknown MOSAIC_LLM_PROVIDER values", () => {
        process.env.MOSAIC_LLM_PROVIDER = "not-a-provider";

        expect(() =>
            getEvalProvider(
                { openai: "sk-test" },
                {
                    createOpenAIProvider: () => provider(),
                    createVercelAIProvider: () => provider(),
                },
            ),
        ).toThrow(/Invalid MOSAIC_LLM_PROVIDER value "not-a-provider"/);
    });

    it("requires OpenRouter and Bifrost provider-specific settings", () => {
        expect(() =>
            getEvalProvider(
                {},
                {
                    provider: "openrouter",
                    createOpenAICompatibleProvider: () => provider(),
                },
            ),
        ).toThrow(/OpenRouter API key/);

        expect(() =>
            getEvalProvider(
                { bifrost: "bf-test" },
                {
                    provider: "bifrost",
                    createOpenAICompatibleProvider: () => provider(),
                },
            ),
        ).toThrow(/BIFROST_BASE_URL/);
    });

    it("keeps auto mode when MOSAIC_LLM_PROVIDER is empty", async () => {
        process.env.MOSAIC_LLM_PROVIDER = "";
        const openai = provider();
        const vercel = provider();

        const result = getEvalProvider(
            { openai: "sk-test" },
            {
                createOpenAIProvider: () => openai,
                createVercelAIProvider: () => vercel,
            },
        );

        await result.complete(AUTO_REQUEST);

        expect(openai.complete).toHaveBeenCalledWith(AUTO_REQUEST);
        expect(vercel.complete).not.toHaveBeenCalled();
    });

    it("does not initialize the legacy Vercel provider for auto-mode requests", async () => {
        const openai = provider();
        const createVercelAIProvider = vi.fn(() => {
            throw new Error("AI SDK unavailable");
        });

        const result = getEvalProvider(
            { openai: "sk-test" },
            {
                provider: "auto",
                createOpenAIProvider: () => openai,
                createVercelAIProvider,
            },
        );

        await result.complete(AUTO_REQUEST);

        expect(openai.complete).toHaveBeenCalledWith(AUTO_REQUEST);
        expect(createVercelAIProvider).not.toHaveBeenCalled();
    });

    it("requires a usable provider key when an auto-mode request is run", () => {
        const result = getEvalProvider({}, { provider: "auto" });

        expect(() => result.complete(AUTO_REQUEST)).toThrow(
            /Please add an API key to run evals/,
        );
    });

    it("requires an AI Gateway key in gateway mode", () => {
        expect(() =>
            getEvalProvider(
                { openai: "sk-test" },
                {
                    provider: "gateway",
                    createGatewayProvider: () => provider(),
                },
            ),
        ).toThrow(/AI Gateway API key/);
    });

    it("rejects configured Gateway fallback models for eval runs", () => {
        expect(() =>
            getEvalProvider(
                { gateway: "vck-test" },
                {
                    provider: "gateway",
                    gatewayFallbackModels: ["openai/gpt-4o-mini"],
                },
            ),
        ).toThrow(/Gateway fallback models are not supported/);
    });

    it("rejects Gateway fallback models from MOSAIC_GATEWAY_FALLBACK_MODELS", () => {
        process.env.MOSAIC_GATEWAY_FALLBACK_MODELS =
            " openai/gpt-4o-mini, ,openai/gpt-4.1-mini ";

        expect(() =>
            getEvalProvider(
                { gateway: "vck-test" },
                {
                    provider: "gateway",
                },
            ),
        ).toThrow(/Gateway fallback models are not supported/);
    });
});
