import { describe, expect, it, vi } from "vitest";
import {
    parseStrictJsonOnly,
    staticPromptChecks,
    validatePromptForRunnableVersion,
} from "./validation";

const schema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "calories"],
    properties: {
        title: { type: "string" },
        calories: { type: "number" },
    },
};

const validPrompt = "Analyze the sample and return only JSON matching the schema.";

describe("staticPromptChecks", () => {
    it("warns when JSON is not explicitly requested", () => {
        expect(staticPromptChecks("Describe the meal.")).toContainEqual(
            expect.objectContaining({ code: "prompt_missing_json_instruction" }),
        );
    });

    it("hard-fails conflicting prose outside JSON instructions", () => {
        expect(
            staticPromptChecks("Return JSON, then explain your reasoning below."),
        ).toContainEqual(
            expect.objectContaining({ code: "prompt_conflicting_json" }),
        );
    });

    it("allows prompts that forbid Markdown wrappers", () => {
        expect(
            staticPromptChecks(
                "Return JSON only. Do not include Markdown, prose, or commentary.",
            ),
        ).toEqual([]);
    });
});

describe("parseStrictJsonOnly", () => {
    it("accepts a bare JSON object", () => {
        expect(parseStrictJsonOnly('{"title":"oatmeal"}')).toEqual({
            ok: true,
            value: { title: "oatmeal" },
        });
    });

    it("rejects fenced JSON wrappers", () => {
        expect(parseStrictJsonOnly('```json\n{"title":"oatmeal"}\n```')).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "json_wrapper" }),
        });
    });

    it("rejects JSON arrays as the root output", () => {
        expect(parseStrictJsonOnly("[]")).toEqual({
            ok: false,
            error: expect.objectContaining({ code: "invalid_json_object" }),
        });
    });
});

describe("validatePromptForRunnableVersion", () => {
    it("passes without a sample try-run when the schema is valid", async () => {
        const callModel = vi.fn();

        const result = await validatePromptForRunnableVersion({
            prompt: "Return a JSON object with the answer.",
            schema,
            targetModelId: "gpt-5.5",
            samples: [],
            callModel,
        });

        expect(result.passed).toBe(true);
        expect(callModel).not.toHaveBeenCalled();
        expect(result.evidence.sampleResults).toEqual([]);
    });

    it("does not call the provider when static checks hard-fail", async () => {
        const callModel = vi.fn();

        const result = await validatePromptForRunnableVersion({
            prompt: "Return JSON, then explain below.",
            schema,
            targetModelId: "gpt-5.5",
            samples: [{ name: "happy", inputText: "oatmeal" }],
            callModel,
        });

        expect(result.passed).toBe(false);
        expect(callModel).not.toHaveBeenCalled();
    });

    it("blocks prose outputs and stores the raw output", async () => {
        const result = await validatePromptForRunnableVersion({
            prompt: validPrompt,
            schema,
            targetModelId: "gpt-5.5",
            samples: [{ name: "happy", inputText: "oatmeal" }],
            callModel: async () => ({ text: "This is oatmeal." }),
        });

        expect(result.passed).toBe(false);
        expect(result.evidence.sampleResults[0]).toMatchObject({
            status: "failed",
            rawOutput: "This is oatmeal.",
            errors: [expect.objectContaining({ code: "invalid_json" })],
        });
    });

    it("blocks schema mismatches with path-level errors", async () => {
        const result = await validatePromptForRunnableVersion({
            prompt: validPrompt,
            schema,
            targetModelId: "gpt-5.5",
            samples: [{ name: "happy", inputText: "oatmeal" }],
            callModel: async () => ({ text: '{"title":"oatmeal"}' }),
        });

        expect(result.passed).toBe(false);
        expect(result.evidence.sampleResults[0].errors).toContainEqual(
            expect.objectContaining({ path: "$", code: "required" }),
        );
    });

    it("passes only when all samples return schema-valid JSON", async () => {
        const result = await validatePromptForRunnableVersion({
            prompt: validPrompt,
            schema,
            targetModelId: "gpt-5.5",
            samples: [
                { name: "happy", inputText: "oatmeal" },
                { name: "edge", inputText: "unknown meal" },
            ],
            callModel: async ({ sample }) => ({
                text: JSON.stringify({
                    title: sample.name === "happy" ? "oatmeal" : "unknown",
                    calories: sample.name === "happy" ? 350 : 0,
                }),
            }),
        });

        expect(result.passed).toBe(true);
        expect(result.evidence.sampleResults).toHaveLength(2);
    });

    it("passes the selected reasoning effort to the validation model call", async () => {
        const callModel = vi.fn(async () => ({
            text: '{"title":"oatmeal","calories":350}',
        }));

        const result = await validatePromptForRunnableVersion({
            prompt: validPrompt,
            schema,
            targetModelId: "gpt-5.5",
            reasoningEffort: "high",
            samples: [{ name: "happy", inputText: "oatmeal" }],
            callModel,
        });

        expect(result.passed).toBe(true);
        expect(callModel).toHaveBeenCalledWith(
            expect.objectContaining({
                targetModelId: "gpt-5.5",
                reasoningEffort: "high",
            }),
        );
    });

    it("persists provider failures as failed evidence", async () => {
        const result = await validatePromptForRunnableVersion({
            prompt: validPrompt,
            schema,
            targetModelId: "gpt-5.5",
            samples: [{ name: "happy", inputText: "oatmeal" }],
            callModel: async () => {
                throw new Error("timeout");
            },
        });

        expect(result.passed).toBe(false);
        expect(result.evidence.sampleResults[0]).toMatchObject({
            status: "provider_error",
            errors: [expect.objectContaining({ message: "timeout" })],
        });
    });
});
