import { describe, expect, it, vi } from "vitest";
import { scoreOutput } from "./scoreOutput";
import { scoreFieldDiff } from "./fieldDiff";
import { fieldConfigsFromSchema } from "../pipelines/service";
import type { JudgeFn } from "./judgeFields";
import type { ApiKeys } from "@mosaic/llm-core";
import type {
    FieldRule,
    IPipelineFieldConfig,
    JsonSchemaObject,
} from "../db/jsonTypes";

vi.mock("../db/client", () => ({ db: {} }));

const apiKeys: ApiKeys = { openai: "test" };

const base = {
    inputText: undefined,
    hasImage: false,
    reference: undefined,
    apiKeys,
    maxTokens: 500,
};

const stubJudge =
    (scoreByField: Record<string, number>): JudgeFn =>
    async (input) => {
        const field = input.rubricPrompt.match(/"([^"]+)" field/)?.[1] ?? "";
        const score = scoreByField[field];
        if (score === undefined) return { ok: false, error: "no score" };
        return {
            ok: true,
            score,
            rationale: `judged ${field}`,
            criteria: [],
            winner: "not_applicable",
        };
    };

const configs: IPipelineFieldConfig[] = [
    { field: "calories", kind: "factual", spec: { matcher: "numeric_tolerance", tolerance: 0.25, relative: true } },
    { field: "keepGoingTip", kind: "generative", rubric: "is it encouraging?", modelId: "gpt-4o" },
];

