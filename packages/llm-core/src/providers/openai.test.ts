import { describe, expect, it, vi } from "vitest";
import { OpenAIEvalProvider } from "./openai.js";

function provider(
    transport: "openai" | "openrouter" = "openai",
    cacheStatus = "MISS",
    finishReason = "stop",
) {
    const response = {
        id: "gen-1",
        model: "openai/gpt-4o",
        provider: "openai",
        choices: [{ message: { content: "ok" }, finish_reason: finishReason }],
        usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
        },
    };
    const create = vi.fn((..._args: unknown[]) => {
        const request = Promise.resolve(response) as Promise<
            typeof response
        > & {
            withResponse(): Promise<{
                data: typeof response;
                response: Response;
            }>;
        };
        request.withResponse = async () => ({
            data: response,
            response: new Response(null, {
                headers: {
                    "X-OpenRouter-Cache-Status": cacheStatus,
                    "X-Generation-ID": "header-gen-1",
                },
            }),
        });
        return request;
    });
    const client = {
        chat: {
            completions: {
                create,
                parse: create,
            },
        },
    };
    return {
        create,
        provider: new OpenAIEvalProvider("secret", {
            transport,
            client: client as never,
        }),
    };
}

describe("OpenAI-compatible route forwarding", () => {
    it("forwards Gemini reasoning effort through OpenRouter", async () => {
        const harness = provider("openrouter");
        await harness.provider.complete({
            model: "google/gemini-3.8-flash",
            prompt: "Extract the receipt",
            maxTokens: 1024,
            reasoningEffort: "low",
        });
        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            reasoning: { effort: "low" },
        });
    });
    it("rejects text cut off by the output token limit", async () => {
        const harness = provider("openrouter", "MISS", "length");
        await expect(
            harness.provider.complete({
                model: "google/gemini-3.8-flash",
                prompt: "Write a rubric",
                maxTokens: 32,
            }),
        ).rejects.toThrow("output token limit");
    });
    it("preserves legacy retries by default and honors explicit zero", async () => {
        const harness = provider();
        const request = {
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
        };

        await harness.provider.complete(request);
        await harness.provider.complete({ ...request, maxRetries: 0 });

        expect(harness.create.mock.calls[0]?.[1]).toMatchObject({
            maxRetries: 2,
        });
        expect(harness.create.mock.calls[1]?.[1]).toMatchObject({
            maxRetries: 0,
        });
    });

    it("omits timeout when the caller does not specify one", async () => {
        const harness = provider();

        await harness.provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
        });

        expect(harness.create.mock.calls[0]?.[1]).not.toHaveProperty("timeout");
    });

    it("forwards the captured structured-output strict setting", async () => {
        const harness = provider();

        await harness.provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            responseSchema: {
                name: "answer",
                schema: { type: "object" },
                strict: false,
            },
        });

        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            response_format: {
                json_schema: {
                    name: "answer",
                    schema: { type: "object" },
                    strict: false,
                },
            },
        });
    });

    it("forwards exact OpenRouter provider policy and disables response cache", async () => {
        const harness = provider("openrouter");

        await harness.provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            route: {
                transport: "openrouter",
                transportModelId: "openai/gpt-4o",
                upstreamPolicy: {
                    mode: "exact",
                    only: ["openai"],
                },
                requireParameters: true,
            },
            cachePolicy: {
                providerCaching: "allow",
                responseCache: "disable",
            },
        });

        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            provider: {
                only: ["openai"],
                allow_fallbacks: false,
                require_parameters: true,
            },
        });
        expect(harness.create.mock.calls[0]?.[1]).toMatchObject({
            headers: { "X-OpenRouter-Cache": "false" },
        });
    });

    it("forwards ordered OpenRouter preference and explicit fallback policy", async () => {
        const harness = provider("openrouter");

        await harness.provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            route: {
                transport: "openrouter",
                transportModelId: "openai/gpt-4o",
                upstreamPolicy: {
                    mode: "preference",
                    order: ["azure", "openai"],
                    allowFallbacks: false,
                },
                requireParameters: false,
            },
            cachePolicy: {
                providerCaching: "allow",
                responseCache: "allow",
            },
        });

        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            provider: {
                order: ["azure", "openai"],
                allow_fallbacks: false,
                require_parameters: false,
            },
        });
        expect(harness.create.mock.calls[0]?.[1]).toMatchObject({
            headers: { "X-OpenRouter-Cache": "true" },
        });
    });

    it.each([
        ["HIT", true],
        ["MISS", false],
    ])("records OpenRouter response-cache header %s", async (status, hit) => {
        const harness = provider("openrouter", status);

        const result = await harness.provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            cachePolicy: {
                providerCaching: "allow",
                responseCache: "allow",
            },
        });

        expect(result.cache).toEqual({
            status: "provider_cache",
            kind: "response",
            hit,
        });
        if (hit) {
            expect(result.actualRoute).toEqual({
                status: "not_invoked",
                generationId: "header-gen-1",
                evidenceCompleteness: "complete",
            });
        } else {
            expect(result.actualRoute).toMatchObject({
                status: "resolved",
                modelId: "openai/gpt-4o",
                upstreamProvider: "openai",
                generationId: "header-gen-1",
            });
        }
    });
});
