import { describe, expect, it } from "vitest";
import { validatePromptDatasetCompatibility } from "./compatibility";
import type { JsonSchemaObject } from "../db/jsonTypes";

const schema: JsonSchemaObject = {
    type: "object",
    additionalProperties: false,
    required: ["dish", "nutrition", "notes"],
    properties: {
        dish: { type: "string" },
        nutrition: {
            type: "object",
            additionalProperties: false,
            required: ["calories"],
            properties: {
                calories: { type: "number" },
            },
        },
        notes: { type: ["string", "null"] },
    },
};

describe("validatePromptDatasetCompatibility", () => {
    it("accepts top-level and nested scorable fields", () => {
        const result = validatePromptDatasetCompatibility({
            promptSchema: schema,
            fieldConfigs: [
                { field: "dish", kind: "factual", spec: { matcher: "exact" } },
                {
                    field: "$.nutrition.calories",
                    kind: "factual",
                    spec: { matcher: "numeric_tolerance", tolerance: 10 },
                },
                {
                    field: "notes",
                    kind: "generative",
                    rubric: "Useful and concise",
                    modelId: "gpt-4o-mini",
                },
            ],
        });

        expect(result).toEqual({ ok: true, issues: [] });
    });

    it("blocks scorable fields missing from the prompt schema", () => {
        const result = validatePromptDatasetCompatibility({
            promptSchema: schema,
            fieldConfigs: [
                { field: "serving_size", kind: "factual", spec: { matcher: "exact" } },
            ],
        });

        expect(result.ok).toBe(false);
        expect(result.issues[0]).toMatchObject({
            path: "$.serving_size",
            code: "missing_prompt_field",
        });
    });
});
