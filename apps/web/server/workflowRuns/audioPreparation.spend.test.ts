import { beforeEach, expect, it, vi } from "vitest";
import type { workflowRunItems } from "../db/schema";
import type { ITranscribeAudioInput } from "../audio/transcription/types";
import type { WorkflowDatasetItem } from "./audioPreparation";
import type * as Transliteration from "../audio/transliteration";

const mocks = vi.hoisted(() => ({
    row: {} as Partial<typeof workflowRunItems.$inferSelect>,
    transcribe: vi.fn(),
    transliterate: vi.fn(),
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
vi.mock("../audio/transliteration", async (importActual) => ({
    ...(await importActual<typeof Transliteration>()),
    getOrCreateTransliteration: mocks.transliterate,
}));
import { TransliterationFailedError } from "../audio/transliteration";
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
    mocks.transliterate.mockReset();
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

it("adds the transliteration call to the item's spend, with its data rules", async () => {
    mocks.transcribe.mockResolvedValueOnce({
        artifact: {
            text: "क्या हाल है",
            segments: [],
            speakers: [],
            warnings: [],
            providerMetadata: { costUsd: 0.05 },
        },
        cacheHit: false,
        lookupLatencyMs: 0,
        incurredCostUsd: 0.05,
    });
    mocks.transliterate.mockResolvedValueOnce({
        text: "kya haal hai",
        costUsd: 0.004,
        incurredCostUsd: 0.004,
        cacheHit: false,
    });
    const resolved = await resolveWorkflowItemInput({
        ...input,
        sttConfig: {
            ...input.sttConfig,
            transcriptVariant: "latin",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
            },
        },
        dataPolicy: { zeroDataRetention: true },
    });
    expect(resolved.transcript).toBe("kya haal hai");
    expect(mocks.transliterate).toHaveBeenCalledWith(
        expect.objectContaining({ dataPolicy: { zeroDataRetention: true } }),
    );
    expect(mocks.row.incurredCostUsd).toBeCloseTo(0.054);
    expect(mocks.row.incurredCostSource).toBe("computed");
});

it("keeps the transcript's spend when the transliteration cost is unknown", async () => {
    mocks.transcribe.mockResolvedValueOnce({
        artifact: {
            text: "क्या हाल है",
            segments: [],
            speakers: [],
            warnings: [],
            providerMetadata: { costUsd: 0.05 },
        },
        cacheHit: false,
        lookupLatencyMs: 0,
        incurredCostUsd: 0.05,
    });
    mocks.transliterate.mockResolvedValueOnce({
        text: "kya haal hai",
        cacheHit: false,
    });
    await resolveWorkflowItemInput({
        ...input,
        sttConfig: {
            ...input.sttConfig,
            transcriptVariant: "latin",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                modelId: "unpriced/model",
            },
        },
    });
    // Known spend stays; the source says part of it is missing.
    expect(mocks.row.incurredCostUsd).toBeCloseTo(0.05);
    expect(mocks.row.incurredCostSource).toBe("unavailable");
    expect(mocks.row.preparationStatus).toBe("completed");
});

it("adds a failed transliteration's paid cost before failing the item", async () => {
    mocks.transcribe.mockResolvedValueOnce({
        artifact: {
            text: "क्या हाल है",
            segments: [],
            speakers: [],
            warnings: [],
            providerMetadata: { costUsd: 0.05 },
        },
        cacheHit: false,
        lookupLatencyMs: 0,
        incurredCostUsd: 0.05,
    });
    mocks.transliterate.mockRejectedValueOnce(
        new TransliterationFailedError("cut off", 0.004),
    );
    await expect(
        resolveWorkflowItemInput({
            ...input,
            sttConfig: {
                ...input.sttConfig,
                transcriptVariant: "latin",
                transliteration: {
                    enabled: true,
                    targetScript: "latin",
                    modelId: "gpt-4o-mini",
                },
            },
        }),
    ).rejects.toThrow("cut off");
    expect(mocks.row.incurredCostUsd).toBeCloseTo(0.054);
    expect(mocks.row.preparationStatus).toBe("error");
});

it("keeps levelling and the preparation record in the item's metadata", async () => {
    const audioPreparation = {
        version: "levelled.v2",
        volumeLevelling: "loudnorm=I=-23:TP=-2:LRA=11",
        sourceBytes: 10,
        sourceMimeType: "audio/wav",
        sourceDurationMs: 1_000,
        chunks: [],
    };
    mocks.transcribe.mockResolvedValueOnce({
        artifact: {
            text: "one two",
            segments: [],
            speakers: [],
            warnings: [],
            providerMetadata: {
                costUsd: 0.01,
                volumeLevelled: true,
                audioPreparation,
                raw: { requestId: "req-1", secret: "not kept" },
            },
        },
        cacheHit: false,
        lookupLatencyMs: 0,
        incurredCostUsd: 0.01,
    });
    await resolveWorkflowItemInput(input);
    expect(mocks.row.providerMetadata).toEqual({
        volumeLevelled: true,
        audioPreparation,
        requestId: "req-1",
    });
});
