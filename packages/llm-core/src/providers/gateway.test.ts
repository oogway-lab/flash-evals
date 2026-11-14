import { describe, expect, it, vi } from "vitest";
import { GatewayEvalProvider } from "./gateway.js";

describe("Gateway route forwarding", () => {
    it("preserves legacy retries by default and honors workflow explicit zero", async () => {
        const generate = vi.fn().mockResolvedValue({
            text: "ok",
            output: undefined,
            usage: {
                inputTokens: 1,
                outputTokens: 1,
                totalTokens: 2,
                inputTokenDetails: {},
                outputTokenDetails: {},
            },
        });
        const provider = new GatewayEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
        });
        const request = {
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
        };

        await provider.complete(request);
        await provider.complete({ ...request, maxRetries: 0 });

        expect(generate.mock.calls[0]?.[0]).toMatchObject({ maxRetries: 2 });
        expect(generate.mock.calls[1]?.[0]).toMatchObject({ maxRetries: 0 });
    });
});

describe("Gateway data rules", () => {
    const usage = {
        inputTokens: 1,
        outputTokens: 1,
        totalTokens: 2,
        inputTokenDetails: {},
        outputTokenDetails: {},
    };

    it("sends the hosts, zero retention and no-training rules to Vercel", async () => {
        const generate = vi.fn().mockResolvedValue({
            text: "ok",
            output: undefined,
            usage,
            providerMetadata: {
                gateway: {
                    generationId: "gen_1",
                    routing: { finalProvider: "vertex" },
                },
            },
        });
        const provider = new GatewayEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
        });
        const result = await provider.complete({
            model: "google/gemma-4-31b-it",
            prompt: "hi",
            maxTokens: 10,
            dataPolicy: {
                onlyHosts: ["vertex", "bedrock"],
                zeroDataRetention: true,
                disallowPromptTraining: true,
            },
        });
        expect(generate.mock.calls[0]?.[0]).toMatchObject({
            providerOptions: {
                gateway: {
                    only: ["vertex", "bedrock"],
                    zeroDataRetention: true,
                    disallowPromptTraining: true,
                },
            },
        });
        // Which host served it is recorded.
        expect(result.providerMetadata).toEqual({
            gateway: { generationId: "gen_1" },
            servedBy: "vertex",
        });
        expect(result.actualRoute).toMatchObject({
            status: "resolved",
            upstreamProvider: "vertex",
        });
    });

    it("sends no gateway options without rules", async () => {
        const generate = vi.fn().mockResolvedValue({
            text: "ok",
            output: undefined,
            usage,
        });
        const provider = new GatewayEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
        });
        await provider.complete({
            model: "google/gemma-4-31b-it",
            prompt: "hi",
            maxTokens: 10,
            dataPolicy: {},
        });
        expect(generate.mock.calls[0]?.[0].providerOptions).toBeUndefined();
    });
});
