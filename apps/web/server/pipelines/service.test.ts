import { describe, expect, it, vi } from "vitest";
import {
    fieldConfigsFromSchema,
    filterFieldConfigsForGoldenLabel,
    pipelineFactualDescriptors,
    ruleFromConfig,
    splitPipelineFields,
    mergeRunFieldConfigs,
    validatePipelineFields,
} from "./service";
import type {
    FieldRule,
    IPipelineFieldConfig,
    JsonSchemaObject,
} from "../db/jsonTypes";

vi.mock("../db/client", () => ({ db: {} }));

const foodSchema: JsonSchemaObject = {
    type: "object",
    additionalProperties: false,
    required: ["dish", "calories"],
    properties: {
        dish: { type: "string" },
        items: { type: "array", items: { type: "string" } },
        calories: { type: "number" },
    },
};

const foodRules: FieldRule[] = [
    { field: "dish", matcher: "exact" },
    { field: "items", matcher: "set_overlap" },
    { field: "calories", matcher: "numeric_tolerance", tolerance: 0.25, relative: true },
];

describe("fieldConfigsFromSchema", () => {
    it("maps each ruled field to a factual config carrying its matcher spec", () => {
        const configs = fieldConfigsFromSchema(foodSchema, foodRules);
        expect(configs).toEqual([
            { field: "dish", kind: "factual", spec: { matcher: "exact" } },
            { field: "items", kind: "factual", spec: { matcher: "set_overlap" } },
            {
                field: "calories",
                kind: "factual",
                spec: { matcher: "numeric_tolerance", tolerance: 0.25, relative: true },
            },
        ]);
    });

    it("migrates a schema field with no rule as factual-but-unscored, not dropped", () => {
        const configs = fieldConfigsFromSchema(foodSchema, [
            { field: "dish", matcher: "exact" },
        ]);
        expect(configs).toContainEqual({ field: "items", kind: "factual" });
        expect(configs).toContainEqual({ field: "calories", kind: "factual" });
        expect(configs).toHaveLength(3);
    });

    it("returns no configs when the schema has no properties", () => {
        expect(fieldConfigsFromSchema({ type: "object" }, [])).toEqual([]);
    });
});

describe("ruleFromConfig", () => {
    it("round-trips a factual config back into a FieldRule", () => {
        const config: IPipelineFieldConfig = {
            field: "calories",
            kind: "factual",
            spec: { matcher: "numeric_tolerance", tolerance: 0.25, relative: true },
        };
        expect(ruleFromConfig(config)).toEqual({
            field: "calories",
            matcher: "numeric_tolerance",
            tolerance: 0.25,
            relative: true,
        });
    });

    it("returns undefined for a generative or unscored field", () => {
        expect(
            ruleFromConfig({ field: "x", kind: "factual" }),
        ).toBeUndefined();
        expect(
            ruleFromConfig({
                field: "tip",
                kind: "generative",
                rubric: "is it kind?",
                modelId: "gpt-4o",
            }),
        ).toBeUndefined();
    });
});

describe("splitPipelineFields", () => {
    it("separates factual and generative configs", () => {
        const configs: IPipelineFieldConfig[] = [
            { field: "dish", kind: "factual", spec: { matcher: "exact" } },
            { field: "tip", kind: "generative", rubric: "kind?", modelId: "gpt-4o" },
        ];
        const split = splitPipelineFields(configs);
        expect(split.factual.map((c) => c.field)).toEqual(["dish"]);
        expect(split.generative.map((c) => c.field)).toEqual(["tip"]);
    });
});

describe("pipelineFactualDescriptors", () => {
    it("returns descriptors only for factual fields", () => {
        const configs: IPipelineFieldConfig[] = [
            { field: "dish", kind: "factual", spec: { matcher: "exact" } },
            { field: "calories", kind: "factual", spec: { matcher: "exact" } },
            { field: "items", kind: "generative", rubric: "ok?", modelId: "gpt-4o" },
        ];
        const descriptors = pipelineFactualDescriptors(foodSchema, configs);
        expect(descriptors.map((d) => d.name).sort()).toEqual(["calories", "dish"]);
        expect(descriptors.find((d) => d.name === "calories")?.type).toBe("number");
    });
});

