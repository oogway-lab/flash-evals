import { afterEach, describe, expect, it, vi } from "vitest";
import type { IEvalCompletionProvider } from "../types.js";
import {
    evalTransportFor,
    getEvalProvider,
    providerModeFromEnv,
} from "./factory.js";

function provider(): IEvalCompletionProvider {
    return { complete: vi.fn() };
}

describe("getEvalProvider transport routing", () => {
    const env = (
        globalThis as unknown as {
            process: { env: Record<string, string | undefined> };
        }
    ).process.env;
    const originalProviderEnv = env.FLASH_EVALS_LLM_PROVIDER;

    afterEach(() => {
        if (originalProviderEnv === undefined) {
            delete env.FLASH_EVALS_LLM_PROVIDER;
        } else {
            env.FLASH_EVALS_LLM_PROVIDER = originalProviderEnv;
        }
    });

    it("preserves environment selection when transport is absent", () => {
        env.FLASH_EVALS_LLM_PROVIDER = "openai";
        const openai = provider();

        expect(
            getEvalProvider(
                { openai: "sk-test", gateway: "gw-test" },
                {
                    createOpenAIProvider: () => openai,
                    createGatewayProvider: () => provider(),
                },
            ),
        ).toBe(openai);
    });

    it("uses an explicit transport instead of the environment default", async () => {
        env.FLASH_EVALS_LLM_PROVIDER = "openai";
        const gateway = provider();

        const routed = getEvalProvider(
            { openai: "sk-test", gateway: "gw-test" },
            {
                transport: "gateway",
                createOpenAIProvider: () => provider(),
                createGatewayProvider: () => gateway,
            },
        );
        await routed.complete({
            model: "gpt-4o",
            prompt: "hello",
            maxTokens: 10,
        });

        expect(gateway.complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "openai/gpt-4o" }),
        );
    });

    it("uses an exact provider-listed model id without registry support", async () => {
        const gateway = provider();
        const routed = getEvalProvider(
            { gateway: "gw-test" },
            {
                transport: "gateway",
                exactTransportModelId: "zai/glm-5.1",
                createGatewayProvider: () => gateway,
            },
        );

        await routed.complete({
            model: "zai/glm-5.1",
            prompt: "hello",
            maxTokens: 10,
        });

        expect(gateway.complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "zai/glm-5.1" }),
        );
    });

    it("maps requests to the id declared for the selected transport", async () => {
        const complete = vi.fn().mockResolvedValue({
            text: "ok",
            usage: {},
            latencyMs: 1,
        });
        const openrouter: IEvalCompletionProvider = { complete };
        const routed = getEvalProvider(
            { openrouter: "or-test" },
            {
                transport: "openrouter",
                createOpenAICompatibleProvider: () => openrouter,
            },
        );

        await routed.complete({
            model: "gpt-4o",
            prompt: "hello",
            maxTokens: 10,
        });

        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "openai/gpt-4o" }),
        );
    });

    it("maps requests to the Bifrost transport model id", async () => {
        const complete = vi
            .fn()
            .mockResolvedValue({ text: "ok", usage: {}, latencyMs: 1 });
        const routed = getEvalProvider(
            {
                bifrost: "bf-test",
                bifrostBaseUrl: "https://bifrost.example/v1",
            },
            {
                transport: "bifrost",
                createOpenAICompatibleProvider: () => ({ complete }),
            },
        );

        await routed.complete({
            model: "gpt-4o",
            prompt: "hello",
            maxTokens: 10,
        });

        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "openai/gpt-4o" }),
        );
    });

    it("throws a capability error instead of falling back", async () => {
        const openrouter = provider();
        const routed = getEvalProvider(
            { openai: "sk-test", openrouter: "or-test" },
            {
                transport: "openrouter",
                createOpenAIProvider: () => provider(),
                createOpenAICompatibleProvider: () => openrouter,
            },
        );

        await expect(
            routed.complete({
                model: "alibaba/qwen3-max",
                prompt: "hello",
                maxTokens: 10,
            }),
        ).rejects.toThrow(
            'Model "alibaba/qwen3-max" does not support the "openrouter" transport.',
        );
        expect(openrouter.complete).not.toHaveBeenCalled();
    });

    it("routes a provider-qualified model through an available non-OpenAI credential", async () => {
        const gateway = provider();
        const routed = getEvalProvider(
            { gateway: "gw-test" },
            { createGatewayProvider: () => gateway },
        );

        await routed.complete({
            model: "anthropic/claude-sonnet-4.5",
            prompt: "hello",
            maxTokens: 10,
        });

        expect(gateway.complete).toHaveBeenCalledWith(
            expect.objectContaining({ model: "anthropic/claude-sonnet-4.5" }),
        );
    });
});

describe("evalTransportFor", () => {
    const env = (
        globalThis as unknown as {
            process: { env: Record<string, string | undefined> };
        }
    ).process.env;
    const original = env.FLASH_EVALS_LLM_PROVIDER;
    afterEach(() => {
        if (original === undefined) delete env.FLASH_EVALS_LLM_PROVIDER;
        else env.FLASH_EVALS_LLM_PROVIDER = original;
    });

    it("names the transport a call would use, as the provider picks it", () => {
        delete env.FLASH_EVALS_LLM_PROVIDER;
        expect(
            evalTransportFor("gpt-4o", {}, { transport: "openrouter" }),
        ).toBe("openrouter");
        expect(
            evalTransportFor("openai/gpt-4o", { openrouter: "or-test" }),
        ).toBe("openrouter");
        expect(evalTransportFor("gpt-4o", { openai: "sk-test" })).toBe(
            "openai",
        );
        expect(evalTransportFor("gpt-4o", {}, { provider: "vercel-ai" })).toBe(
            "openai",
        );
        expect(evalTransportFor("gpt-4o", {})).toBeUndefined();
    });

    it("prefers a route that can follow data rules in auto mode", async () => {
        delete env.FLASH_EVALS_LLM_PROVIDER;
        const keys = { openai: "sk-test", gateway: "gw-test" };
        const rules = { onlyHosts: ["azure"] };
        expect(evalTransportFor("gpt-4o", keys, {}, rules)).toBe("gateway");
        // Without rules, OpenAI's own key still goes first.
        expect(evalTransportFor("gpt-4o", keys)).toBe("openai");
        const gateway = provider();
        const openai = provider();
        await getEvalProvider(keys, {
            createGatewayProvider: () => gateway,
            createOpenAIProvider: () => openai,
        }).complete({
            model: "gpt-4o",
            prompt: "hello",
            maxTokens: 10,
            dataPolicy: rules,
        });
        expect(gateway.complete).toHaveBeenCalled();
        expect(openai.complete).not.toHaveBeenCalled();
        // No route that can follow the rules: unchanged (the call says why).
        expect(
            evalTransportFor("gpt-4o", { openai: "sk-test" }, {}, rules),
        ).toBe("openai");
    });
});

describe("providerModeFromEnv names", () => {
    it("reads vercel-ai-gateway as the Vercel gateway", () => {
        const env = process.env.FLASH_EVALS_LLM_PROVIDER;
        try {
            process.env.FLASH_EVALS_LLM_PROVIDER = "vercel-ai-gateway";
            expect(providerModeFromEnv()).toBe("gateway");
            process.env.FLASH_EVALS_LLM_PROVIDER = "gateway";
            expect(providerModeFromEnv()).toBe("gateway");
        } finally {
            if (env === undefined) delete process.env.FLASH_EVALS_LLM_PROVIDER;
            else process.env.FLASH_EVALS_LLM_PROVIDER = env;
        }
    });
});
