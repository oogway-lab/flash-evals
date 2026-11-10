import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@flash-evals/llm-core";
import type {
    CompletionRequest,
    CompletionResult,
} from "@flash-evals/llm-core";
import { getEvalProvider } from "@flash-evals/llm-core";
import { cellProviderMetadata, executeCell } from "./runOrchestrator";

vi.mock("@flash-evals/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(),
    };
});

function completion(): CompletionResult {
    return {
        text: '{"answer":"yes"}',
        parsed: { answer: "yes" },
        usage: {
            promptTokens: 10,
            completionTokens: 5,
            totalTokens: 15,
        },
        latencyMs: 25,
        providerMetadata: {
            gateway: { generationId: "gen_123" },
        },
    };
}

function providerComplete() {
    const complete = vi.fn(async (_req: CompletionRequest) => completion());
    vi.mocked(getEvalProvider).mockReturnValue({ complete });
    return complete;
}

describe("executeCell", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("passes a run-model reasoning effort through to the provider request", async () => {
        const complete = providerComplete();

        await executeCell(
            "openai::gpt-5.5",
            {
                prompt: "Return JSON.",
                maxTokens: 500,
                reasoningEffort: "high",
            },
            { openai: "test-key" },
            {
                promptPricePerToken: 0.001,
                completionPricePerToken: 0.002,
            },
        );

        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-5.5",
                reasoningEffort: "high",
            }),
        );
    });

    it("constructs the provider with the selected OpenRouter transport", async () => {
        providerComplete();
        await executeCell(
            "gpt-4o",
            { prompt: "Return JSON.", maxTokens: 500 },
            { openrouter: "test-openrouter-key" },
            undefined,
            "openrouter",
        );
        expect(getEvalProvider).toHaveBeenCalledWith(
            expect.objectContaining({ openrouter: "test-openrouter-key" }),
            { transport: "openrouter" },
        );
    });

    it("freezes a provider-listed model ID for an explicit Gateway transport", async () => {
        providerComplete();

        await executeCell(
            "zai/glm-5.1",
            { prompt: "Return JSON.", maxTokens: 500 },
            { gateway: "test-gateway-key" },
            undefined,
            "gateway",
        );

        expect(getEvalProvider).toHaveBeenCalledWith(
            expect.objectContaining({ gateway: "test-gateway-key" }),
            {
                transport: "gateway",
                exactTransportModelId: "zai/glm-5.1",
            },
        );
    });

    it("sends the gateway's own id for a model listed under another provider's id", async () => {
        providerComplete();

        // OpenRouter's id; Vercel AI Gateway calls the same model "zai/glm-5.2".
        await executeCell(
            "z-ai/glm-5.2",
            { prompt: "Return JSON.", maxTokens: 500 },
            { gateway: "test-gateway-key" },
            undefined,
            "gateway",
        );

        expect(getEvalProvider).toHaveBeenCalledWith(
            expect.objectContaining({ gateway: "test-gateway-key" }),
            {
                transport: "gateway",
                exactTransportModelId: "zai/glm-5.2",
            },
        );
    });

    it("omits reasoning effort when the run-model request has none", async () => {
        const complete = providerComplete();

        await executeCell(
            "gpt-4o",
            {
                prompt: "Return JSON.",
                maxTokens: 500,
            },
            { openai: "test-key" },
            undefined,
        );

        expect(complete).toHaveBeenCalledWith(
            expect.not.objectContaining({
                reasoningEffort: expect.anything(),
            }),
        );
    });

    it("returns provider metadata from the completion result", async () => {
        providerComplete();

        const result = await executeCell(
            "gpt-4o",
            {
                prompt: "Return JSON.",
                maxTokens: 500,
            },
            { openai: "test-key" },
            undefined,
        );

        expect(result.providerMetadata).toEqual({
            gateway: { generationId: "gen_123" },
        });
    });

    it("keeps a Bifrost call's thinking outcome and thinking tokens", async () => {
        const thinking = {
            requested: "medium" as const,
            sent: true,
            via: "reasoning.effort=medium (passed to OpenRouter)",
        };
        vi.mocked(getEvalProvider).mockReturnValue({
            complete: vi.fn(async () => ({
                ...completion(),
                providerMetadata: undefined,
                usage: {
                    promptTokens: 10,
                    completionTokens: 50,
                    reasoningTokens: 40,
                },
                thinking,
            })),
        });

        const result = await executeCell(
            "openrouter/acme/thinker-1",
            {
                prompt: "Return JSON.",
                maxTokens: 500,
                reasoningEffort: "medium",
            },
            { bifrost: "key", bifrostBaseUrl: "https://gateway.example.test" },
            undefined,
            "bifrost",
        );

        expect(result.providerMetadata).toEqual({
            thinking,
            reasoningTokens: 40,
        });
    });
});

describe("cellProviderMetadata", () => {
    it("records a level that wasn't sent, and why", () => {
        expect(
            cellProviderMetadata(
                {
                    usage: {},
                    thinking: {
                        requested: "high",
                        sent: false,
                        reason: "No thinking setting for this route.",
                    },
                },
                "registry_list_price",
            ),
        ).toEqual({
            thinking: {
                requested: "high",
                sent: false,
                reason: "No thinking setting for this route.",
            },
            costBasis: "registry_list_price",
        });
        expect(cellProviderMetadata({ usage: {} }, undefined)).toBeUndefined();
    });
});

it("records the provider charge without catalog pricing", async () => {
    const result = {
        ...completion(),
        cost: { usd: 0.000042, source: "provider_reported" as const },
    };
    vi.mocked(getEvalProvider).mockReturnValue({
        complete: vi.fn(async () => result),
    });
    const cell = await executeCell(
        "google/gemini-2.5-flash",
        { prompt: "Classify", maxTokens: 50 },
        { openrouter: "test" },
        undefined,
        "openrouter",
    );
    expect(cell.costUsd).toBe(0.000042);
});