describe("mergeRunFieldConfigs", () => {
    it("overlays matcher edits while preserving bundle field list", () => {
        const pipelineConfigs: IPipelineFieldConfig[] = [
            { field: "score", kind: "factual" },
            { field: "tip", kind: "generative", rubric: "base", modelId: "gpt-4o-mini" },
        ];
        const submitted: IPipelineFieldConfig[] = [
            { field: "score", kind: "factual", spec: { matcher: "exact" } },
            { field: "tip", kind: "generative", rubric: "edited", modelId: "gpt-4o" },
        ];

        expect(mergeRunFieldConfigs(pipelineConfigs, submitted)).toEqual({
            ok: true,
            fieldConfigs: submitted,
        });
    });

    it("rejects unknown or reordered fields from the client", () => {
        const pipelineConfigs: IPipelineFieldConfig[] = [
            { field: "score", kind: "factual" },
        ];
        expect(
            mergeRunFieldConfigs(pipelineConfigs, [
                { field: "other", kind: "factual", spec: { matcher: "exact" } },
            ]),
        ).toMatchObject({ ok: false });
    });

    it("rejects a client config that flips a field's kind", () => {
        const pipelineConfigs: IPipelineFieldConfig[] = [
            { field: "score", kind: "factual" },
        ];
        expect(
            mergeRunFieldConfigs(pipelineConfigs, [
                { field: "score", kind: "generative", rubric: "x", modelId: "gpt-4o" },
            ]),
        ).toMatchObject({ ok: false });
    });

    it("rejects an invalid matcher spec from the client", () => {
        const pipelineConfigs: IPipelineFieldConfig[] = [
            { field: "score", kind: "factual" },
        ];
        expect(
            mergeRunFieldConfigs(pipelineConfigs, [
                {
                    field: "score",
                    kind: "factual",
                    spec: { matcher: "evil" } as never,
                },
            ]),
        ).toMatchObject({ ok: false });
    });

    it("rejects an oversized rubric or empty judge model", () => {
        const pipelineConfigs: IPipelineFieldConfig[] = [
            { field: "tip", kind: "generative", rubric: "base", modelId: "gpt-4o" },
        ];
        expect(
            mergeRunFieldConfigs(pipelineConfigs, [
                { field: "tip", kind: "generative", rubric: "x".repeat(5000), modelId: "gpt-4o" },
            ]),
        ).toMatchObject({ ok: false });
        expect(
            mergeRunFieldConfigs(pipelineConfigs, [
                { field: "tip", kind: "generative", rubric: "ok", modelId: "  " },
            ]),
        ).toMatchObject({ ok: false });
    });
});

describe("validatePipelineFields", () => {
    it("accepts configs whose fields exist in the output structure", () => {
        const configs = fieldConfigsFromSchema(foodSchema, foodRules);
        expect(validatePipelineFields(foodSchema, configs)).toEqual({ ok: true });
    });

    it("rejects a config naming a field absent from the structure", () => {
        const configs: IPipelineFieldConfig[] = [
            { field: "missing", kind: "factual", spec: { matcher: "exact" } },
        ];
        expect(validatePipelineFields(foodSchema, configs)).toMatchObject({
            ok: false,
            error: expect.stringContaining("missing"),
        });
    });
});

describe("filterFieldConfigsForGoldenLabel", () => {
    it("AE3: keeps overlapping factual fields and all generative fields", () => {
        const configs: IPipelineFieldConfig[] = [
            { field: "realFoodScore", kind: "factual", spec: { matcher: "exact" } },
            { field: "keepGoingTip", kind: "generative", rubric: "?", modelId: "gpt-4o" },
            { field: "macros", kind: "factual", spec: { matcher: "exact" } },
        ];
        const filtered = filterFieldConfigsForGoldenLabel(
            configs,
            new Set(["realFoodScore", "keepGoingTip"]),
        );

        expect(filtered.map((c) => c.field)).toEqual([
            "realFoodScore",
            "keepGoingTip",
        ]);
    });
});
