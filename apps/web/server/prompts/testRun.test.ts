import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import type { CompletionRequest, CompletionResult } from "@mosaic/llm-core";
import {
    getEvalProvider,
    listAvailableModelMetadata,
    providerModeFromEnv,
} from "@mosaic/llm-core";
import * as promptPersistence from "./service";
import { runPromptTest } from "./testRun";

vi.mock("./service", () => ({
    recordPromptValidationAttempt: vi.fn(),
}));

vi.mock("@/server/secrets/resolveApiKeys", () => ({
    resolveApiKeys: vi.fn(async () => ({
        apiKeys: { openai: "test-key" },
        sttProviderKeys: { openai: "test-key" },
    })),
}));

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return {
        ...actual,
        getEvalProvider: vi.fn(),
        listAvailableModelMetadata: vi.fn(),
        providerModeFromEnv: vi.fn(() => "openai"),
    };
});

const mockListAvailableModelMetadata = vi.mocked(listAvailableModelMetadata);
const mockProviderModeFromEnv = vi.mocked(providerModeFromEnv);

const schema = {
    type: "object",
    additionalProperties: false,
    required: ["dish_name", "calories_estimate"],
    properties: {
        dish_name: { type: "string" },
        calories_estimate: { type: "number" },
    },
};

const prompt = "Extract food facts. Return JSON only.";

function completion(
    text: string,
    overrides: Partial<CompletionResult> = {},
): CompletionResult {
    return {
        text,
        usage: {
            promptTokens: 1000,
            completionTokens: 200,
            totalTokens: 1200,
            ...overrides.usage,
        },
        latencyMs: 88,
        ...overrides,
    };
}

function providerComplete(
    fn: (req: CompletionRequest) => Promise<CompletionResult>,
) {
    const complete = vi.fn(fn);
    vi.mocked(getEvalProvider).mockReturnValue({ complete });
    return complete;
}

