import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as LlmCore from "@mosaic/llm-core";
import type { CompletionRequest, CompletionResult } from "@mosaic/llm-core";
import { getEvalProvider } from "@mosaic/llm-core";
import { generateJudgeFromContext } from "./judgeGenerator";
import type { JsonSchemaObject } from "../db/jsonTypes";

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

const OUTPUT_SCHEMA: JsonSchemaObject = {
    type: "object",
    additionalProperties: false,
    required: ["dish_name"],
    properties: { dish_name: { type: "string" } },
};

const RUBRIC = "Score the output on accuracy. Reason first, then give 0-1.";

describe("generateJudgeFromContext", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns a rubric and passes the task + schema to the generator model", async () => {
        const complete = providerReturns(RUBRIC);

        const result = await generateJudgeFromContext({
            taskPrompt: "Extract the dish name from the photo.",
            outputSchema: OUTPUT_SCHEMA,
            modality: "image",
            hasGolden: true,
            apiKeys: { openai: "key" },
        });

        expect(result.rubricPrompt).toBe(RUBRIC);
        const req = complete.mock.calls[0][0];
        expect(req.model).toBe("gpt-5.4-mini");
        expect(req.prompt).toContain("Extract the dish name");
        expect(req.prompt).toContain("dish_name");
        // rubric must define named criteria so the judge emits a breakdown
        expect(req.prompt).toMatch(/NAMED evaluation criteria/i);
        expect(req.prompt).toMatch(/score EACH named criterion/i);
    });

    it("instructs scoring against criteria when no golden reference exists", async () => {
        const complete = providerReturns(RUBRIC);

        await generateJudgeFromContext({
            taskPrompt: "Describe the plate.",
            outputSchema: OUTPUT_SCHEMA,
            modality: "image",
            hasGolden: false,
            apiKeys: { openai: "key" },
        });

        const req = complete.mock.calls[0][0];
        expect(req.prompt).toMatch(/No reference answer is available/i);
    });

    it("references an available answer when the dataset is golden", async () => {
        const complete = providerReturns(RUBRIC);

        await generateJudgeFromContext({
            taskPrompt: "Describe the plate.",
            outputSchema: OUTPUT_SCHEMA,
            modality: "text",
            hasGolden: true,
            apiKeys: { openai: "key" },
        });

        const req = complete.mock.calls[0][0];
        expect(req.prompt).toMatch(/reference answer is available/i);
    });

    it("throws when the model returns an empty rubric", async () => {
        providerReturns("   ");

        await expect(
            generateJudgeFromContext({
                taskPrompt: "Extract the dish name.",
                outputSchema: OUTPUT_SCHEMA,
                modality: "image",
                hasGolden: true,
                apiKeys: { openai: "key" },
            }),
        ).rejects.toThrow(/did not return a rubric/);
    });
});
