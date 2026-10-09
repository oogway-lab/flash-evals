import { Buffer } from "buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    cachedRows: [] as Array<{
        transcript: string;
        detectedLanguage?: string | null;
    }>,
    selectError: undefined as Error | undefined,
    loadAudioBytes: vi.fn(),
    onConflictDoUpdate: vi.fn(async () => undefined),
    insertValues: vi.fn(),
}));

vi.mock("../db/client", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                where: vi.fn(() => ({
                    limit: vi.fn(async () => {
                        if (mocks.selectError) throw mocks.selectError;
                        return mocks.cachedRows;
                    }),
                })),
            })),
        })),
        insert: vi.fn(() => ({
            values: mocks.insertValues,
        })),
    },
}));

vi.mock("./source", () => ({
    loadAudioBytes: mocks.loadAudioBytes,
}));

import {
    getOrCreateAudioTranscript,
    getOrCreateAudioTranscriptArtifact,
    getOrCreateAudioTranscriptArtifactWithProvenance,
} from "./transcription";

beforeEach(() => {
    mocks.cachedRows = [];
    mocks.selectError = undefined;
    mocks.loadAudioBytes.mockReset();
    mocks.onConflictDoUpdate.mockClear();
    mocks.insertValues.mockReset();
    mocks.insertValues.mockReturnValue({
        onConflictDoUpdate: mocks.onConflictDoUpdate,
    });
    vi.stubGlobal("fetch", vi.fn());
});

