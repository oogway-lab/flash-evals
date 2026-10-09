import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    NoObjectGeneratedError,
    type LanguageModel,
    type LanguageModelUsage,
} from "ai";
import { GatewayEvalProvider, gatewayModelIdFor } from "@mosaic/llm-core";

const gatewayMocks = vi.hoisted(() => {
    const modelFor = vi.fn(
        (model: string) =>
            ({
                provider: "gateway",
                modelId: model,
            }) as LanguageModel,
    );
    return {
        createGateway: vi.fn(() => modelFor),
        modelFor,
    };
});

vi.mock("@ai-sdk/gateway", () => ({
    createGateway: gatewayMocks.createGateway,
}));

function usage(
    override: Partial<LanguageModelUsage> = {},
): LanguageModelUsage {
    return {
        inputTokens: 11,
        inputTokenDetails: {
            noCacheTokens: undefined,
            cacheReadTokens: undefined,
            cacheWriteTokens: undefined,
        },
        outputTokens: 7,
        outputTokenDetails: {
            textTokens: undefined,
            reasoningTokens: 3,
        },
        totalTokens: 18,
        ...override,
    };
}

function modelFor(model: string): LanguageModel {
    return { provider: "gateway", modelId: model } as LanguageModel;
}

describe("gatewayModelIdFor", () => {
    it("maps stable OpenAI model ids to Gateway model ids", () => {
        expect(gatewayModelIdFor("gpt-4o")).toBe("openai/gpt-4o");
    });

    it("preserves explicit Gateway model ids", () => {
        expect(gatewayModelIdFor("anthropic/claude-sonnet-4.6")).toBe(
            "anthropic/claude-sonnet-4.6",
        );
    });
});

