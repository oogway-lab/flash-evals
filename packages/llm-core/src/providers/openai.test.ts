import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    bifrostModelListKey,
    installBifrostModelInfo,
    resetBifrostModelInfo,
} from "./bifrostModelInfo.js";
import { OpenAIEvalProvider } from "./openai.js";

function provider(
    transport: "openai" | "openrouter" | "bifrost" = "openai",
    cacheStatus = "MISS",
    finishReason = "stop",
    usageExtras: Record<string, unknown> = {},
    providerField: string | null = "openai",
) {
    const response = {
        id: "gen-1",
        model: "openai/gpt-4o",
        provider: providerField ?? undefined,
        choices: [{ message: { content: "ok" }, finish_reason: finishReason }],
        usage: {
            prompt_tokens: 1,
            completion_tokens: 1,
            total_tokens: 2,
            ...usageExtras,
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
    it.each(["google/gemini-3.8-flash", "google/gemini-3.5-flash-lite"])(
        "leaves text thinking at the provider default for %s",
        async (model) => {
            const harness = provider("openrouter");
            await harness.provider.complete({
                model,
                prompt: "Translate",
                maxTokens: 4096,
            });
            expect(harness.create.mock.calls[0]?.[0]).not.toHaveProperty(
                "reasoning",
            );
        },
    );
    it("preserves an explicitly chosen Gemini reasoning effort", async () => {
        const harness = provider("openrouter");
        await harness.provider.complete({
            model: "google/gemini-3.8-flash",
            prompt: "Extract the receipt",
            maxTokens: 1024,
            reasoningEffort: "high",
        });
        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            reasoning: { effort: "high" },
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

    it("sends data rules to OpenRouter and records the host that served it", async () => {
        const harness = provider("openrouter");
        const result = await harness.provider.complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            dataPolicy: {
                onlyHosts: ["google-vertex"],
                zeroDataRetention: true,
                disallowPromptTraining: true,
            },
        });
        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            provider: {
                only: ["google-vertex"],
                allow_fallbacks: false,
                zdr: true,
                data_collection: "deny",
            },
        });
        expect(result.providerMetadata).toEqual({ servedBy: "openai" });
    });

    it("refuses data rules on transports that can't route between hosts", async () => {
        const harness = provider("openai");
        await expect(
            harness.provider.complete({
                model: "gpt-4o",
                prompt: "hi",
                maxTokens: 10,
                dataPolicy: { zeroDataRetention: true },
            }),
        ).rejects.toThrow(/can't limit which hosting companies/);
        expect(harness.create).not.toHaveBeenCalled();
    });

    it("sends OpenRouter's provider settings through Bifrost for a model it forwards to OpenRouter", async () => {
        const harness = provider(
            "bifrost",
            "MISS",
            "stop",
            {},
            "google-vertex",
        );
        const result = await harness.provider.complete({
            model: "openrouter/google/gemini-2.5-flash",
            prompt: "hi",
            maxTokens: 10,
            dataPolicy: {
                onlyHosts: ["google-vertex"],
                zeroDataRetention: true,
                disallowPromptTraining: true,
            },
        });
        const [body, options] = harness.create.mock.calls[0] as [
            Record<string, unknown>,
            { headers?: Record<string, string> },
        ];
        expect(body).toMatchObject({
            model: "openrouter/google/gemini-2.5-flash",
            provider: {
                only: ["google-vertex"],
                allow_fallbacks: false,
                zdr: true,
                data_collection: "deny",
            },
        });
        expect(options.headers).toEqual({
            "x-bf-passthrough-extra-params": "true",
        });
        expect(result.providerMetadata).toEqual({ servedBy: "google-vertex" });
    });

    it("sends Bifrost no provider settings without data rules", async () => {
        const harness = provider("bifrost");
        await harness.provider.complete({
            model: "openrouter/google/gemini-2.5-flash",
            prompt: "hi",
            maxTokens: 10,
        });
        const [body, options] = harness.create.mock.calls[0] as [
            Record<string, unknown>,
            { headers?: Record<string, string> },
        ];
        expect(body).not.toHaveProperty("provider");
        expect(options.headers).toBeUndefined();
    });

    it("refuses data rules for a Bifrost model that doesn't go through OpenRouter", async () => {
        const harness = provider("bifrost");
        await expect(
            harness.provider.complete({
                model: "gemini/gemini-2.5-flash",
                prompt: "hi",
                maxTokens: 10,
                dataPolicy: { onlyHosts: ["google-vertex"] },
            }),
        ).rejects.toThrow(
            "Bifrost sends gemini/gemini-2.5-flash to gemini, not OpenRouter",
        );
        expect(harness.create).not.toHaveBeenCalled();
    });

    it("records no host through Bifrost when the response names none, or only Bifrost's upstream", async () => {
        for (const field of [null, "openrouter"]) {
            const harness = provider("bifrost", "MISS", "stop", {}, field);
            const result = await harness.provider.complete({
                model: "openrouter/google/gemini-2.5-flash",
                prompt: "hi",
                maxTokens: 10,
            });
            expect(result.providerMetadata).toBeUndefined();
            expect(result.actualRoute).toMatchObject({
                status: "unresolved",
                transport: "bifrost",
            });
        }
    });

    it("keeps a cost Bifrost passes through, else leaves it to list prices", async () => {
        const reported = provider("bifrost", "MISS", "stop", { cost: 0.0004 });
        expect(
            (
                await reported.provider.complete({
                    model: "openrouter/google/gemini-2.5-flash",
                    prompt: "hi",
                    maxTokens: 10,
                })
            ).cost,
        ).toEqual({ usd: 0.0004, source: "provider_reported" });
        const unreported = provider("bifrost");
        expect(
            (
                await unreported.provider.complete({
                    model: "openrouter/google/gemini-2.5-flash",
                    prompt: "hi",
                    maxTokens: 10,
                })
            ).cost,
        ).toBeUndefined();
    });

    it("prices an unreported Bifrost cost at Bifrost's list price, and prefers a reported one", async () => {
        installBifrostModelInfo(bifrostModelListKey(undefined, "secret"), [
            {
                id: "openrouter/z-ai/glm-5.2",
                pricing: {
                    promptPricePerToken: 0.000001,
                    completionPricePerToken: 0.000003,
                },
            },
        ]);
        try {
            const request = {
                model: "openrouter/z-ai/glm-5.2",
                prompt: "hi",
                maxTokens: 10,
            };
            const unreported =
                await provider("bifrost").provider.complete(request);
            expect(unreported.cost?.source).toBe("bifrost_list_price");
            expect(unreported.cost?.usd).toBeCloseTo(0.000004, 12);
            const reported = await provider("bifrost", "MISS", "stop", {
                cost: 0.0004,
            }).provider.complete(request);
            expect(reported.cost).toEqual({
                usd: 0.0004,
                source: "provider_reported",
            });
            // Only Bifrost calls use Bifrost's list.
            const direct =
                await provider("openrouter").provider.complete(request);
            expect(direct.cost).toBeUndefined();
        } finally {
            resetBifrostModelInfo();
        }
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

describe("OpenRouter reported charges", () => {
    async function reportedCost(usage: Record<string, unknown>) {
        const harness = provider("openrouter", "MISS", "stop", usage);
        const result = await harness.provider.complete({
            model: "google/gemini-2.5-flash",
            prompt: "hi",
            maxTokens: 10,
        });
        return result.cost;
    }

    it("preserves OpenRouter reported charges", async () => {
        expect(await reportedCost({ cost: 0.000042 })).toEqual({
            usd: 0.000042,
            source: "provider_reported",
        });
    });

    it("adds the upstream charge for BYOK requests", async () => {
        expect(
            await reportedCost({
                cost: 0.00001,
                is_byok: true,
                cost_details: { upstream_inference_cost: 0.002 },
            }),
        ).toEqual({
            usd: expect.closeTo(0.00201, 10),
            source: "provider_reported",
        });
    });

    it("falls back to catalog pricing when the BYOK upstream charge is unknown", async () => {
        expect(await reportedCost({ cost: 0, is_byok: true })).toBeUndefined();
    });
});

describe("OpenAI-compatible attribution headers", () => {
    beforeEach(() => {
        vi.stubEnv("FLASH_EVALS_GATEWAY_HTTP_REFERER", "");
        vi.stubEnv("FLASH_EVALS_GATEWAY_APP_TITLE", "");
        vi.stubEnv("FLASH_EVALS_PROVIDER_ATTRIBUTION", "");
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            id: "gen-1",
                            model: "gpt-4o",
                            choices: [
                                {
                                    finish_reason: "stop",
                                    message: { content: "ok" },
                                },
                            ],
                        }),
                        { headers: { "Content-Type": "application/json" } },
                    ),
            ),
        );
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.unstubAllGlobals();
    });

    async function sentHeaders(options: {
        baseURL?: string;
        transport?: "openai" | "openrouter" | "bifrost";
    }) {
        await new OpenAIEvalProvider("secret", options).complete({
            model: "gpt-4o",
            prompt: "hi",
            maxTokens: 10,
            maxRetries: 0,
        });
        const [, init] = vi.mocked(fetch).mock.calls[0]!;
        return new Headers(init?.headers);
    }

    it("attributes OpenRouter requests to Flash Evals", async () => {
        const headers = await sentHeaders({
            baseURL: "https://openrouter.ai/api/v1",
            transport: "openrouter",
        });
        expect(headers.get("http-referer")).toBe("https://flashevals.dev");
        expect(headers.get("x-title")).toBe("Flash Evals");
    });

    it.each([
        { transport: "openai" as const },
        {
            baseURL: "https://or-proxy.example.com/api/v1",
            transport: "openrouter" as const,
        },
        {
            baseURL: "https://bifrost.example.com/v1",
            transport: "bifrost" as const,
        },
    ])("sends no attribution to $transport at $baseURL", async (options) => {
        const headers = await sentHeaders(options);
        expect(headers.has("http-referer")).toBe(false);
        expect(headers.has("x-title")).toBe(false);
    });
});
