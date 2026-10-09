import { describe, expect, it } from "vitest";
import {
    extractSchemaPaths,
    schemaHash,
    validateDataAgainstSchema,
    validatePromptSchema,
} from "./schemaValidation";

const nestedSchema = {
    type: "object",
    additionalProperties: false,
    required: ["title", "nutrition", "items"],
    properties: {
        title: { type: "string" },
        nutrition: {
            type: "object",
            additionalProperties: false,
            required: ["calories", "fiberGrams"],
            properties: {
                calories: { type: "number", minimum: 0 },
                fiberGrams: { type: ["number", "null"] },
            },
        },
        items: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "confidence"],
                properties: {
                    name: { type: "string", enum: ["oatmeal", "banana"] },
                    confidence: { type: "number", minimum: 0, maximum: 1 },
                },
            },
        },
    },
};

describe("validatePromptSchema", () => {
    it("accepts nested schemas locally and marks OpenAI-compatible strict schemas", () => {
        const result = validatePromptSchema(nestedSchema);

        expect(result.localValid).toBe(true);
        expect(result.openaiCompatible).toBe(true);
        expect(result.errors).toEqual([]);
    });

    it("keeps locally valid root anyOf schemas separate from OpenAI compatibility", () => {
        const result = validatePromptSchema({
            anyOf: [
                { type: "string" },
                { type: "number" },
            ],
        });

        expect(result.localValid).toBe(true);
        expect(result.openaiCompatible).toBe(false);
        expect(result.errors).toContainEqual(
            expect.objectContaining({ code: "openai_root_anyof" }),
        );
    });

    it("reports optional object properties as OpenAI-incompatible", () => {
        const result = validatePromptSchema({
            type: "object",
            additionalProperties: false,
            required: ["title"],
            properties: {
                title: { type: "string" },
                notes: { type: "string" },
            },
        });

        expect(result.localValid).toBe(true);
        expect(result.openaiCompatible).toBe(false);
        expect(result.errors).toContainEqual(
            expect.objectContaining({
                path: "$.notes",
                code: "openai_required_property",
            }),
        );
    });

    it("rejects reserved property names", () => {
        const result = validatePromptSchema(
            JSON.parse(
                '{"type":"object","additionalProperties":false,"required":["__proto__"],"properties":{"__proto__":{"type":"string"}}}',
            ),
        );

        expect(result.openaiCompatible).toBe(false);
        expect(result.errors).toContainEqual(
            expect.objectContaining({ path: "$.__proto__", code: "reserved_key" }),
        );
    });
});

describe("validateDataAgainstSchema", () => {
    it("returns ok for data matching the schema", () => {
        expect(
            validateDataAgainstSchema(nestedSchema, {
                title: "Breakfast",
                nutrition: { calories: 350, fiberGrams: null },
                items: [{ name: "oatmeal", confidence: 0.9 }],
            }),
        ).toEqual({ ok: true });
    });

    it("returns path-level errors for missing required fields and wrong types", () => {
        const result = validateDataAgainstSchema(nestedSchema, {
            title: "Breakfast",
            nutrition: { calories: "350" },
            items: [{ name: "toast", confidence: 1.2 }],
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.errors).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ path: "$.nutrition.calories" }),
                    expect.objectContaining({ path: "$.nutrition" }),
                    expect.objectContaining({ path: "$.items.0.name" }),
                    expect.objectContaining({ path: "$.items.0.confidence" }),
                ]),
            );
        }
    });
});

describe("extractSchemaPaths", () => {
    it("returns nested property descriptors", () => {
        expect(extractSchemaPaths(nestedSchema)).toEqual(
            expect.arrayContaining([
                { path: "$.title", type: "string", required: true },
                { path: "$.nutrition", type: "object", required: true },
                { path: "$.nutrition.calories", type: "number", required: true },
            ]),
        );
    });
});

describe("schemaHash", () => {
    it("is stable across object key order", () => {
        expect(schemaHash({ b: 1, a: 2 })).toBe(schemaHash({ a: 2, b: 1 }));
    });
});