describe("scoreOutput", () => {
    it("AE3: field-diff scores only bundle factual fields present in filtered configs", async () => {
        const overlapConfigs: IPipelineFieldConfig[] = [
            { field: "realFoodScore", kind: "factual", spec: { matcher: "exact" } },
        ];
        const result = await scoreOutput({
            ...base,
            output: { realFoodScore: 8, keepGoingTip: "Great!" },
            label: { realFoodScore: 8, keepGoingTip: "ignored for field-diff" },
            fieldConfigs: overlapConfigs,
        });

        expect(result.fieldDiff?.details.fields.map((f) => f.field)).toEqual([
            "realFoodScore",
        ]);
    });

    it("AE1: produces one field_diff result and one judge result; generative is never matched deterministically", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { calories: 100, keepGoingTip: "Great job!" },
                label: { calories: 100, keepGoingTip: "ignored by judge" },
                fieldConfigs: configs,
            },
            stubJudge({ keepGoingTip: 0.9 }),
        );

        expect(result.fieldDiff?.score).toBe(1);
        expect(result.fieldDiff?.details.fields.map((f) => f.field)).toEqual([
            "calories",
        ]);
        expect(result.judge?.score).toBe(0.9);
        expect(result.judge?.details?.fields).toEqual([
            { field: "keepGoingTip", score: 0.9, rationale: "judged keepGoingTip" },
        ]);
    });

    it("keeps per-field judge detail for each generative field", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { tipA: "x", tipB: "y" },
                fieldConfigs: [
                    { field: "tipA", kind: "generative", rubric: "?", modelId: "gpt-4o" },
                    { field: "tipB", kind: "generative", rubric: "?", modelId: "gpt-4o" },
                ],
            },
            stubJudge({ tipA: 1, tipB: 0 }),
        );

        expect(result.judge?.details?.fields).toHaveLength(2);
        expect(result.judge?.score).toBe(0.5);
    });

    it("scores a wrong-typed factual value 0 without affecting other factual fields", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { calories: "not a number", dish: "oatmeal" },
                label: { calories: 100, dish: "oatmeal" },
                fieldConfigs: [
                    { field: "calories", kind: "factual", spec: { matcher: "numeric_tolerance", tolerance: 0.1 } },
                    { field: "dish", kind: "factual", spec: { matcher: "exact" } },
                ],
            },
            stubJudge({}),
        );
        const byField = Object.fromEntries(
            (result.fieldDiff?.details.fields ?? []).map((f) => [f.field, f.score]),
        );
        expect(byField.calories).toBe(0);
        expect(byField.dish).toBe(1);
    });

    it("skips a factual field with no matcher spec (migrated unscored field)", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { dish: "oatmeal", notes: "anything" },
                label: { dish: "oatmeal", notes: "whatever" },
                fieldConfigs: [
                    { field: "dish", kind: "factual", spec: { matcher: "exact" } },
                    { field: "notes", kind: "factual" },
                ],
            },
            stubJudge({}),
        );
        expect(result.fieldDiff?.details.fields.map((f) => f.field)).toEqual([
            "dish",
        ]);
    });

    it("isolates a judge failure on one generative field — others still score", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { tipA: "x", tipB: "y" },
                fieldConfigs: [
                    { field: "tipA", kind: "generative", rubric: "?", modelId: "gpt-4o" },
                    { field: "tipB", kind: "generative", rubric: "?", modelId: "gpt-4o" },
                ],
            },
            stubJudge({ tipA: 0.8 }),
        );
        const byField = Object.fromEntries(
            (result.judge?.details?.fields ?? []).map((f) => [f.field, f.score]),
        );
        expect(byField.tipA).toBe(0.8);
        expect(byField.tipB).toBeNull();
        expect(result.judge?.score).toBe(0.8);
        expect(result.judge?.details?.errorCount).toBe(1);
    });

    it("produces no judge result when there are no generative fields", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { dish: "oatmeal" },
                label: { dish: "oatmeal" },
                fieldConfigs: [
                    { field: "dish", kind: "factual", spec: { matcher: "exact" } },
                ],
            },
            stubJudge({}),
        );
        expect(result.judge).toBeUndefined();
        expect(result.fieldDiff?.score).toBe(1);
    });

    it("scores with a run-level judge prompt version when no generative fields exist", async () => {
        const judge = vi.fn(async (input) => {
            expect(input.judgeModelId).toBe("gpt-4o-mini");
            expect(input.rubricPrompt).toBe("Compare candidate to reference.");
            expect(input.declaredInputs).toEqual([
                "candidate_output",
                "reference",
            ]);
            expect(input.reasoningEffort).toBe("low");
            expect(input.output).toEqual({ dish: "oatmeal" });
            expect(input.reference).toEqual({ dish: "oatmeal with banana" });
            return {
                ok: true as const,
                score: 0.7,
                rationale: "Mostly aligned.",
                criteria: [],
                winner: "tie" as const,
            };
        });

        const result = await scoreOutput(
            {
                ...base,
                output: { dish: "oatmeal" },
                fieldConfigs: [],
                reference: { dish: "oatmeal with banana" },
                judgePrompt: {
                    modelId: "openai::gpt-4o-mini",
                    rubricPrompt: "Compare candidate to reference.",
                    declaredInputs: ["candidate_output", "reference"],
                    reasoningEffort: "low",
                },
            },
            judge,
        );

        expect(result.judge).toEqual({
            score: 0.7,
            rationale: "Mostly aligned.",
        });
        expect(judge).toHaveBeenCalledTimes(1);
    });

    it("scores migrated configs identically to scoreFieldDiff over the source rules", async () => {
        const schema: JsonSchemaObject = {
            type: "object",
            properties: {
                dish: { type: "string" },
                items: { type: "array", items: { type: "string" } },
                calories: { type: "number" },
            },
        };
        const rules: FieldRule[] = [
            { field: "dish", matcher: "exact" },
            { field: "items", matcher: "set_overlap" },
            { field: "calories", matcher: "numeric_tolerance", tolerance: 0.25, relative: true },
        ];
        const output = {
            dish: "Oatmeal",
            items: ["oats", "banana"],
            calories: 360,
        };
        const label = {
            dish: "oatmeal",
            items: ["banana", "oats"],
            calories: 350,
        };

        const direct = scoreFieldDiff(output, label, rules);
        const viaPipeline = await scoreOutput(
            {
                ...base,
                output,
                label,
                fieldConfigs: fieldConfigsFromSchema(schema, rules),
            },
            stubJudge({}),
        );

        expect(viaPipeline.fieldDiff?.score).toBe(direct.score);
        expect(viaPipeline.fieldDiff?.details).toEqual(direct.details);
    });

    it("scores nested JSON schema paths", async () => {
        const result = await scoreOutput(
            {
                ...base,
                output: { nutrition: { calories: 350 } },
                label: { nutrition: { calories: 350 } },
                fieldConfigs: [
                    {
                        field: "$.nutrition.calories",
                        kind: "factual",
                        spec: { matcher: "exact" },
                    },
                ],
            },
            stubJudge({}),
        );

        expect(result.fieldDiff?.score).toBe(1);
        expect(result.fieldDiff?.details.fields[0]).toMatchObject({
            field: "$.nutrition.calories",
            actual: 350,
            expected: 350,
        });
    });
});