describe("runPromptTest", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mockProviderModeFromEnv.mockReturnValue("openai");
    });

    it("returns valid output, usage including reasoning tokens, latency, and computed cost", async () => {
        const complete = providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}', {
                usage: {
                    promptTokens: 1000,
                    completionTokens: 200,
                    reasoningTokens: 42,
                    totalTokens: 1200,
                },
            }),
        );

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-5.5",
            reasoningEffort: "high",
            samples: [{ name: "pasta bowl", inputText: "tomato pasta" }],
            apiKeys: { openai: "key" },
        });

        expect(result.status).toBe("success");
        expect(result.reasoningEffort).toBe("high");
        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-5.5",
                reasoningEffort: "high",
                prompt: expect.stringContaining("tomato pasta"),
            }),
        );
        expect(result.results[0]).toMatchObject({
            sampleName: "pasta bowl",
            status: "success",
            parsedOutput: {
                dish_name: "pasta",
                calories_estimate: 520,
            },
            validation: { valid: true, errors: [] },
            usage: { reasoningTokens: 42 },
            latencyMs: 88,
            costSource: "computed",
        });
        expect(result.results[0].costUsd).toBeCloseTo(0.011);
    });

    it("computes cost from live Gateway pricing for non-OpenAI models", async () => {
        mockProviderModeFromEnv.mockReturnValue("gateway");
        mockListAvailableModelMetadata.mockResolvedValue([
            {
                id: "anthropic/claude-sonnet-4.5",
                pricing: {
                    promptPricePerToken: 3 / 1_000_000,
                    completionPricePerToken: 15 / 1_000_000,
                },
            },
        ]);
        providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}'),
        );

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "anthropic/claude-sonnet-4.5",
            samples: [{ name: "pasta bowl", inputText: "tomato pasta" }],
            apiKeys: { gateway: "vck-test-live" },
        });

        expect(result.results[0]).toMatchObject({
            status: "success",
            costSource: "computed",
        });
        expect(result.results[0].costUsd).toBeCloseTo(0.006);
    });

    it("forwards a transient image to the provider", async () => {
        const complete = providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}'),
        );
        const image = { mimeType: "image/png", base64Data: "Zm9v" };

        await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [{ name: "image only", inputText: "" }],
            image,
        });

        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({ images: [image] }),
        );
    });

    it("omits images when no image is provided", async () => {
        const complete = providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}'),
        );

        await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [{ name: "text", inputText: "pasta" }],
        });

        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({ images: undefined }),
        );
    });

    it("returns field-level validation errors for schema mismatches without throwing", async () => {
        providerComplete(async () => completion('{"dish_name":"pasta"}'));

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [{ name: "missing calories", inputText: "pasta" }],
        });

        expect(result.status).toBe("failed");
        expect(result.results[0].status).toBe("failed_validation");
        expect(result.results[0].validation).toMatchObject({
            valid: false,
            errors: [expect.objectContaining({ path: "$", code: "required" })],
        });
    });

    it("runs every saved sample and returns one row per input", async () => {
        providerComplete(async (req) =>
            completion(
                req.prompt.includes("salad")
                    ? '{"dish_name":"salad","calories_estimate":180}'
                    : '{"dish_name":"soup","calories_estimate":240}',
            ),
        );

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [
                { name: "salad", inputText: "green salad" },
                { name: "soup", inputText: "lentil soup" },
            ],
        });

        expect(result.results).toHaveLength(2);
        expect(result.results.map((row) => row.sampleName)).toEqual([
            "salad",
            "soup",
        ]);
        expect(result.results.every((row) => row.validation.valid)).toBe(true);
    });

    it("returns partial when one sample succeeds and another errors", async () => {
        let calls = 0;
        providerComplete(async () => {
            calls += 1;
            if (calls === 2) throw new Error("provider failed");
            return completion('{"dish_name":"salad","calories_estimate":180}');
        });

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [
                { name: "salad", inputText: "green salad" },
                { name: "soup", inputText: "lentil soup" },
            ],
        });

        expect(result.status).toBe("partial");
        expect(result.results.map((row) => row.status)).toEqual([
            "success",
            "provider_error",
        ]);
    });

    it("returns provider errors per input and does not persist validation attempts", async () => {
        providerComplete(async () => {
            throw new Error("provider timeout");
        });

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [{ name: "timeout sample", inputText: "pasta" }],
        });

        expect(result.status).toBe("failed");
        expect(result.results[0]).toMatchObject({
            status: "provider_error",
            error: "provider timeout",
            costSource: "unavailable",
        });
        expect(
            vi.mocked(promptPersistence.recordPromptValidationAttempt),
        ).not.toHaveBeenCalled();
    });

    it("omits reasoning effort for non-reasoning models", async () => {
        const complete = providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}'),
        );

        await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            reasoningEffort: "high",
            samples: [{ name: "pasta bowl", inputText: "tomato pasta" }],
        });

        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({
                model: "gpt-4o",
                reasoningEffort: undefined,
            }),
        );
    });

    it("uses the default reasoning effort for reasoning models when none is requested", async () => {
        const complete = providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}'),
        );

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-5.5",
            samples: [{ name: "pasta bowl", inputText: "tomato pasta" }],
        });

        expect(result.reasoningEffort).toBe("medium");
        expect(complete).toHaveBeenCalledWith(
            expect.objectContaining({
                reasoningEffort: "medium",
            }),
        );
    });

    it("returns cancelled without calling the provider when already aborted", async () => {
        const complete = providerComplete(async () =>
            completion('{"dish_name":"pasta","calories_estimate":520}'),
        );
        const controller = new AbortController();
        controller.abort();

        const result = await runPromptTest({
            prompt,
            schema,
            targetModelId: "gpt-4o",
            samples: [{ name: "pasta bowl", inputText: "tomato pasta" }],
            signal: controller.signal,
        });

        expect(result.status).toBe("failed");
        expect(result.results[0].status).toBe("cancelled");
        expect(complete).not.toHaveBeenCalled();
    });

    it("aborts the in-flight provider request when a prompt test times out", async () => {
        vi.useFakeTimers();
        try {
            let capturedSignal: AbortSignal | undefined;
            providerComplete(
                async (req) =>
                    new Promise<CompletionResult>((resolve, reject) => {
                        void resolve;
                        capturedSignal = req.signal;
                        req.signal?.addEventListener("abort", () => {
                            reject(
                                Object.assign(new Error("aborted"), {
                                    name: "AbortError",
                                }),
                            );
                        });
                    }),
            );

            const resultPromise = runPromptTest({
                prompt,
                schema,
                targetModelId: "gpt-4o",
                samples: [{ name: "slow", inputText: "slow meal" }],
                timeoutMs: 25,
            });

            await vi.advanceTimersByTimeAsync(25);
            const result = await resultPromise;

            expect(capturedSignal?.aborted).toBe(true);
            expect(result.status).toBe("failed");
            expect(result.results[0]).toMatchObject({
                status: "timeout",
                error: "Timed out",
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
