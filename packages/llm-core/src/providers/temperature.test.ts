import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LanguageModel } from "ai";
import { resetBifrostModelInfo } from "./bifrostModelInfo.js";
import { GatewayEvalProvider } from "./gateway.js";
import { OpenAIEvalProvider } from "./openai.js";
import { VercelAIEvalProvider } from "./vercelAi.js";
import type { CompletionTransport } from "../types.js";

// An eval run's temperature reaches the request body on every route, and is
// left out for a model that refuses it.

const usage = {
    inputTokens: 1,
    outputTokens: 5,
    totalTokens: 6,
    inputTokenDetails: {},
    outputTokenDetails: {},
};

function fakeGenerate() {
    return vi.fn((..._args: unknown[]) =>
        Promise.resolve({ text: "ok", output: undefined, usage }),
    );
}

function modelFor(model: string): LanguageModel {
    return { provider: "test", modelId: model } as LanguageModel;
}

function generateArgs(
    generate: ReturnType<typeof fakeGenerate>,
): Record<string, unknown> {
    return generate.mock.calls[0]?.[0] as Record<string, unknown>;
}

function openAICompatible(transport: CompletionTransport) {
    const response = {
        id: "gen-1",
        model: "m",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 5, total_tokens: 6 },
    };
    const create = vi.fn((..._args: unknown[]) => {
        const request = Promise.resolve(response) as Promise<
            typeof response
        > & { withResponse(): Promise<unknown> };
        request.withResponse = async () => ({
            data: response,
            response: new Response(null),
        });
        return request;
    });
    const provider = new OpenAIEvalProvider("secret", {
        transport,
        client: {
            chat: { completions: { create, parse: create } },
        } as never,
    });
    return {
        provider,
        body: () => create.mock.calls[0]?.[0] as Record<string, unknown>,
    };
}

const call = (model: string, temperature?: number) => ({
    model,
    prompt: "hi",
    maxTokens: 100,
    ...(temperature !== undefined ? { temperature } : {}),
});

describe("temperature on each route", () => {
    beforeEach(() => resetBifrostModelInfo());

    it("Vercel AI Gateway sends it", async () => {
        const generate = fakeGenerate();
        await new GatewayEvalProvider("secret", {
            generateText: generate as never,
            modelFor: () => ({}) as never,
        }).complete(call("anthropic/claude-sonnet-4.5", 0.3));
        expect(generateArgs(generate).temperature).toBe(0.3);
    });

    it("Vercel AI Gateway leaves it out for an OpenAI reasoning model", async () => {
        const generate = fakeGenerate();
        await new GatewayEvalProvider("secret", {
            generateText: generate as never,
            modelFor: () => ({}) as never,
        }).complete(call("openai/gpt-6-luna", 0.3));
        expect(generateArgs(generate).temperature).toBeUndefined();
    });

    it.each<[CompletionTransport, string]>([
        ["openai", "gpt-4o"],
        ["openrouter", "anthropic/claude-sonnet-4.5"],
        ["bifrost", "openai/gpt-4o"],
        ["bifrost", "openrouter/z-ai/glm-5.2"],
    ])("%s sends it for %s", async (transport, model) => {
        const harness = openAICompatible(transport);
        await harness.provider.complete(call(model, 0.3));
        expect(harness.body().temperature).toBe(0.3);
    });

    it.each<[CompletionTransport, string]>([
        ["openai", "gpt-6-luna"],
        ["openrouter", "openai/gpt-6-luna"],
        ["bifrost", "openrouter/openai/gpt-6-luna"],
    ])(
        "%s leaves it out for the OpenAI reasoning model %s",
        async (transport, model) => {
            const harness = openAICompatible(transport);
            await harness.provider.complete(call(model, 0.3));
            expect(harness.body().temperature).toBeUndefined();
        },
    );

    it.each<[CompletionTransport, string]>([
        ["openai", "gpt-4o"],
        ["openrouter", "anthropic/claude-sonnet-4.5"],
        ["bifrost", "openai/gpt-4o"],
    ])("%s sends none when the run set none", async (transport, model) => {
        const harness = openAICompatible(transport);
        await harness.provider.complete(call(model));
        expect(harness.body().temperature).toBeUndefined();
    });

    it.each<["anthropic" | "google", string]>([
        ["anthropic", "claude-sonnet-4-6"],
        ["google", "gemini-3-flash-preview"],
    ])("the %s API sends it", async (directMaker, model) => {
        const generate = fakeGenerate();
        await new VercelAIEvalProvider("test-key", {
            generateText: generate as never,
            modelFor,
            directMaker,
            providerLabel: directMaker,
        }).complete(call(model, 0.3));
        expect(generateArgs(generate).temperature).toBe(0.3);
    });

    it("leaves it out for Claude 5.x on the Anthropic API and the Gateway", async () => {
        const direct = fakeGenerate();
        await new VercelAIEvalProvider("test-key", {
            generateText: direct as never,
            modelFor,
            directMaker: "anthropic",
            providerLabel: "anthropic",
        }).complete(call("claude-sonnet-5-5", 0.3));
        expect(generateArgs(direct).temperature).toBeUndefined();
        const gateway = fakeGenerate();
        await new GatewayEvalProvider("secret", {
            generateText: gateway as never,
            modelFor: () => ({}) as never,
        }).complete(call("anthropic/claude-fable-5", 0.3));
        expect(generateArgs(gateway).temperature).toBeUndefined();
    });

    it.each<[CompletionTransport, string]>([
        ["openrouter", "anthropic/claude-opus-5.5"],
        ["bifrost", "openrouter/anthropic/claude-sonnet-5.5"],
    ])("%s leaves it out for the Claude model %s", async (transport, model) => {
        const harness = openAICompatible(transport);
        await harness.provider.complete(call(model, 0.3));
        expect(harness.body().temperature).toBeUndefined();
    });

    it("the OpenAI route through the AI SDK sends it", async () => {
        const generate = fakeGenerate();
        await new VercelAIEvalProvider("test-key", {
            generateText: generate as never,
            modelFor,
        }).complete(call("gpt-4o", 0.3));
        expect(generateArgs(generate).temperature).toBe(0.3);
    });
});
