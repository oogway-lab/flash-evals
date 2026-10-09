import { beforeEach, describe, expect, it, vi } from "vitest";

const capturedRunInsert = vi.fn();
const capturedModelInsert = vi.fn();

vi.mock("../db/client", () => {
    const runReturning = vi.fn(async () => [{ id: "run-1" }]);
    const modelReturning = vi.fn(async () => [
        { id: "rm-1", runId: "run-1", modelId: "gpt-4o" },
    ]);
    const cellsReturning = vi.fn(async () => []);

    const insert = vi.fn(() => {
        const values = vi.fn((payload: unknown) => {
            const first = Array.isArray(payload) ? payload[0] : payload;
            if (
                first &&
                typeof first === "object" &&
                "configSnapshot" in first
            ) {
                capturedRunInsert(payload);
                return { returning: runReturning };
            }
            if (
                first &&
                typeof first === "object" &&
                "modelId" in first &&
                "promptVersionId" in first
            ) {
                capturedModelInsert(payload);
                return { returning: modelReturning };
            }
            const returning = cellsReturning;
            return { returning };
        });
        return { values };
    });

    const mockDb = {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(async () => [
                    {
                        id: "item-1",
                        inputText: "hello",
                        storageKey: null,
                    },
                ]),
            })),
        })),
        insert,
        transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => {
            // Simple mock tx that reuses the same insert chain
            const tx = { insert };
            return fn(tx);
        }),
    };

    return { db: mockDb };
});

vi.mock("../pipelines/service", () => ({
    getPipeline: vi.fn(async () => ({
        id: "pipe-1",
        teamId: "team-1",
        name: "Bundle",
        outputSchema: { type: "object", properties: {} },
        fieldConfigs: [
            { field: "score", kind: "factual", spec: { matcher: "exact" } },
        ],
        promptId: null,
        createdAt: new Date(),
    })),
}));

import { createRun } from "./service";
import { getPipeline } from "../pipelines/service";

describe("createRun", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        capturedRunInsert.mockClear();
        capturedModelInsert.mockClear();
    });

    it("persists pipelineId from run setup, not the dataset record", async () => {
        const runId = await createRun(
            "team-1",
            "dataset-1",
            "pipe-from-form",
            [{ modelId: "gpt-4o", promptVersionId: "pv-1", isReference: true }],
            500,
            undefined,
            [{ field: "score", kind: "factual", spec: { matcher: "exact" } }],
            "user-1",
        );

        expect(runId).toBe("run-1");
        expect(getPipeline).toHaveBeenCalledWith("pipe-from-form");
        expect(capturedRunInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                pipelineId: "pipe-from-form",
                configSnapshot: expect.objectContaining({
                    pipelineId: "pipe-from-form",
                    fieldConfigs: [
                        {
                            field: "score",
                            kind: "factual",
                            spec: { matcher: "exact" },
                        },
                    ],
                }),
            }),
        );
    });

    it("allows prompt-schema runs without a legacy pipeline", async () => {
        const runId = await createRun(
            "team-1",
            "dataset-1",
            undefined,
            [
                {
                    modelId: "gpt-4o",
                    promptVersionId: "pv-1",
                    schemaVersionId: "schema-version-1",
                    promptSnapshot: {
                        promptId: "prompt-1",
                        promptName: "Extract",
                        promptVersionId: "pv-1",
                        promptVersion: 1,
                        schemaVersionId: "schema-version-1",
                        schemaVersion: 1,
                        schemaHash: "hash-1",
                        fitTags: ["structured-output"],
                    },
                    isReference: true,
                },
            ],
            500,
            undefined,
            [{ field: "score", kind: "factual", spec: { matcher: "exact" } }],
            "user-1",
        );

        expect(runId).toBe("run-1");
        expect(getPipeline).not.toHaveBeenCalled();
    });

    it("freezes reasoning config into the run snapshot and run model rows", async () => {
        const reasoningConfig = { effort: "high" as const };

        const runId = await createRun(
            "team-1",
            "dataset-1",
            undefined,
            [
                {
                    modelId: "gpt-5.5",
                    promptVersionId: "pv-1",
                    schemaVersionId: "schema-version-1",
                    reasoningConfig,
                    isReference: false,
                },
            ],
            500,
            undefined,
            [{ field: "score", kind: "factual", spec: { matcher: "exact" } }],
            "user-1",
        );

        expect(runId).toBe("run-1");
        expect(capturedRunInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                configSnapshot: expect.objectContaining({
                    models: [
                        expect.objectContaining({
                            modelId: "gpt-5.5",
                            reasoningConfig,
                        }),
                    ],
                }),
            }),
        );
        expect(capturedModelInsert).toHaveBeenCalledWith([
            expect.objectContaining({
                modelId: "gpt-5.5",
                reasoningConfig,
            }),
        ]);
    });

    it("freezes a judge prompt version id separately from legacy judge configs", async () => {
        const runId = await createRun(
            "team-1",
            "dataset-1",
            undefined,
            [{ modelId: "gpt-4o", promptVersionId: "pv-1", isReference: true }],
            500,
            undefined,
            [{ field: "score", kind: "factual", spec: { matcher: "exact" } }],
            "user-1",
            "judge-pv-1",
        );

        expect(runId).toBe("run-1");
        expect(capturedRunInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                judgeConfigId: undefined,
                judgePromptVersionId: "judge-pv-1",
                configSnapshot: expect.objectContaining({
                    judgeConfigId: undefined,
                    judgePromptVersionId: "judge-pv-1",
                }),
            }),
        );
    });
});
