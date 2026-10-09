import { describe, expect, it, vi } from "vitest";

vi.mock("./answerSchema", () => ({
    resolveAnswerSchema: vi.fn(),
}));

import { parseAndValidateLabelForDataset } from "./labelPolicyResolve";
import { resolveAnswerSchema } from "./answerSchema";
import { parseSchema } from "./schemaForm";

const golden = { purpose: "golden" as const, pipelineId: null };

const structuredSchema = parseSchema({
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: { answer: { type: "string" } },
});
if (!structuredSchema.ok) throw new Error("fixture schema failed to parse");

function mockResolved(value: Awaited<ReturnType<typeof resolveAnswerSchema>>) {
    vi.mocked(resolveAnswerSchema).mockResolvedValue(value);
}

describe("parseAndValidateLabelForDataset", () => {
    it("accepts a freeform expected output for evaluation datasets", async () => {
        mockResolved({
            ok: true,
            mode: "evaluation",
            answerSchema: undefined,
            importSchema: { fields: [], additionalProperties: true },
            freeformLabel: true,
        });

        const result = await parseAndValidateLabelForDataset(
            "ds-1",
            { purpose: "evaluation", pipelineId: null },
            JSON.stringify({ expected: "salad" }),
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.label).toEqual({ expected: "salad" });
    });

    it("propagates a schema-resolution failure as a formError", async () => {
        mockResolved({ ok: false, mode: "pipeline", error: "Pipeline not found." });

        const result = await parseAndValidateLabelForDataset("ds-1", golden, "{}");

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.formError).toBe("Pipeline not found.");
    });

    it("accepts any JSON object in independent mode", async () => {
        mockResolved({
            ok: true,
            mode: "independent",
            answerSchema: undefined,
            importSchema: { fields: [], additionalProperties: true },
            freeformLabel: true,
        });

        const result = await parseAndValidateLabelForDataset(
            "ds-1",
            golden,
            JSON.stringify({ anything: 1, nested: { ok: true } }),
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.label).toEqual({ anything: 1, nested: { ok: true } });
    });

    it("rejects invalid JSON in independent mode with a label field error", async () => {
        mockResolved({
            ok: true,
            mode: "independent",
            answerSchema: undefined,
            importSchema: { fields: [], additionalProperties: true },
            freeformLabel: true,
        });

        const result = await parseAndValidateLabelForDataset(
            "ds-1",
            golden,
            "{not json",
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.fieldErrors?.label?.[0]).toBeTruthy();
    });

    it("validates structured labels against the resolved answer schema", async () => {
        mockResolved({
            ok: true,
            mode: "pipeline",
            answerSchema: structuredSchema.schema,
            importSchema: structuredSchema.schema,
            freeformLabel: false,
        });

        const result = await parseAndValidateLabelForDataset(
            "ds-1",
            golden,
            JSON.stringify({ answer: "Yes" }),
        );

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.label).toEqual({ answer: "Yes" });
    });

    it("rejects structured labels carrying unknown fields", async () => {
        mockResolved({
            ok: true,
            mode: "pipeline",
            answerSchema: structuredSchema.schema,
            importSchema: structuredSchema.schema,
            freeformLabel: false,
        });

        const result = await parseAndValidateLabelForDataset(
            "ds-1",
            golden,
            JSON.stringify({ answer: "Yes", extra: "nope" }),
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.fieldErrors?.extra?.[0]).toContain("extra");
    });

    it("rejects invalid JSON in structured mode with a label field error", async () => {
        mockResolved({
            ok: true,
            mode: "pipeline",
            answerSchema: structuredSchema.schema,
            importSchema: structuredSchema.schema,
            freeformLabel: false,
        });

        const result = await parseAndValidateLabelForDataset(
            "ds-1",
            golden,
            "  ",
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.fieldErrors?.label?.[0]).toContain("Invalid JSON");
    });
});
