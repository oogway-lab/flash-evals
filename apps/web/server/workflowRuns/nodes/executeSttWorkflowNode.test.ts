import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IWorkflowNodeArtifact } from "@mosaic/api-contract";
import type { IWorkflowSnapshotNode } from "../../db/jsonTypes";

const mocks = vi.hoisted(() => ({
    transcribe: vi.fn(),
    persist: vi.fn(async (_checkpoint: unknown) => undefined),
}));

vi.mock("../../db/client", () => ({
    db: {
        update: () => ({
            set: (checkpoint: unknown) => ({
                where: () => mocks.persist(checkpoint),
            }),
        }),
    },
}));
vi.mock("../../audio/transcription", () => ({
    getOrCreateAudioTranscriptArtifactWithProvenance: mocks.transcribe,
}));

import { executeSttWorkflowNode } from "./executeSttWorkflowNode";

const node = {
    nodeKey: "stt",
    nodeType: "stt",
    nodeConfig: {
        type: "stt",
        sttConfig: { modelId: "openrouter/google/gemini-3.8-flash" },
    },
} as unknown as IWorkflowSnapshotNode;

function run(
    cell: {
        id: string;
        costUsd?: number | null;
        outputJson?: IWorkflowNodeArtifact;
    } = { id: "cell-1" },
) {
    return executeSttWorkflowNode({
        cell,
        item: {
            id: "item-1",
            storageKey: "audio/a.wav",
            mimeType: "audio/wav",
        },
        node,
        inputText: "",
        images: [],
        apiKeys: {},
        sttProviderKeys: {},
        labelsByItemId: new Map(),
        teamId: "team-1",
        projectId: "project-1",
    });
}

const artifact = {
    text: "hello",
    segments: [],
    speakers: [],
    warnings: [],
    providerMetadata: { costUsd: 0.05, costSource: "computed" as const },
};

describe("executeSttWorkflowNode cost", () => {
    beforeEach(() => {
        mocks.transcribe.mockReset();
        mocks.persist.mockClear();
    });

    it("retains paid chunks after a failure, resumes the same cell, and keeps another run's cache hit free", async () => {
        mocks.transcribe.mockImplementationOnce(async ({ onCostIncurred }) => {
            await onCostIncurred(0.02);
            throw new Error("later chunk failed");
        });
        await expect(run()).rejects.toThrow("later chunk failed");
        const checkpoint = mocks.persist.mock.calls[0]![0] as {
            costUsd: number;
            outputJson: IWorkflowNodeArtifact;
        };
        expect(checkpoint.costUsd).toBeCloseTo(0.02);
        mocks.transcribe.mockImplementationOnce(async ({ onCostIncurred }) => {
            await onCostIncurred(0.03);
            return {
                artifact,
                cacheHit: false,
                lookupLatencyMs: 1,
                incurredCostUsd: 0.03,
            };
        });
        expect(
            (await run({ id: "cell-1", ...checkpoint })).costUsd,
        ).toBeCloseTo(0.05);
        mocks.transcribe.mockResolvedValueOnce({
            artifact,
            cacheHit: true,
            lookupLatencyMs: 1,
            incurredCostUsd: 0,
        });
        expect((await run({ id: "another-cell" })).costUsd).toBe(0);
    });
    it("does not turn an earlier unknown charge into a complete known total on retry", async () => {
        mocks.transcribe.mockImplementationOnce(async ({ onCostIncurred }) => {
            await onCostIncurred(undefined);
            throw new Error("later chunk failed");
        });
        await expect(run()).rejects.toThrow();
        const checkpoint = mocks.persist.mock.calls[0]![0] as {
            costUsd: null;
            outputJson: IWorkflowNodeArtifact;
        };
        mocks.transcribe.mockImplementationOnce(async ({ onCostIncurred }) => {
            await onCostIncurred(0.03);
            return {
                artifact,
                cacheHit: false,
                lookupLatencyMs: 1,
                incurredCostUsd: 0.03,
            };
        });
        expect(
            (await run({ id: "cell-1", ...checkpoint })).costUsd,
        ).toBeUndefined();
    });

    it("charges nothing for a reused transcript but keeps its original cost", async () => {
        mocks.transcribe.mockResolvedValue({
            artifact,
            cacheHit: true,
            lookupLatencyMs: 1,
            incurredCostUsd: 0,
        });
        const result = await run();
        expect(result.costUsd).toBe(0);
        expect(result.artifact.providerMetadata).toMatchObject({
            costUsd: 0.05,
        });
    });

    it("charges only new chunk spend when a transcript resumes", async () => {
        mocks.transcribe.mockResolvedValue({
            artifact,
            cacheHit: false,
            lookupLatencyMs: 1,
            incurredCostUsd: 0.02,
        });
        expect((await run()).costUsd).toBe(0.02);
    });

    it("leaves cost unset when the provider reported none", async () => {
        mocks.transcribe.mockResolvedValue({
            artifact,
            cacheHit: false,
            lookupLatencyMs: 1,
            incurredCostUsd: undefined,
        });
        expect((await run()).costUsd).toBeUndefined();
    });
});
