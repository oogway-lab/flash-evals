import { describe, expect, it } from "vitest";
import {
    formatLabelError,
    inferFieldSetFromLabels,
    parseGoldenLabel,
    parseSchema,
    validateLabel,
} from "./schemaForm";

const foodSchema = {
    type: "object",
    additionalProperties: false,
    required: ["dish", "calories", "items"],
    properties: {
        dish: { type: "string" },
        calories: { type: "number" },
        items: { type: "array", items: { type: "string" } },
    },
};

describe("parseSchema", () => {
    it("parses flat presets into descriptors and honors additionalProperties false", () => {
        const parsed = parseSchema(foodSchema);

        expect(parsed).toEqual({
            ok: true,
            schema: {
                additionalProperties: false,
                fields: [
                    { name: "dish", type: "string", required: true },
                    { name: "calories", type: "number", required: true },
                    { name: "items", type: "string[]", required: true },
                ],
            },
        });
    });

    it("allows extra label keys when additionalProperties is absent or true", () => {
        const absent = parseSchema({
            type: "object",
            required: ["answer"],
            properties: { answer: { type: "string" } },
        });
        const explicit = parseSchema({
            type: "object",
            additionalProperties: true,
            required: ["answer"],
            properties: { answer: { type: "string" } },
        });

        expect(absent.ok && absent.schema.additionalProperties).toBe(true);
        expect(explicit.ok && explicit.schema.additionalProperties).toBe(true);
    });

    it("rejects unenforced constraints and nested schemas", () => {
        expect(
            parseSchema({
                type: "object",
                properties: { dish: { type: "string", enum: ["oatmeal"] } },
            }),
        ).toMatchObject({ ok: false });

        expect(
            parseSchema({
                type: "object",
                properties: {
                    nutrition: {
                        type: "object",
                        properties: { calories: { type: "number" } },
                    },
                },
            }),
        ).toMatchObject({ ok: false });

        expect(
            parseSchema({
                type: "object",
                properties: { calories: { type: "number", minimum: 0 } },
            }),
        ).toMatchObject({ ok: false });
    });

    it("rejects prototype-pollution field names without mutating prototypes", () => {
        const schema = JSON.parse(
            '{"type":"object","properties":{"__proto__":{"type":"string"}}}',
        );

        expect(parseSchema(schema)).toMatchObject({ ok: false });
        expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });

    it("rejects empty schemas with a clear reason", () => {
        expect(parseSchema({})).toEqual({
            ok: false,
            error: expect.stringContaining("object"),
        });
    });
});

describe("validateLabel", () => {
    it("reports a missing required field by name", () => {
        const parsed = parseSchema(foodSchema);
        if (!parsed.ok) throw new Error(parsed.error);

        const errors = validateLabel(
            { dish: "oatmeal", items: ["oatmeal", "banana"] },
            parsed.schema,
        );

        expect(errors).toHaveLength(1);
        expect(errors[0]).toMatchObject({
            field: "calories",
            code: "required",
        });
        expect(formatLabelError(errors[0])).toContain("calories");
    });

    it("reports an unknown field when additionalProperties is false", () => {
        const parsed = parseSchema(foodSchema);
        if (!parsed.ok) throw new Error(parsed.error);

        const errors = validateLabel(
            {
                dish: "oatmeal",
                calories: 350,
                items: ["oatmeal"],
                notes: "extra",
            },
            parsed.schema,
        );

        expect(errors).toEqual([
            expect.objectContaining({ field: "notes", code: "unknown" }),
        ]);
    });

    it("allows unknown fields when additionalProperties is true", () => {
        const parsed = parseSchema({
            type: "object",
            required: ["answer"],
            properties: { answer: { type: "string" } },
        });
        if (!parsed.ok) throw new Error(parsed.error);

        expect(validateLabel({ answer: "yes", notes: "ok" }, parsed.schema)).toEqual(
            [],
        );
    });

    it("reports wrong field types by name", () => {
        const parsed = parseSchema(foodSchema);
        if (!parsed.ok) throw new Error(parsed.error);

        const errors = validateLabel(
            { dish: "oatmeal", calories: "350", items: "oatmeal" },
            parsed.schema,
        );

        expect(errors).toEqual([
            expect.objectContaining({ field: "calories", code: "type" }),
            expect.objectContaining({ field: "items", code: "type" }),
        ]);
    });

    it("rejects reserved keys even when additionalProperties is true", () => {
        const open = parseSchema({
            type: "object",
            additionalProperties: true,
            properties: { answer: { type: "string" } },
        });
        if (!open.ok) throw new Error(open.error);

        const errors = validateLabel(
            JSON.parse('{"answer":"yes","constructor":"evil","__proto__":"x"}'),
            open.schema,
        );

        expect(errors).toContainEqual(
            expect.objectContaining({ field: "constructor", code: "reserved" }),
        );
        expect(errors).toContainEqual(
            expect.objectContaining({ field: "__proto__", code: "reserved" }),
        );
    });
});

describe("parseGoldenLabel", () => {
    it("accepts a plain JSON object", () => {
        const result = parseGoldenLabel('{"score": 8, "title": "oatmeal"}');
        expect(result).toEqual({
            ok: true,
            label: { score: 8, title: "oatmeal" },
        });
    });

    it("rejects non-object values", () => {
        const result = parseGoldenLabel('"not an object"');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("JSON object");
        }
    });
});

describe("inferFieldSetFromLabels", () => {
    it("returns the union of top-level keys", () => {
        const keys = inferFieldSetFromLabels([
            { score: 8 },
            { title: "oat", keepGoingTip: "nice" },
        ]);
        expect([...keys].sort()).toEqual(["keepGoingTip", "score", "title"]);
    });
});
