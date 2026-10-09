import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import type { CompletionRequest, CompletionResult } from "@mosaic/llm-core";
import { getEvalProvider } from "@mosaic/llm-core";
import { executeCell } from "./runOrchestrator";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(),
        computeCostFromUsageWithPricing: vi.fn(() => 0.01),
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
});
