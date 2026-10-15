import { beforeEach, expect, it, vi } from "vitest";
import type { workflowRunItems } from "../db/schema";
import type { ITranscribeAudioInput } from "../audio/transcription/types";
import type { WorkflowDatasetItem } from "./audioPreparation";

const mocks = vi.hoisted(() => ({
    row: {} as Partial<typeof workflowRunItems.$inferSelect>,
    transcribe: vi.fn(),
}));
vi.mock("../db/client", () => ({
    db: {
        insert: () => ({
            values: () => ({ onConflictDoNothing: async () => undefined }),
        }),
        update: () => ({
            set: (values: Partial<typeof workflowRunItems.$inferSelect>) => ({
                where: () => ({
                    returning: async () => {
                        Object.assign(mocks.row, values);
                        return [mocks.row];
                    },
                    then: (resolve: (value: undefined) => unknown) => {
                        Object.assign(mocks.row, values);
                        return Promise.resolve(undefined).then(resolve);
                    },
                }),
            }),
        }),
    },
}));
vi.mock("../audio/transcription", () => ({
    getOrCreateAudioTranscriptArtifactWithProvenance: mocks.transcribe,
}));
vi.mock("../audio/transliteration", () => ({
    getOrCreateTransliteration: vi.fn(),
}));
import { resolveWorkflowItemInput } from "./audioPreparation";

const input = {
    workflowRunId: "run-1",
    item: {
        id: "item",
        type: "audio",
        storageKey: "audio/recording.wav",
        mimeType: "audio/wav",
    } as WorkflowDatasetItem,
    sttConfig: { modelId: "openrouter:google/gemini-3.8-flash" },
    sttProviderKeys: {},
    apiKeys: {},
};
beforeEach(() => {
    mocks.row = { id: "workflow-item", preparationStatus: "pending" };
    mocks.transcribe.mockReset();
});

it("preserves paid shared-preparation chunks through failure and retry", async () => {
    mocks.transcribe.mockImplementationOnce(
        async ({ onCostIncurred }: ITranscribeAudioInput) => {
            await onCostIncurred?.(0.02);
            throw new Error("second chunk failed");
        },
    );
    await expect(resolveWorkflowItemInput(input)).rejects.toThrow(
        "second chunk failed",
    );
    expect(mocks.row).toMatchObject({
        preparationStatus: "error",
        incurredCostUsd: 0.02,
        incurredCostSource: "computed",
    });
    mocks.transcribe.mockImplementationOnce(
        async ({ onCostIncurred }: ITranscribeAudioInput) => {
            await onCostIncurred?.(0.03);
            return {
                artifact: {
                    text: "one two",
                    segments: [],
                    speakers: [],
                    warnings: [],
                    providerMetadata: { costUsd: 0.05 },
                },
                cacheHit: false,
                lookupLatencyMs: 0,
                incurredCostUsd: 0.03,
            };
        },
    );
    await resolveWorkflowItemInput(input);
    expect(mocks.row.incurredCostUsd).toBeCloseTo(0.05);
    expect(mocks.row.preparationStatus).toBe("completed");
    mocks.row = { id: "another-workflow-item", preparationStatus: "pending" };
    mocks.transcribe.mockResolvedValueOnce({
        artifact: {
            text: "one two",
            segments: [],
            speakers: [],
            warnings: [],
            providerMetadata: { costUsd: 0.05 },
        },
        cacheHit: true,
        lookupLatencyMs: 0,
        incurredCostUsd: 0,
    });
    await resolveWorkflowItemInput({ ...input, workflowRunId: "another-run" });
    expect(mocks.row.incurredCostUsd).toBe(0);
});