describe("GatewayEvalProvider", () => {
    const originalReferer = process.env.MOSAIC_GATEWAY_HTTP_REFERER;
    const originalTitle = process.env.MOSAIC_GATEWAY_APP_TITLE;

    beforeEach(() => {
        gatewayMocks.createGateway.mockClear();
        gatewayMocks.modelFor.mockClear();
    });

    afterEach(() => {
        if (originalReferer === undefined) {
            delete process.env.MOSAIC_GATEWAY_HTTP_REFERER;
        } else {
            process.env.MOSAIC_GATEWAY_HTTP_REFERER = originalReferer;
        }
        if (originalTitle === undefined) {
            delete process.env.MOSAIC_GATEWAY_APP_TITLE;
        } else {
            process.env.MOSAIC_GATEWAY_APP_TITLE = originalTitle;
        }
    });

    it("creates the Gateway client with the API key and attribution headers", async () => {
        process.env.MOSAIC_GATEWAY_HTTP_REFERER = "https://mosaic.test";
        process.env.MOSAIC_GATEWAY_APP_TITLE = "Flash Evals";
        const generateText = vi.fn(async () => ({
            text: "hello",
            output: "hello",
            usage: usage(),
        }));
        const provider = new GatewayEvalProvider("vck-test", {
            createGatewayProvider: gatewayMocks.createGateway,
            generateText,
        });

        await provider.complete({
            model: "gpt-4o",
            prompt: "Say hello.",
            maxTokens: 100,
        });

        expect(gatewayMocks.createGateway).toHaveBeenCalledWith({
            apiKey: "vck-test",
            headers: {
                "http-referer": "https://mosaic.test",
                "x-title": "Flash Evals",
            },
        });
        expect(gatewayMocks.modelFor).toHaveBeenCalledWith("openai/gpt-4o");
    });

    it("omits Gateway attribution headers when they are not configured", () => {
        delete process.env.MOSAIC_GATEWAY_HTTP_REFERER;
        delete process.env.MOSAIC_GATEWAY_APP_TITLE;

        new GatewayEvalProvider("vck-test", {
            createGatewayProvider: gatewayMocks.createGateway,
        });

        expect(gatewayMocks.createGateway).toHaveBeenCalledWith({
            apiKey: "vck-test",
            headers: undefined,
        });
    });

    it("maps plain text completions into the Flash Evals result shape", async () => {
        const generateText = vi.fn(async () => ({
            text: "hello",
            output: "hello",
            usage: usage(),
            providerMetadata: {
                gateway: { generationId: "gen_123", rawPayload: "ignored" },
                providerSecret: "ignored",
            },
        }));
        const provider = new GatewayEvalProvider("vck-test", {
            generateText,
            modelFor,
        });

        const result = await provider.complete({
            model: "gpt-4o",
            system: "Answer tersely.",
            prompt: "Say hello.",
            maxTokens: 100,
        });

        expect(result).toMatchObject({
            text: "hello",
            usage: {
                promptTokens: 11,
                completionTokens: 7,
                reasoningTokens: 3,
                totalTokens: 18,
            },
            providerMetadata: {
                gateway: { generationId: "gen_123" },
            },
        });
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                model: { provider: "gateway", modelId: "openai/gpt-4o" },
                instructions: "Answer tersely.",
                maxOutputTokens: 100,
                messages: [
                    {
                        role: "user",
                        content: [{ type: "text", text: "Say hello." }],
                    },
                ],
            }),
        );
    });

    it("rejects Gateway fallback models for eval runs", () => {
        expect(
            () =>
                new GatewayEvalProvider("vck-test", {
                    fallbackModels: ["openai/gpt-5.4-mini"],
                    generateText: vi.fn(),
                    modelFor,
                }),
        ).toThrow(/Gateway fallback models are not supported/);
    });

    it("passes OpenAI reasoning effort", async () => {
        const signal = new AbortController().signal;
        const generateText = vi.fn(async () => ({
            text: "done",
            output: "done",
            usage: usage(),
        }));
        const provider = new GatewayEvalProvider("vck-test", {
            generateText,
            modelFor,
        });

        await provider.complete({
            model: "openai/gpt-5.5",
            prompt: "Think.",
            images: [{ mimeType: "image/png", base64Data: "abc123" }],
            maxTokens: 100,
            reasoningEffort: "low",
            signal,
        });

        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                abortSignal: signal,
                temperature: undefined,
                providerOptions: {
                    openai: { reasoningEffort: "low" },
                },
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Think." },
                            {
                                type: "image",
                                image: "data:image/png;base64,abc123",
                                mediaType: "image/png",
                            },
                        ],
                    },
                ],
            }),
        );
    });

    it("maps structured output into parsed JSON text", async () => {
        const output = { answer: "yes" };
        const generateText = vi.fn(async () => ({
            text: "Human-readable wrapper",
            output,
            usage: usage(),
        }));
        const provider = new GatewayEvalProvider("vck-test", {
            generateText,
            modelFor,
        });

        const result = await provider.complete({
            model: "gpt-4o",
            prompt: "Return JSON.",
            responseSchema: {
                name: "answer",
                schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["answer"],
                    properties: { answer: { type: "string" } },
                },
            },
            maxTokens: 100,
        });

        expect(result.text).toBe(JSON.stringify(output));
        expect(result.parsed).toEqual(output);
        expect(result.schemaViolation).toBe(false);
    });

    it("wraps Gateway request failures with provider context and cause", async () => {
        const cause = new Error("gateway down");
        const provider = new GatewayEvalProvider("vck-test", {
            generateText: vi.fn(async () => {
                throw cause;
            }),
            modelFor,
        });

        await expect(
            provider.complete({
                model: "gpt-4o",
                prompt: "Say hello.",
                maxTokens: 100,
            }),
        ).rejects.toMatchObject({
            message:
                "Vercel AI Gateway request failed for gpt-4o: gateway down",
            cause,
        });
    });

    it("maps structured output validation failures to schema violations", async () => {
        const provider = new GatewayEvalProvider("vck-test", {
            generateText: vi.fn(async () => {
                throw new NoObjectGeneratedError({
                    message: "No object generated.",
                    text: "not json",
                    response: {
                        id: "resp-1",
                        modelId: "openai/gpt-4o",
                        timestamp: new Date(0),
                    },
                    usage: usage(),
                    finishReason: "stop",
                });
            }),
            modelFor,
        });

        const result = await provider.complete({
            model: "gpt-4o",
            prompt: "Return JSON.",
            responseSchema: {
                name: "answer",
                schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["answer"],
                    properties: { answer: { type: "string" } },
                },
            },
            maxTokens: 100,
        });

        expect(result).toMatchObject({
            text: "not json",
            parsed: undefined,
            schemaViolation: true,
            usage: {
                promptTokens: 11,
                completionTokens: 7,
                reasoningTokens: 3,
                totalTokens: 18,
            },
        });
    });
});
