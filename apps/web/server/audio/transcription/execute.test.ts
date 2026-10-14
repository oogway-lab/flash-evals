import { describe, expect, it, vi } from "vitest";
import { AUDIO_PREPARATION_VERSION, type PreparedAudio } from "../preparation";
import {
    cachedPreparationIsCurrent,
    chunkStorageKey,
    executeTranscription,
    type IChunkTranscriptStore,
} from "./execute";
import type { ITranscriptArtifact } from "./types";

const request = {
    modelId: "openrouter/google/gemini-3.8-flash",
    canonicalModelId: "google/gemini-3.8-flash",
    providerId: "openrouter" as const,
    language: undefined,
    openrouterApiKey: "key",
};

function transcript(text: string, costUsd?: number): ITranscriptArtifact {
    return {
        text,
        segments: [{ text, startMs: 0, endMs: 1_000 }],
        speakers: [],
        warnings: [],
        providerMetadata: {
            promptSupported: true,
            usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
            ...(costUsd !== undefined
                ? { costUsd, costSource: "computed" as const }
                : {}),
        },
    };
}

const prepared: Extract<PreparedAudio, { kind: "prepared" }> = {
    kind: "prepared",
    version: AUDIO_PREPARATION_VERSION,
    probe: { durationMs: 1_200_000, codec: "pcm_s16le", channels: 2 },
    chunks: [0, 1, 2].map((index) => ({
        index,
        startMs: index * 400_000,
        endMs: (index + 1) * 400_000,
        bytes: Buffer.from(`chunk-${index}`),
        mimeType: "audio/mpeg",
        hardCut: index === 1,
    })),
};

function memoryStore(seed: Record<string, ITranscriptArtifact> = {}) {
    const rows = new Map(Object.entries(seed));
    const store: IChunkTranscriptStore = {
        read: vi.fn(async (key: string) => rows.get(key)),
        write: vi.fn(async (key: string, artifact: ITranscriptArtifact) => {
            rows.set(key, artifact);
            return artifact;
        }),
    };
    return { store, rows };
}

const policy = { maxAttempts: 3, timeoutMs: 180_000, maxAudioBytes: 14 };

