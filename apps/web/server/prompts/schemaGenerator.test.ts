import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import type { CompletionRequest, CompletionResult } from "@mosaic/llm-core";
import { getEvalProvider } from "@mosaic/llm-core";
import { generateSchemaFromPrompt } from "./schemaGenerator";

vi.mock("@mosaic/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return { ...actual, getEvalProvider: vi.fn() };
});

function providerReturns(text: string) {
    const complete = vi.fn(
        async (_req: CompletionRequest): Promise<CompletionResult> => ({
            text,
            usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
            latencyMs: 5,
        }),
    );
    vi.mocked(getEvalProvider).mockReturnValue({ complete });
    return complete;
}

const COMPAT_SCHEMA = JSON.stringify({
    type: "object",
    additionalProperties: false,
    required: ["dish_name"],
    properties: { dish_name: { type: "string" } },
});

describe("generateSchemaFromPrompt", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns the generated schema and flags it OpenAI-compatible", async () => {
        providerReturns(COMPAT_SCHEMA);

        const result = await generateSchemaFromPrompt({
            prompt: "Return the dish name.",
            targetModelId: "gpt-4o",
            apiKeys: { openai: "key" },
        });

        expect(result.schema).toMatchObject({ type: "object" });
        expect(result.openaiCompatible).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("normalizes generated object schemas to OpenAI strict output rules", async () => {
        // The model sometimes omits strict object requirements; the app fixes
        // those deterministic schema-shape issues before validation.
        providerReturns(
            JSON.stringify({
                type: "object",
                properties: {
                    dish_name: { type: "string" },
                    nutrition: {
                        type: "object",
                        properties: {
                            fat: { type: "number" },
                        },
                    },
                },
            }),
        );

        const result = await generateSchemaFromPrompt({
            prompt: "Return the dish name.",
            targetModelId: "gpt-4o",
            apiKeys: { openai: "key" },
        });

        expect(result.schema).toMatchObject({
            type: "object",
            additionalProperties: false,
            required: ["dish_name", "nutrition"],
            properties: {
                nutrition: {
                    type: "object",
                    additionalProperties: false,
                    required: ["fat"],
                },
            },
        });
        expect(result.openaiCompatible).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("throws when the model does not return JSON", async () => {
        providerReturns("Here is your schema: not actually json");

        await expect(
            generateSchemaFromPrompt({
                prompt: "Return the dish name.",
                targetModelId: "gpt-4o",
                apiKeys: { openai: "key" },
            }),
        ).rejects.toThrow(/did not return a JSON object/);
    });
});
