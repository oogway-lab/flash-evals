import { describe, expect, it, vi } from "vitest";
import { resolveAnswerSchema } from "./answerSchema";

vi.mock("../db/client", () => ({ db: {} }));
vi.mock("./service", () => ({
    getDatasetSchema: vi.fn(),
}));
vi.mock("../pipelines/service", () => ({
    getPipeline: vi.fn(),
    pipelineFactualDescriptors: vi.fn(() => []),
}));

import { getDatasetSchema } from "./service";
import { getPipeline } from "../pipelines/service";

const validJsonSchema = {
    type: "object",
    additionalProperties: false,
    required: ["answer"],
    properties: { answer: { type: "string" } },
};

describe("resolveAnswerSchema", () => {
    it("returns an open import schema for evaluation datasets", async () => {
        vi.mocked(getDatasetSchema).mockResolvedValue(
            undefined as unknown as Awaited<ReturnType<typeof getDatasetSchema>>,
        );

        const result = await resolveAnswerSchema("ds-1", {
            purpose: "evaluation",
            pipelineId: null,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.importSchema).toEqual({
            fields: [],
            additionalProperties: true,
        });
        expect(result.answerSchema).toBeUndefined();
        // Evaluation datasets accept a freeform expected output (no schema).
        expect(result.freeformLabel).toBe(true);
    });

    it("returns an open import schema for independent golden datasets", async () => {
        vi.mocked(getDatasetSchema).mockResolvedValue(
            undefined as unknown as Awaited<ReturnType<typeof getDatasetSchema>>,
        );

        const result = await resolveAnswerSchema("ds-1", {
            purpose: "golden",
            pipelineId: null,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.mode).toBe("independent");
        expect(result.importSchema).toEqual({
            fields: [],
            additionalProperties: true,
        });
        expect(result.freeformLabel).toBe(true);
    });

    it("derives the answer schema from the pipeline when one is attached", async () => {
        vi.mocked(getDatasetSchema).mockResolvedValue(
            undefined as unknown as Awaited<ReturnType<typeof getDatasetSchema>>,
        );
        vi.mocked(getPipeline).mockResolvedValue({
            outputSchema: validJsonSchema,
            fieldConfigs: [],
        } as unknown as Awaited<ReturnType<typeof getPipeline>>);

        const result = await resolveAnswerSchema("ds-1", {
            purpose: "golden",
            pipelineId: "pipe-1",
        });

        expect(getPipeline).toHaveBeenCalledWith("pipe-1");
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.mode).toBe("pipeline");
        expect(result.answerSchema).toEqual({
            fields: [],
            additionalProperties: true,
        });
        expect(result.freeformLabel).toBe(false);
    });

    it("fails when the attached pipeline no longer exists", async () => {
        vi.mocked(getDatasetSchema).mockResolvedValue(
            undefined as unknown as Awaited<ReturnType<typeof getDatasetSchema>>,
        );
        vi.mocked(getPipeline).mockResolvedValue(
            undefined as unknown as Awaited<ReturnType<typeof getPipeline>>,
        );

        const result = await resolveAnswerSchema("ds-1", {
            purpose: "golden",
            pipelineId: "pipe-gone",
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.mode).toBe("pipeline");
        expect(result.error).toBe("Pipeline not found.");
    });

    it("parses the legacy dataset schema when there is no pipeline", async () => {
        vi.mocked(getDatasetSchema).mockResolvedValue({
            id: "schema-1",
            datasetId: "ds-1",
            jsonSchema: validJsonSchema,
            fieldRules: [],
            createdAt: new Date(),
        } as unknown as Awaited<ReturnType<typeof getDatasetSchema>>);

        const result = await resolveAnswerSchema("ds-1", {
            purpose: "golden",
            pipelineId: null,
        });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.mode).toBe("legacySchema");
        expect(result.freeformLabel).toBe(false);
        expect(result.answerSchema?.fields.map((f) => f.name)).toEqual([
            "answer",
        ]);
    });

    it("fails when the legacy dataset schema is invalid", async () => {
        vi.mocked(getDatasetSchema).mockResolvedValue({
            id: "schema-1",
            datasetId: "ds-1",
            jsonSchema: { type: "object", properties: {} },
            fieldRules: [],
            createdAt: new Date(),
        } as unknown as Awaited<ReturnType<typeof getDatasetSchema>>);

        const result = await resolveAnswerSchema("ds-1", {
            purpose: "golden",
            pipelineId: null,
        });

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.mode).toBe("legacySchema");
    });
});