describe("getOrCreateAudioTranscript", () => {
    it("reports cache provenance without changing the existing transcript API", async () => {
        mocks.cachedRows = [{ transcript: "cached text" }];

        await expect(
            getOrCreateAudioTranscriptArtifactWithProvenance({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
                openaiApiKey: "test-key",
            }),
        ).resolves.toEqual(
            expect.objectContaining({
                artifact: expect.objectContaining({ text: "cached text" }),
                cacheHit: true,
                lookupLatencyMs: expect.any(Number),
            }),
        );

        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
    });

    it("reports provider provenance for a cache miss", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: "new text" }), { status: 200 }),
        );

        await expect(
            getOrCreateAudioTranscriptArtifactWithProvenance({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
                openaiApiKey: "test-key",
            }),
        ).resolves.toEqual(
            expect.objectContaining({
                artifact: expect.objectContaining({
                    text: "new text",
                    providerMetadata: expect.objectContaining({
                        latencyMsTotal: expect.any(Number),
                    }),
                }),
                cacheHit: false,
                lookupLatencyMs: expect.any(Number),
            }),
        );
    });

    it("preserves the legacy dispatcher artifact on a cache miss", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: "new text" }), { status: 200 }),
        );

        const artifact = await getOrCreateAudioTranscriptArtifact({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/webm",
            modelId: "gpt-4o-mini-transcribe",
            language: "en",
            openaiApiKey: "test-key",
        });

        expect(artifact.text).toBe("new text");
        expect(artifact.detectedLanguage).toBeUndefined();
        expect(artifact.providerMetadata?.latencyMsTotal).toBeUndefined();
    });

    it("returns a cached transcript without loading or calling STT", async () => {
        mocks.cachedRows = [{ transcript: "cached text" }];

        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
                openaiApiKey: "test-key",
            }),
        ).resolves.toBe("cached text");

        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("transcribes, normalizes language, and upserts the transcript on cache miss", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: " transcript " }), {
                status: 200,
            }),
        );

        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
                language: " EN ",
                config: {
                    prompt: "Names: Acme",
                    keywords: "Avalon, Brightwater",
                },
                openaiApiKey: "test-key",
            }),
        ).resolves.toBe("transcript");

        expect(fetch).toHaveBeenCalledWith(
            "https://api.openai.com/v1/audio/transcriptions",
            expect.objectContaining({
                method: "POST",
                headers: { Authorization: "Bearer test-key" },
                signal: expect.any(AbortSignal),
            }),
        );
        const requestForm = vi.mocked(fetch).mock.calls[0]?.[1]
            ?.body as FormData;
        expect((requestForm.get("file") as File).name).toBe("audio.webm");
        expect(requestForm.get("model")).toBe("gpt-4o-mini-transcribe");
        expect(requestForm.get("language")).toBe("en");
        expect(requestForm.get("prompt")).toBe(
            "Names: Acme\nAvalon, Brightwater",
        );
        expect(requestForm.get("prompt")).not.toContain("Vocabulary:");
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                sttModelId: "gpt-4o-mini-transcribe",
                language: "en",
                transcript: "transcript",
            }),
        );
        expect(mocks.onConflictDoUpdate).toHaveBeenCalled();
    });

    it("fails before provider execution when the transcript schema is missing", async () => {
        mocks.selectError = Object.assign(new Error("relation missing"), {
            code: "42P01",
        });
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: " transcript " }), {
                status: 200,
            }),
        );

        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
                openaiApiKey: "test-key",
            }),
        ).rejects.toThrow("relation missing");

        expect(fetch).not.toHaveBeenCalled();
        expect(mocks.insertValues).not.toHaveBeenCalled();
    });

    it("fails when a completed transcript cannot be persisted", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        mocks.onConflictDoUpdate.mockRejectedValueOnce(
            Object.assign(new Error("relation missing"), { code: "42P01" }),
        );
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: " transcript " }), {
                status: 200,
            }),
        );

        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
                openaiApiKey: "test-key",
            }),
        ).rejects.toThrow("relation missing");
    });

    it("hashes the validated STT config for transcript cache identity", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: " transcript " }), {
                status: 200,
            }),
        );

        await getOrCreateAudioTranscript({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/webm",
            modelId: "gpt-4o-mini-transcribe",
            config: { prompt: "Names: Acme" },
            openaiApiKey: "test-key",
        });

        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                configJson: { prompt: "Names: Acme" },
                configHash: expect.any(String),
            }),
        );
    });

    it("persists normalized transcript text using the STT metric policy", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(JSON.stringify({ text: "Patient needs FIVE mg." }), {
                status: 200,
            }),
        );

        await getOrCreateAudioTranscript({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/webm",
            modelId: "gpt-4o-mini-transcribe",
            openaiApiKey: "test-key",
        });

        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                transcript: "Patient needs FIVE mg.",
                rawText: "Patient needs FIVE mg.",
                normalizedText: "patient needs 5 mg",
            }),
        );
    });

    it("requests OpenAI Whisper timestamps and persists returned word segments", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "hello world",
                    language: "en",
                    duration: 1.2,
                    words: [
                        { word: "hello", start: 0, end: 0.5 },
                        { word: "world", start: 0.55, end: 1.1 },
                    ],
                }),
                { status: 200 },
            ),
        );

        await getOrCreateAudioTranscript({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/webm",
            modelId: "whisper-1",
            config: { timestampGranularity: "word" },
            openaiApiKey: "test-key",
        });

        const requestForm = vi.mocked(fetch).mock.calls[0]?.[1]
            ?.body as FormData;
        expect(requestForm.get("model")).toBe("whisper-1");
        expect(requestForm.get("response_format")).toBe("verbose_json");
        expect(requestForm.get("timestamp_granularities[]")).toBe("word");
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                sttModelId: "whisper-1",
                configJson: { timestampGranularity: "word" },
                detectedLanguage: "en",
                segmentsJson: [
                    { text: "hello", startMs: 0, endMs: 500 },
                    { text: "world", startMs: 550, endMs: 1100 },
                ],
                providerMetadata: expect.objectContaining({
                    durationInSeconds: 1.2,
                }),
            }),
        );
    });

    it("requests and parses OpenAI diarized transcription", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "Hello there",
                    segments: [
                        {
                            id: "seg-1",
                            speaker: "A",
                            start: 0.1,
                            end: 0.8,
                            text: "Hello",
                        },
                        {
                            id: "seg-2",
                            speaker: "B",
                            start: 0.9,
                            end: 1.4,
                            text: "there",
                        },
                    ],
                }),
                { status: 200 },
            ),
        );

        const artifact = await getOrCreateAudioTranscriptArtifact({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/wav",
            modelId: "openai:gpt-4o-transcribe-diarize",
            config: { temperature: 0.2 },
            openaiApiKey: "test-key",
        });

        const requestForm = vi.mocked(fetch).mock.calls[0]?.[1]
            ?.body as FormData;
        expect(requestForm.get("model")).toBe("gpt-4o-transcribe-diarize");
        expect(requestForm.get("response_format")).toBe("diarized_json");
        expect(requestForm.get("chunking_strategy")).toBe("auto");
        expect(requestForm.get("prompt")).toBeNull();
        expect(requestForm.get("temperature")).toBe("0.2");
        expect(artifact).toEqual(
            expect.objectContaining({
                text: "Hello there",
                segments: [
                    { text: "Hello", speaker: "A", startMs: 100, endMs: 800 },
                    { text: "there", speaker: "B", startMs: 900, endMs: 1400 },
                ],
                speakers: [
                    { id: "A", label: "A" },
                    { id: "B", label: "B" },
                ],
                providerMetadata: expect.objectContaining({
                    diarizationMode: "native",
                }),
            }),
        );
    });

    it("captures token usage from gpt-4o-transcribe responses", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "Hello there",
                    usage: {
                        type: "tokens",
                        input_tokens: 1210,
                        output_tokens: 42,
                        total_tokens: 1252,
                    },
                }),
                { status: 200 },
            ),
        );

        const artifact = await getOrCreateAudioTranscriptArtifact({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/wav",
            modelId: "gpt-4o-transcribe",
            config: {},
            openaiApiKey: "test-key",
        });

        expect(artifact.providerMetadata?.usage).toEqual({
            inputTokens: 1210,
            outputTokens: 42,
            totalTokens: 1252,
        });
    });

    it("leaves usage undefined for duration-billed transcription responses", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "Hello there",
                    usage: { type: "duration", seconds: 61 },
                }),
                { status: 200 },
            ),
        );

        const artifact = await getOrCreateAudioTranscriptArtifact({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/wav",
            modelId: "whisper-1",
            config: {},
            openaiApiKey: "test-key",
        });

        expect(artifact.providerMetadata?.usage).toBeUndefined();
    });

    it("transcribes through OpenRouter without sending ignored prompt fields", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: "open router transcript",
                    language: "en",
                    words: [{ word: "open", start: 0, end: 0.4 }],
                    usage: {
                        input_tokens: 96,
                        output_tokens: 12,
                        total_tokens: 108,
                        cost: 0.00003,
                    },
                }),
                { status: 200 },
            ),
        );

        const artifact = await getOrCreateAudioTranscriptArtifact({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/wav",
            modelId: "openrouter:whisper-large-v3-turbo",
            language: "en",
            config: { temperature: 0.1, timestampGranularity: "word" },
            openrouterApiKey: "openrouter-test",
        });

        expect(fetch).toHaveBeenCalledWith(
            "https://openrouter.ai/api/v1/audio/transcriptions",
            expect.objectContaining({
                headers: { Authorization: "Bearer openrouter-test" },
            }),
        );
        const requestForm = vi.mocked(fetch).mock.calls[0]?.[1]
            ?.body as FormData;
        expect(requestForm.get("model")).toBe("openai/whisper-large-v3-turbo");
        expect(requestForm.get("prompt")).toBeNull();
        expect(requestForm.get("timestamp_granularities[]")).toBe("word");
        expect(artifact.providerMetadata).toEqual(
            expect.objectContaining({
                promptSupported: false,
                usage: {
                    inputTokens: 96,
                    outputTokens: 12,
                    totalTokens: 108,
                },
                costUsd: 0.00003,
                costSource: "computed",
            }),
        );
    });

    it("transcribes through Gemini structured output and records thinking usage", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            text: "Gemini transcript",
                                            segments: [
                                                {
                                                    speaker: "A",
                                                    text: "Gemini transcript",
                                                    startMs: 10,
                                                },
                                            ],
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                    usageMetadata: {
                        promptTokenCount: 96,
                        candidatesTokenCount: 20,
                        thoughtsTokenCount: 12,
                        totalTokenCount: 128,
                    },
                }),
                { status: 200 },
            ),
        );

        const artifact = await getOrCreateAudioTranscriptArtifact({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/x-wav",
            modelId: "gemini:gemini-2.5-flash",
            config: {
                prompt: "Preserve product names.",
                diarization: true,
                timestampGranularity: "word",
                temperature: 0.25,
                thinkingBudgetTokens: 1234,
            },
            geminiApiKey: "gemini-test",
        });

        const request = vi.mocked(fetch).mock.calls[0];
        expect(request[0]).toBe(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        );
        const body = JSON.parse(String(request[1]?.body)) as {
            generationConfig: Record<string, unknown>;
            contents: Array<{
                parts: Array<{
                    text?: string;
                    inlineData?: { mimeType: string };
                }>;
            }>;
        };
        expect(body.generationConfig).toEqual(
            expect.objectContaining({
                responseMimeType: "application/json",
                maxOutputTokens: 32768,
                temperature: 0.25,
                thinkingConfig: { thinkingBudget: 1234 },
            }),
        );
        expect(body.contents[0]?.parts[1]?.inlineData?.mimeType).toBe(
            "audio/wav",
        );
        expect(body.contents[0]?.parts[0]?.text).toContain(
            "one segment per spoken word",
        );
        expect(artifact).toEqual(
            expect.objectContaining({
                text: "Gemini transcript",
                segments: [
                    { text: "Gemini transcript", speaker: "A", startMs: 10 },
                ],
                providerMetadata: expect.objectContaining({
                    diarizationMode: "prompt-derived",
                    usage: {
                        inputTokens: 96,
                        outputTokens: 20,
                        thinkingTokens: 12,
                        totalTokens: 128,
                    },
                }),
            }),
        );
    });

    it("rejects invalid stored config before loading audio or calling providers", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "soniox:stt-async-v5",
                config: { context: 42, diarization: "true" },
                sonioxApiKey: "soniox-test",
            }),
        ).rejects.toThrow(
            "Invalid STT config for soniox:stt-async-v5: Context must be text. Diarization must be true or false.",
        );

        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("transcribes through Vercel Gateway for Gateway STT model ids", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch).mockResolvedValue(
            new Response(
                JSON.stringify({
                    text: " gateway transcript ",
                    language: "en",
                }),
                {
                    status: 200,
                },
            ),
        );

        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "vercel:openai/whisper-1",
                config: { timestampGranularity: "word" },
                aiGatewayApiKey: "vck-test",
            }),
        ).resolves.toBe("gateway transcript");

        expect(fetch).toHaveBeenCalledWith(
            "https://ai-gateway.vercel.sh/v4/ai/transcription-model",
            expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({
                    authorization: "Bearer vck-test",
                    "content-type": "application/json",
                    "ai-model-id": "openai/whisper-1",
                    "ai-transcription-model-specification-version": "4",
                }),
                body: JSON.stringify({
                    audio: Buffer.from("audio").toString("base64"),
                    mediaType: "audio/webm",
                    providerOptions: {
                        openai: {
                            timestampGranularities: ["word"],
                        },
                    },
                }),
            }),
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                sttModelId: "vercel:openai/whisper-1",
                configJson: { timestampGranularity: "word" },
                language: "",
                detectedLanguage: "en",
                transcript: "gateway transcript",
            }),
        );
    });

    it("requires the Gateway key for Vercel STT model ids", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "vercel:openai/gpt-4o-transcribe",
            }),
        ).rejects.toThrow(
            "Add AI_GATEWAY_API_KEY to run Vercel Gateway transcription.",
        );
        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects language overrides that the selected STT route does not support", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "vercel:openai/whisper-1",
                language: "hi",
                aiGatewayApiKey: "vck-test",
            }),
        ).rejects.toThrow(
            "STT model vercel:openai/whisper-1 does not support an audio language override.",
        );

        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("transcribes through Soniox async file transcription", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch)
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ id: "file-1" }), { status: 200 }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ id: "tx-1", status: "queued" }), {
                    status: 201,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ id: "tx-1", status: "completed" }),
                    {
                        status: 200,
                    },
                ),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({
                        id: "tx-1",
                        text: " soniox text ",
                        tokens: [
                            {
                                text: "soniox",
                                speaker: "S1",
                                start_ms: 0,
                                end_ms: 400,
                                language: "en",
                            },
                            {
                                text: "text",
                                speaker: "S1",
                                start_ms: 420,
                                end_ms: 800,
                                language: "en",
                            },
                        ],
                    }),
                    {
                        status: 200,
                    },
                ),
            );

        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "soniox:stt-async-v5",
                language: "hi",
                config: {
                    context: "Acme terms",
                    keywords: "Avalon, Brightwater, Avalon",
                    diarization: false,
                },
                sonioxApiKey: "soniox-test",
            }),
        ).resolves.toBe("soniox text");

        expect(fetch).toHaveBeenNthCalledWith(
            1,
            "https://api.soniox.com/v1/files",
            expect.objectContaining({
                method: "POST",
                headers: { Authorization: "Bearer soniox-test" },
                body: expect.any(FormData),
                signal: expect.any(AbortSignal),
            }),
        );
        expect(fetch).toHaveBeenNthCalledWith(
            2,
            "https://api.soniox.com/v1/transcriptions",
            expect.objectContaining({
                method: "POST",
                headers: {
                    Authorization: "Bearer soniox-test",
                    "Content-Type": "application/json",
                },
                signal: expect.any(AbortSignal),
            }),
        );
        const createBody = JSON.parse(
            vi.mocked(fetch).mock.calls[1]?.[1]?.body as string,
        ) as Record<string, unknown>;
        expect(createBody).toEqual({
            model: "stt-async-v5",
            file_id: "file-1",
            language_hints: ["hi"],
            enable_speaker_diarization: false,
            enable_language_identification: true,
            context: {
                text: "Acme terms",
                terms: ["Avalon", "Brightwater"],
            },
        });
        expect(fetch).toHaveBeenNthCalledWith(
            3,
            "https://api.soniox.com/v1/transcriptions/tx-1",
            expect.objectContaining({
                method: "GET",
                headers: { Authorization: "Bearer soniox-test" },
                signal: expect.any(AbortSignal),
            }),
        );
        expect(fetch).toHaveBeenNthCalledWith(
            4,
            "https://api.soniox.com/v1/transcriptions/tx-1/transcript",
            expect.objectContaining({
                method: "GET",
                headers: { Authorization: "Bearer soniox-test" },
                signal: expect.any(AbortSignal),
            }),
        );
        expect(mocks.insertValues).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                providerId: "soniox",
                routeId: "soniox-async-file-transcription",
                sttModelId: "soniox:stt-async-v5",
                canonicalModelId: "stt-async-v5",
                language: "hi",
                configHash: expect.any(String),
                configJson: {
                    context: "Acme terms",
                    keywords: "Avalon, Brightwater, Avalon",
                    diarization: false,
                },
                transcript: "soniox text",
                rawText: "soniox text",
                normalizedText: "soniox text",
                detectedLanguage: "en",
                segmentsJson: [
                    {
                        text: "soniox text",
                        speaker: "S1",
                        startMs: 0,
                        endMs: 800,
                        language: "en",
                    },
                ],
                speakersJson: [{ id: "S1", label: "S1" }],
                providerMetadata: {
                    provider: "soniox",
                    route: "soniox-async-file-transcription",
                    model: "stt-async-v5",
                    configHash: expect.any(String),
                    latencyMsTotal: expect.any(Number),
                    // Soniox reports no audio length, so duration comes from the
                    // final token offset (800ms here) and is priced per hour.
                    audioDurationMs: 800,
                    costSource: "computed",
                    costUsd: (800 / 3_600_000) * 0.1,
                    raw: expect.objectContaining({ id: "tx-1" }),
                },
                warnings: [],
                status: "completed",
                error: null,
            }),
        );
    });

    it("defaults Soniox diarization off when the run config omits the toggle", async () => {
        mocks.loadAudioBytes.mockResolvedValue(Buffer.from("audio"));
        vi.mocked(fetch)
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ id: "file-1" }), { status: 200 }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ id: "tx-1" }), { status: 200 }),
            )
            .mockResolvedValueOnce(
                new Response(JSON.stringify({ status: "completed" }), {
                    status: 200,
                }),
            )
            .mockResolvedValueOnce(
                new Response(
                    JSON.stringify({ text: "soniox text", tokens: [] }),
                    {
                        status: 200,
                    },
                ),
            );

        await getOrCreateAudioTranscript({
            datasetItemId: "item-1",
            storageKey: "11111111-1111-4111-8111-111111111111",
            mimeType: "audio/webm",
            modelId: "soniox:stt-async-v5",
            config: { context: "Acme terms" },
            sonioxApiKey: "soniox-test",
        });

        const createBody = JSON.parse(
            vi.mocked(fetch).mock.calls[1]?.[1]?.body as string,
        ) as Record<string, unknown>;
        expect(createBody.enable_speaker_diarization).toBe(false);
    });

    it("requires the Soniox key for Soniox STT model ids", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "soniox:stt-async-v5",
            }),
        ).rejects.toThrow("Add SONIOX_API_KEY to run Soniox transcription.");
        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("requires the OpenAI key on cache miss before loading audio", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "gpt-4o-mini-transcribe",
            }),
        ).rejects.toThrow("Add OPENAI_API_KEY to run audio transcription.");

        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("requires the OpenRouter key for OpenRouter STT model ids", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "openrouter:whisper-large-v3-turbo",
            }),
        ).rejects.toThrow(
            "Add OPENROUTER_API_KEY to run OpenRouter transcription.",
        );
        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });

    it("does not route unknown provider ids through OpenAI fallback", async () => {
        await expect(
            getOrCreateAudioTranscript({
                datasetItemId: "item-1",
                storageKey: "11111111-1111-4111-8111-111111111111",
                mimeType: "audio/webm",
                modelId: "unknown-vendor:stt-unverified",
                openaiApiKey: "test-key",
            }),
        ).rejects.toThrow(
            "STT model unknown-vendor:stt-unverified is not enabled for uploaded-audio transcription.",
        );

        expect(mocks.loadAudioBytes).not.toHaveBeenCalled();
        expect(fetch).not.toHaveBeenCalled();
    });
});
