import { describe, expect, it, vi } from "vitest";
import {
    NoObjectGeneratedError,
    type LanguageModel,
    type LanguageModelUsage,
} from "ai";
import { VercelAIEvalProvider } from "@mosaic/llm-core";

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
    return { provider: "test", modelId: model } as LanguageModel;
}

describe("VercelAIEvalProvider", () => {
    it("maps plain text completions into the Flash Evals result shape", async () => {
        const generateText = vi.fn(async () => ({
            text: "hello",
            output: "hello",
            usage: usage(),
        }));
        const provider = new VercelAIEvalProvider("sk-test", {
            generateText,
            modelFor,
        });

        const result = await provider.complete({
            model: "gpt-4o",
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
        });
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
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

    it("maps structured output into parsed JSON text", async () => {
        const output = { answer: "yes" };
        const generateText = vi.fn(async () => ({
            text: "Human-readable wrapper",
            output,
            usage: usage(),
        }));
        const provider = new VercelAIEvalProvider("sk-test", {
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
        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                output: expect.objectContaining({ name: "object" }),
            }),
        );
    });

    it("passes system prompts as instructions with timeout and retry settings", async () => {
        const generateText = vi.fn(async () => ({
            text: "hello",
            output: "hello",
            usage: usage(),
        }));
        const provider = new VercelAIEvalProvider("sk-test", {
            generateText,
            modelFor,
        });

        await provider.complete({
            model: "gpt-4o",
            system: "Answer tersely.",
            prompt: "Say hello.",
            maxTokens: 100,
        });

        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                instructions: "Answer tersely.",
                maxRetries: 2,
                timeout: 120_000,
                messages: [
                    {
                        role: "user",
                        content: [{ type: "text", text: "Say hello." }],
                    },
                ],
            }),
        );
    });

    it("passes image parts and reasoning effort through to AI SDK", async () => {
        const signal = new AbortController().signal;
        const generateText = vi.fn(async () => ({
            text: "done",
            output: "done",
            usage: usage(),
        }));
        const provider = new VercelAIEvalProvider("sk-test", {
            generateText,
            modelFor,
        });

        await provider.complete({
            model: "gpt-5.4-mini",
            prompt: "Describe this.",
            images: [{ mimeType: "image/png", base64Data: "abc123" }],
            maxTokens: 100,
            reasoningEffort: "low",
            signal,
        });

        expect(generateText).toHaveBeenCalledWith(
            expect.objectContaining({
                abortSignal: signal,
                temperature: undefined,
                providerOptions: { openai: { reasoningEffort: "low" } },
                messages: [
                    {
                        role: "user",
                        content: [
                            { type: "text", text: "Describe this." },
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

    it("wraps AI SDK request failures with provider context and cause", async () => {
        const cause = new Error("network down");
        const provider = new VercelAIEvalProvider("sk-test", {
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
            message: "Vercel AI SDK request failed for gpt-4o: network down",
            cause,
        });
    });

    it("maps structured output validation failures to schema violations", async () => {
        const provider = new VercelAIEvalProvider("sk-test", {
            generateText: vi.fn(async () => {
                throw new NoObjectGeneratedError({
                    message: "No object generated.",
                    text: "not json",
                    response: {
                        id: "resp-1",
                        modelId: "gpt-4o",
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
