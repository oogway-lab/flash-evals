import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IWorkflowSnapshotNode } from "../../db/jsonTypes";

const mocks = vi.hoisted(() => ({ transcribe: vi.fn() }));

vi.mock("../../db/client", () => ({ db: {} }));
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

function run() {
    return executeSttWorkflowNode({
        cell: { id: "cell-1" },
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
    beforeEach(() => mocks.transcribe.mockReset());

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
