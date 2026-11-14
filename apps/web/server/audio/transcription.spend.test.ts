import { beforeEach, expect, it, vi } from "vitest";
import { sttCostUsdForDuration } from "@flash-evals/api-contract";
import {
    EmptyTranscriptError,
    type ITranscriptArtifact,
} from "./transcription/types";
import type * as TranscriptionExecution from "./transcription/execute";

const mocks = vi.hoisted(() => ({
    rows: new Map<string, ITranscriptArtifact>(),
    dispatch: vi.fn(),
    prepare: vi.fn(),
}));
vi.mock("../db/client", () => ({ db: {} }));
vi.mock("./source", () => ({
    loadAudioBytes: async () => Buffer.from("audio"),
}));
vi.mock("./transcription/execute", async (original) => {
    const actual = await original<typeof TranscriptionExecution>();
    return {
        ...actual,
        executeTranscription: (
            input: Parameters<typeof actual.executeTranscription>[0],
        ) =>
            actual.executeTranscription(input, {
                prepare: mocks.prepare,
                dispatch: mocks.dispatch,
            }),
    };
});
vi.mock("./transcription/store", async (original) => ({
    ...(await original<object>()),
    readCachedTranscript: async ({ storageKey }: { storageKey: string }) =>
        mocks.rows.get(storageKey),
    writeCompletedTranscriptArtifact: async ({
        storageKey,
        artifact,
    }: {
        storageKey: string;
        artifact: ITranscriptArtifact;
    }) => {
        mocks.rows.set(storageKey, artifact);
        return artifact;
    },
    writeFailedTranscriptArtifact: async () => undefined,
}));
import { getOrCreateAudioTranscriptArtifactWithProvenance } from "./transcription";
import { AUDIO_PREPARATION_VERSION } from "./preparation";

beforeEach(() => {
    mocks.rows.clear();
    mocks.dispatch.mockReset();
    mocks.prepare.mockResolvedValue({
        kind: "prepared",
        version: AUDIO_PREPARATION_VERSION,
        probe: { durationMs: 1200000 },
        chunks: [0, 1].map((index) => ({
            index,
            startMs: index * 600000,
            endMs: (index + 1) * 600000,
            bytes: Buffer.from(`chunk${index}`),
            mimeType: "audio/mpeg",
            hardCut: false,
            silent: false,
        })),
    });
});

it("checkpoints each newly paid chunk before a later failure, without charging reused chunks or parent transcripts", async () => {
    const artifact = (text: string, costUsd: number): ITranscriptArtifact => ({
        text,
        segments: [],
        speakers: [],
        warnings: [],
        providerMetadata: { costUsd },
    });
    const onCostIncurred = vi.fn(async () => undefined);
    const input = {
        datasetItemId: "item",
        storageKey: "audio/example.wav",
        mimeType: "audio/wav",
        modelId: "openrouter:google/gemini-3.8-flash",
        openrouterApiKey: "fixture-key",
        onCostIncurred,
    };
    mocks.dispatch
        .mockResolvedValueOnce(artifact("one", 0.02))
        .mockRejectedValueOnce(
            new Error("OpenRouter transcription failed (400): bad audio"),
        );
    await expect(
        getOrCreateAudioTranscriptArtifactWithProvenance(input),
    ).rejects.toThrow("bad audio");
    expect(onCostIncurred.mock.calls).toEqual([[0.02]]);
    mocks.dispatch.mockResolvedValueOnce(artifact("two", 0.03));
    const resumed =
        await getOrCreateAudioTranscriptArtifactWithProvenance(input);
    expect(resumed.incurredCostUsd).toBeCloseTo(0.03);
    expect(onCostIncurred.mock.calls).toEqual([[0.02], [0.03]]);
    const cached =
        await getOrCreateAudioTranscriptArtifactWithProvenance(input);
    expect(cached.incurredCostUsd).toBe(0);
    expect(onCostIncurred).toHaveBeenCalledTimes(2);
    expect(mocks.dispatch).toHaveBeenCalledTimes(3);
});

it("records the charge for a billed reply with empty text, then fails", async () => {
    mocks.prepare.mockResolvedValue({ kind: "original" });
    const onCostIncurred = vi.fn(async () => undefined);
    mocks.dispatch.mockRejectedValueOnce(
        new EmptyTranscriptError(
            "ElevenLabs transcription returned empty text.",
            { durationMs: 600_000 },
        ),
    );
    await expect(
        getOrCreateAudioTranscriptArtifactWithProvenance({
            datasetItemId: "item",
            storageKey: "audio/silent.wav",
            mimeType: "audio/wav",
            modelId: "elevenlabs:scribe_v2",
            elevenlabsApiKey: "fixture-key",
            onCostIncurred,
        }),
    ).rejects.toThrow("returned empty text");
    const expected = sttCostUsdForDuration("elevenlabs:scribe_v2", 600_000);
    expect(expected).toBeGreaterThan(0);
    expect(onCostIncurred.mock.calls).toEqual([[expected]]);

    // A provider-reported price wins over the duration.
    mocks.dispatch.mockRejectedValueOnce(
        new EmptyTranscriptError(
            "OpenRouter transcription returned empty text.",
            {
                costUsd: 0.004,
            },
        ),
    );
    await expect(
        getOrCreateAudioTranscriptArtifactWithProvenance({
            datasetItemId: "item",
            storageKey: "audio/silent-2.wav",
            mimeType: "audio/wav",
            modelId: "elevenlabs:scribe_v2",
            elevenlabsApiKey: "fixture-key",
            onCostIncurred,
        }),
    ).rejects.toThrow("returned empty text");
    expect(onCostIncurred).toHaveBeenLastCalledWith(0.004);
});
