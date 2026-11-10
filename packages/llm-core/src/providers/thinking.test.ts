import { beforeEach, describe, expect, it, vi } from "vitest";
import { registryEntryFor } from "../models/registry.js";
import { resetBifrostModelInfo } from "./bifrostModelInfo.js";
import { GatewayEvalProvider } from "./gateway.js";
import { OpenAIEvalProvider } from "./openai.js";
import { rejectsSamplingSettings, thinkingPlanFor } from "./thinking.js";
import { VercelAIEvalProvider } from "./vercelAi.js";
import type { CompletionTransport, ReasoningEffort } from "../types.js";

const usage = {
    inputTokens: 1,
    outputTokens: 5,
    totalTokens: 6,
    inputTokenDetails: {},
    outputTokenDetails: { reasoningTokens: 4 },
};

function gateway() {
    const generate = vi.fn().mockResolvedValue({
        text: "ok",
        output: undefined,
        usage,
    });
    return {
        generate,
        provider: new GatewayEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
        }),
    };
}

function openAICompatible(
    transport: CompletionTransport,
    listed?: readonly Record<string, unknown>[],
) {
    const response = {
        id: "gen-1",
        model: "m",
        choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
        usage: {
            prompt_tokens: 1,
            completion_tokens: 5,
            total_tokens: 6,
            completion_tokens_details: { reasoning_tokens: 4 },
        },
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
    return {
        create,
        provider: new OpenAIEvalProvider("secret", {
            transport,
            client: {
                chat: { completions: { create, parse: create } },
                ...(listed
                    ? {
                          models: {
                              list: async function* () {
                                  yield* listed;
                              },
                          },
                      }
                    : {}),
            } as never,
        }),
    };
}

async function gatewayCall(model: string, level: ReasoningEffort) {
    const harness = gateway();
    const result = await harness.provider.complete({
        model,
        prompt: "hi",
        maxTokens: 100,
        reasoningEffort: level,
    });
    return { body: harness.generate.mock.calls[0]?.[0], result };
}

describe("thinking on Vercel AI Gateway", () => {
    it("sends OpenAI's reasoningEffort, including gpt-6-luna", async () => {
        for (const model of ["gpt-6-luna", "gpt-5.5"]) {
            const { body, result } = await gatewayCall(model, "high");
            expect(body.providerOptions).toEqual({
                openai: { reasoningEffort: "high" },
            });
            expect(body).not.toHaveProperty("reasoning");
            expect(result.thinking).toEqual({
                requested: "high",
                sent: true,
                via: "openai.reasoningEffort=high",
            });
            expect(result.usage.reasoningTokens).toBe(4);
        }
    });

    it("turns OpenAI thinking off with none", async () => {
        const { body } = await gatewayCall("gpt-5.5", "none");
        expect(body.providerOptions).toEqual({
            openai: { reasoningEffort: "none" },
        });
    });

    it("sends Claude adaptive thinking with an effort", async () => {
        const { body } = await gatewayCall(
            "anthropic/claude-opus-5.5",
            "xhigh",
        );
        expect(body.providerOptions).toEqual({
            anthropic: { thinking: { type: "adaptive" }, effort: "xhigh" },
        });
    });

    it("turns Claude thinking off with none", async () => {
        const { body } = await gatewayCall(
            "anthropic/claude-sonnet-4.6",
            "none",
        );
        expect(body.providerOptions).toEqual({
            anthropic: { thinking: { type: "disabled" } },
        });
    });

    it("sends Gemini 3 a thinkingLevel", async () => {
        const { body } = await gatewayCall(
            "google/gemini-3.5-flash-lite",
            "high",
        );
        expect(body.providerOptions).toEqual({
            google: { thinkingConfig: { thinkingLevel: "high" } },
        });
    });

    it("sends DeepSeek the portable reasoning setting", async () => {
        const { body, result } = await gatewayCall(
            "deepseek/deepseek-v3.2",
            "medium",
        );
        expect(body.reasoning).toBe("medium");
        expect(body.providerOptions).toBeUndefined();
        expect(result.thinking?.sent).toBe(true);
    });

    it("keeps thinking options beside the data rules", async () => {
        const harness = gateway();
        await harness.provider.complete({
            model: "anthropic/claude-opus-5.5",
            prompt: "hi",
            maxTokens: 100,
            reasoningEffort: "low",
            dataPolicy: { zeroDataRetention: true },
        });
        expect(harness.generate.mock.calls[0]?.[0].providerOptions).toEqual({
            anthropic: { thinking: { type: "adaptive" }, effort: "low" },
            gateway: { zeroDataRetention: true },
        });
    });

    it("records, not drops, a level the model doesn't list", async () => {
        const { body, result } = await gatewayCall(
            "anthropic/claude-opus-5.5",
            "none",
        );
        expect(body.providerOptions).toBeUndefined();
        expect(body).not.toHaveProperty("reasoning");
        expect(result.thinking).toMatchObject({
            requested: "none",
            sent: false,
        });
        expect(result.thinking?.reason).toContain("low, medium, high, xhigh");
    });

    it.each([
        ["google/gemma-4-31b-it", "Gemma"],
        ["zai/glm-5.2", "zai"],
        ["minimax/minimax-m3", "minimax"],
    ])(
        "warns that %s thinking is not sent: Vercel documents no option",
        async (model, maker) => {
            const { body, result } = await gatewayCall(model, "low");
            expect(body.providerOptions).toBeUndefined();
            expect(body).not.toHaveProperty("reasoning");
            expect(result.thinking).toMatchObject({
                requested: "low",
                sent: false,
            });
            expect(result.thinking?.reason).toContain(
                `documents no thinking setting for ${maker}`,
            );
        },
    );

    it("sends Gemini 3 Flash its thinkingLevel, minimal included", async () => {
        const { body, result } = await gatewayCall(
            "google/gemini-3-flash",
            "minimal",
        );
        expect(body.providerOptions).toEqual({
            google: { thinkingConfig: { thinkingLevel: "minimal" } },
        });
        expect(result.thinking?.sent).toBe(true);
    });

    it("sends nothing and records nothing without a requested level", async () => {
        const harness = gateway();
        const result = await harness.provider.complete({
            model: "anthropic/claude-opus-5.5",
            prompt: "hi",
            maxTokens: 100,
        });
        expect(
            harness.generate.mock.calls[0]?.[0].providerOptions,
        ).toBeUndefined();
        expect(result.thinking).toBeUndefined();
    });
});

describe("thinking on OpenAI-compatible routes", () => {
    it("sends OpenRouter's reasoning.effort for any maker", async () => {
        const harness = openAICompatible("openrouter");
        const result = await harness.provider.complete({
            model: "anthropic/claude-sonnet-4.6",
            prompt: "hi",
            maxTokens: 100,
            reasoningEffort: "none",
        });
        expect(harness.create.mock.calls[0]?.[0]).toMatchObject({
            reasoning: { effort: "none" },
        });
        expect(harness.create.mock.calls[0]?.[0]).not.toHaveProperty(
            "reasoning_effort",
        );
        expect(result.thinking).toMatchObject({ sent: true });
        expect(result.usage.reasoningTokens).toBe(4);
    });

    it("passes OpenRouter's reasoning through Bifrost for openrouter/ ids", async () => {
        const harness = openAICompatible("bifrost");
        await harness.provider.complete({
            model: "openrouter/google/gemini-3.5-flash-lite",
            prompt: "hi",
            maxTokens: 100,
            reasoningEffort: "low",
        });
        const [body, options] = harness.create.mock.calls[0] as [
            Record<string, unknown>,
            { headers?: Record<string, string> },
        ];
        expect(body.reasoning).toEqual({ effort: "low" });
        expect(options.headers).toEqual({
            "x-bf-passthrough-extra-params": "true",
        });
    });

    it("records a Bifrost upstream with no thinking setting as not sent", async () => {
        const harness = openAICompatible("bifrost");
        const result = await harness.provider.complete({
            model: "gemini/gemini-3.5-flash-lite",
            prompt: "hi",
            maxTokens: 100,
            reasoningEffort: "low",
        });
        expect(harness.create.mock.calls[0]?.[0]).not.toHaveProperty(
            "reasoning",
        );
        expect(result.thinking?.sent).toBe(false);
    });

    it("sends OpenAI's reasoning_effort and no temperature", async () => {
        const harness = openAICompatible("openai");
        await harness.provider.complete({
            model: "gpt-6-luna",
            prompt: "hi",
            maxTokens: 100,
            temperature: 0.2,
            reasoningEffort: "medium",
        });
        const body = harness.create.mock.calls[0]?.[0] as Record<
            string,
            unknown
        >;
        expect(body.reasoning_effort).toBe("medium");
        expect(body.temperature).toBeUndefined();
    });
});

describe("thinking on Bifrost openrouter/ ids", () => {
    beforeEach(() => resetBifrostModelInfo());

    async function bifrostCall(
        model: string,
        level: ReasoningEffort | undefined,
        listed?: readonly Record<string, unknown>[],
        maxTokens = 100,
    ) {
        const harness = openAICompatible("bifrost", listed);
        const result = await harness.provider.complete({
            model,
            prompt: "hi",
            maxTokens,
            ...(level ? { reasoningEffort: level } : {}),
        });
        const [body, options] = harness.create.mock.calls[0] as [
            Record<string, unknown>,
            { headers?: Record<string, string> },
        ];
        return { body, options, result };
    }

    it.each(["openrouter/z-ai/glm-5.2", "openrouter/minimax/minimax-m3"])(
        "sends %s OpenRouter's reasoning.effort",
        async (model) => {
            const { body, options, result } = await bifrostCall(model, "low");
            expect(body.reasoning).toEqual({ effort: "low" });
            expect(options.headers).toEqual({
                "x-bf-passthrough-extra-params": "true",
            });
            expect(result.thinking).toMatchObject({ sent: true });
        },
    );

    it("turns Gemma thinking off with none", async () => {
        const { body, result } = await bifrostCall(
            "openrouter/google/gemma-4-31b-it",
            "none",
        );
        expect(body.reasoning).toEqual({ effort: "none" });
        expect(result.thinking).toMatchObject({ sent: true });
    });

    it("lets the model list's reasoning decide for a model the registry doesn't know", async () => {
        const listed = [
            {
                id: "openrouter/acme/thinker-1",
                supported_parameters: ["reasoning", "reasoning_effort"],
            },
            {
                id: "openrouter/acme/toggle-1",
                supported_parameters: ["reasoning"],
            },
        ];
        const effort = await bifrostCall(
            "openrouter/acme/thinker-1",
            "xhigh",
            listed,
        );
        expect(effort.body.reasoning).toEqual({ effort: "xhigh" });
        const toggle = await bifrostCall(
            "openrouter/acme/toggle-1",
            "xhigh",
            listed,
        );
        expect(toggle.body).not.toHaveProperty("reasoning");
        expect(toggle.result.thinking?.reason).toContain(
            "none, low, medium, high",
        );
    });

    it("sends no thinking when the model list says the model takes none", async () => {
        const { body, result } = await bifrostCall(
            "openrouter/z-ai/glm-5.2",
            "low",
            [
                {
                    id: "openrouter/z-ai/glm-5.2",
                    supported_parameters: ["temperature"],
                },
            ],
        );
        expect(body).not.toHaveProperty("reasoning");
        expect(result.thinking).toMatchObject({ sent: false });
        expect(result.thinking?.reason).toContain("Bifrost's model list");
    });

    it("falls back to the registry when the model list can't be fetched", async () => {
        const { body } = await bifrostCall("openrouter/z-ai/glm-5.2", "high");
        expect(body.reasoning).toEqual({ effort: "high" });
    });

    it("warns when the output limit is more than the model can give", async () => {
        const listed = [
            { id: "openrouter/acme/short-1", max_output_tokens: 8192 },
        ];
        const over = await bifrostCall(
            "openrouter/acme/short-1",
            undefined,
            listed,
            16_384,
        );
        expect(over.result.warnings?.[0]).toContain("8,192 tokens");
        const within = await bifrostCall(
            "openrouter/acme/short-1",
            undefined,
            listed,
            8192,
        );
        expect(within.result.warnings).toBeUndefined();
    });
});

describe("thinking on a maker's own API", () => {
    it("passes the shared reasoning level to Anthropic", async () => {
        const generate = vi.fn().mockResolvedValue({
            text: "ok",
            output: undefined,
            usage,
        });
        const provider = new VercelAIEvalProvider("secret", {
            generateText: generate,
            modelFor: () => ({}) as never,
            directMaker: "anthropic",
        });
        const result = await provider.complete({
            model: "claude-sonnet-4-6",
            prompt: "hi",
            maxTokens: 100,
            reasoningEffort: "medium",
        });
        expect(generate.mock.calls[0]?.[0].reasoning).toBe("medium");
        expect(result.thinking).toEqual({
            requested: "medium",
            sent: true,
            via: "reasoning=medium",
        });
    });
});

describe("thinkingPlanFor", () => {
    it("gives Gemini 2.5 a thinking budget, and 0 to turn it off", () => {
        const model = "google/gemini-2.5-flash-batch";
        expect(
            thinkingPlanFor(model, "gateway", "low")?.providerOptions,
        ).toEqual({ google: { thinkingConfig: { thinkingBudget: 1024 } } });
        expect(
            thinkingPlanFor(model, "gateway", "none")?.providerOptions,
        ).toEqual({ google: { thinkingConfig: { thinkingBudget: 0 } } });
    });

    it("leaves models the static registry pins as non-thinking alone", () => {
        expect(
            thinkingPlanFor("google/gemini-2.5-flash", "gateway", "low")
                ?.outcome.sent,
        ).toBe(false);
    });

    it("never sends Gemma a thinking option on the Gemini API", () => {
        expect(
            thinkingPlanFor("gemma-4-31b-it", "google", "low")?.outcome.sent,
        ).toBe(false);
    });

    it("never sends Gemma a thinking option on the gateway", () => {
        expect(
            thinkingPlanFor("google/gemma-4-31b-it", "gateway", "low")?.outcome
                .sent,
        ).toBe(false);
    });

    it("knows which models refuse temperature", () => {
        expect(rejectsSamplingSettings("gpt-6-luna")).toBe(true);
        expect(rejectsSamplingSettings("openai/gpt-5.5")).toBe(true);
        expect(rejectsSamplingSettings("gpt-4o")).toBe(false);
        // A Bifrost id is its registry model.
        expect(rejectsSamplingSettings("openrouter/openai/gpt-6-luna")).toBe(
            true,
        );
        expect(rejectsSamplingSettings("openrouter/openai/gpt-4o")).toBe(false);
        // Claude 5.x and Opus 4.7+ refuse sampling settings on every route
        // (@ai-sdk/anthropic's rejectsSamplingParameters).
        for (const model of [
            "anthropic/claude-opus-5.5",
            "anthropic/claude-sonnet-5.5",
            "claude-haiku-5-5",
            "anthropic/claude-fable-5.1",
            "openrouter/anthropic/claude-opus-4.8",
            "anthropic/claude-opus-5-fast",
        ])
            expect(rejectsSamplingSettings(model), model).toBe(true);
        for (const model of [
            "anthropic/claude-sonnet-4.6",
            "claude-opus-4-6",
            "anthropic/claude-haiku-4.5",
        ])
            expect(rejectsSamplingSettings(model), model).toBe(false);
    });

    it("never sends thinking off to a Claude model that can't turn it off", () => {
        for (const model of [
            "anthropic/claude-fable-5",
            "anthropic/claude-fable-5.1",
            "anthropic/claude-sonnet-5.5",
        ]) {
            const plan = thinkingPlanFor(model, "gateway", "none");
            expect(plan?.outcome.sent, model).toBe(false);
            expect(plan?.providerOptions).toBeUndefined();
        }
        expect(
            thinkingPlanFor("anthropic/claude-sonnet-4.6", "gateway", "none")
                ?.outcome.sent,
        ).toBe(true);
        // Nor is "none" offered for them.
        for (const model of [
            "anthropic/claude-fable-5",
            "anthropic/claude-fable-5.1",
        ])
            expect(
                registryEntryFor(model)?.reasoningEffort?.supportedLevels,
                model,
            ).not.toContain("none");
    });
});