describe("executeTranscription", () => {
    it("sends audio within budget unchanged with the route's timeout", async () => {
        const dispatch = vi.fn(async () => transcript("whole", 0.01));
        const bytes = Buffer.from("wav");
        const result = await executeTranscription(
            {
                request,
                storageKey: "audio/a.wav",
                bytes,
                mimeType: "audio/wav",
                policy,
                chunkStore: memoryStore().store,
            },
            {
                dispatch,
                prepare: async () => ({ kind: "original" }),
            },
        );
        expect(dispatch).toHaveBeenCalledWith(
            expect.objectContaining({
                bytes,
                mimeType: "audio/wav",
                timeoutMs: 180_000,
                maxAudioBytes: 14,
            }),
        );
        expect(result.text).toBe("whole");
        expect(result.providerMetadata).toMatchObject({
            costUsd: 0.01,
            incurredCostUsd: 0.01,
            attempts: [{ attempt: 1, outcome: "succeeded" }],
        });
        expect(result.providerMetadata?.audioPreparation).toBeUndefined();
    });

    it("resumes after completed chunks and counts only new spend", async () => {
        const firstKey = chunkStorageKey(
            "audio/a.wav",
            prepared,
            prepared.chunks[0]!,
        );
        const { store } = memoryStore({ [firstKey]: transcript("one", 0.02) });
        const dispatch = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(new Error("Request timed out."), {
                    name: "APIConnectionTimeoutError",
                }),
            )
            .mockResolvedValueOnce(transcript("two", 0.03))
            .mockResolvedValueOnce(transcript("three", 0.04));
        const result = await executeTranscription(
            {
                request,
                storageKey: "audio/a.wav",
                bytes: Buffer.alloc(20 * 1024 * 1024),
                mimeType: "audio/wav",
                policy,
                chunkStore: store,
            },
            {
                dispatch,
                prepare: async () => prepared,
                retry: { sleep: async () => undefined },
            },
        );

        expect(dispatch).toHaveBeenCalledTimes(3);
        expect(
            dispatch.mock.calls.map(([input]) => String(input.bytes)),
        ).toEqual(["chunk-1", "chunk-1", "chunk-2"]);
        expect(store.write).toHaveBeenCalledTimes(2);
        expect(result.text).toBe("one\ntwo\nthree");
        expect(result.segments.map((segment) => segment.startMs)).toEqual([
            0, 400_000, 800_000,
        ]);
        expect(result.durationMs).toBe(1_200_000);
        const metadata = result.providerMetadata!;
        expect(metadata.costUsd).toBeCloseTo(0.09);
        expect(metadata.incurredCostUsd).toBeCloseTo(0.07);
        expect(metadata.costUncertain).toBe(true);
        expect(metadata.usage).toMatchObject({
            inputTokens: 30,
            totalTokens: 45,
        });
        expect(metadata.audioPreparation).toMatchObject({
            version: AUDIO_PREPARATION_VERSION,
            sourceDurationMs: 1_200_000,
            chunks: [
                { index: 0, cacheHit: true, attempts: 0 },
                { index: 1, cacheHit: false, attempts: 2, hardCut: true },
                { index: 2, cacheHit: false, attempts: 1 },
            ],
        });
        expect(result.warnings).toEqual(
            expect.arrayContaining([
                expect.stringContaining("may have been billed"),
                expect.stringContaining("no nearby silence"),
            ]),
        );
    });

    it("keeps completed chunks when a later chunk fails permanently", async () => {
        const { store, rows } = memoryStore();
        const dispatch = vi
            .fn()
            .mockResolvedValueOnce(transcript("one", 0.02))
            .mockRejectedValueOnce(
                new Error("OpenRouter transcription failed (400): bad audio"),
            );
        await expect(
            executeTranscription(
                {
                    request,
                    storageKey: "audio/a.wav",
                    bytes: Buffer.alloc(1),
                    mimeType: "audio/wav",
                    policy,
                    chunkStore: store,
                },
                { dispatch, prepare: async () => prepared },
            ),
        ).rejects.toThrow("bad audio");
        expect(dispatch).toHaveBeenCalledTimes(2);
        expect([...rows.keys()]).toEqual([
            chunkStorageKey("audio/a.wav", prepared, prepared.chunks[0]!),
        ]);
    });

    it("reports unavailable cost instead of zero when a chunk has no cost", async () => {
        const result = await executeTranscription(
            {
                request,
                storageKey: "audio/a.wav",
                bytes: Buffer.alloc(1),
                mimeType: "audio/wav",
                policy,
                chunkStore: memoryStore().store,
            },
            {
                dispatch: vi
                    .fn()
                    .mockResolvedValueOnce(transcript("one", 0.01))
                    .mockResolvedValueOnce(transcript("two"))
                    .mockResolvedValueOnce(transcript("three", 0.01)),
                prepare: async () => prepared,
            },
        );
        expect(result.providerMetadata?.costUsd).toBeUndefined();
        expect(result.providerMetadata?.costSource).toBe("unavailable");
        expect(result.providerMetadata?.incurredCostUsd).toBeUndefined();
    });
});

describe("cachedPreparationIsCurrent", () => {
    it("keeps legacy transcripts and rejects older preparation versions", () => {
        expect(cachedPreparationIsCurrent(transcript("legacy"))).toBe(true);
        const stale = transcript("old");
        stale.providerMetadata!.audioPreparation = {
            version: "speech-mp3.v0",
            sourceBytes: 1,
            sourceMimeType: "audio/wav",
            sourceDurationMs: 1,
            chunks: [],
        };
        expect(cachedPreparationIsCurrent(stale)).toBe(false);
    });
});
