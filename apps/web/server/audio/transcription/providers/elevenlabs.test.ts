import { Buffer } from "buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    ELEVENLABS_STT_URL,
    elevenLabsLanguageCode,
    elevenLabsSegments,
    transcribeWithElevenLabs,
} from "./elevenlabs";
import {
    EmptyTranscriptError,
    type ITranscriptionProviderInput,
} from "../types";

// Response shape from the API reference
// (https://elevenlabs.io/docs/api-reference/speech-to-text/convert).
// The values are made up; no real call was made.
const SCRIBE_RESPONSE = {
    language_code: "hin",
    language_probability: 0.91,
    text: "Namaste. Order kab aayega? Kal tak.",
    audio_duration_secs: 5.5,
    transcription_id: "tx-fake",
    words: [
        {
            text: "Namaste.",
            type: "word",
            start: 0.1,
            end: 0.6,
            speaker_id: "speaker_0",
            logprob: -0.1,
        },
        {
            text: " ",
            type: "spacing",
            start: 0.6,
            end: 0.7,
            speaker_id: "speaker_0",
            logprob: 0,
        },
        {
            text: "Order",
            type: "word",
            start: 0.7,
            end: 1.0,
            speaker_id: "speaker_0",
            logprob: -0.1,
        },
        {
            text: " ",
            type: "spacing",
            start: 1.0,
            end: 1.05,
            speaker_id: "speaker_0",
            logprob: 0,
        },
        {
            text: "kab",
            type: "word",
            start: 1.05,
            end: 1.3,
            speaker_id: "speaker_0",
            logprob: -0.2,
        },
        {
            text: " ",
            type: "spacing",
            start: 1.3,
            end: 1.35,
            speaker_id: "speaker_0",
            logprob: 0,
        },
        {
            text: "aayega?",
            type: "word",
            start: 1.35,
            end: 1.9,
            speaker_id: "speaker_0",
            logprob: -0.2,
        },
        {
            text: " ",
            type: "spacing",
            start: 1.9,
            end: 2.2,
            speaker_id: "speaker_1",
            logprob: 0,
        },
        {
            text: "Kal",
            type: "word",
            start: 2.2,
            end: 2.5,
            speaker_id: "speaker_1",
            logprob: -0.1,
        },
        {
            text: "(laughs)",
            type: "audio_event",
            start: 2.5,
            end: 2.8,
            speaker_id: "speaker_1",
            logprob: 0,
        },
        {
            text: " ",
            type: "spacing",
            start: 2.8,
            end: 2.85,
            speaker_id: "speaker_1",
            logprob: 0,
        },
        {
            text: "tak.",
            type: "word",
            start: 2.85,
            end: 3.2,
            speaker_id: "speaker_1",
            logprob: -0.1,
        },
    ],
};

function input(
    overrides: Partial<ITranscriptionProviderInput> = {},
): ITranscriptionProviderInput {
    return {
        bytes: Buffer.from("fake-audio"),
        mimeType: "audio/wav",
        modelId: "elevenlabs:scribe_v2",
        canonicalModelId: "scribe_v2",
        providerId: "elevenlabs",
        language: undefined,
        elevenlabsApiKey: "el-test",
        ...overrides,
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    });
}

const fetchMock = vi.fn();
beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("transcribeWithElevenLabs", () => {
    it("sends one multipart request with the run's options", async () => {
        fetchMock.mockResolvedValue(jsonResponse(SCRIBE_RESPONSE));
        await transcribeWithElevenLabs(
            input({
                language: "hi",
                config: {
                    diarization: true,
                    keywords: "Avalon, Brightwater, <bad>",
                },
            }),
        );
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(ELEVENLABS_STT_URL);
        expect(init.method).toBe("POST");
        expect(init.headers).toEqual({ "xi-api-key": "el-test" });
        const form = init.body as FormData;
        expect(form.get("model_id")).toBe("scribe_v2");
        expect(form.get("language_code")).toBe("hi");
        expect(form.get("diarize")).toBe("true");
        expect(form.get("timestamps_granularity")).toBe("word");
        expect(form.get("tag_audio_events")).toBe("false");
        // One form field per keyterm, as the official SDK sends them.
        expect(form.getAll("keyterms")).toEqual(["Avalon", "Brightwater"]);
        expect(form.get("file")).toBeInstanceOf(Blob);
    });

    it("sends a locale as the ISO language code ElevenLabs expects", async () => {
        fetchMock.mockResolvedValue(jsonResponse(SCRIBE_RESPONSE));
        await transcribeWithElevenLabs(input({ language: "hi-in" }));
        const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
            .body as FormData;
        expect(form.get("language_code")).toBe("hi");
        expect(elevenLabsLanguageCode("en_US")).toBe("en");
        expect(elevenLabsLanguageCode("hin")).toBe("hin");
        expect(elevenLabsLanguageCode(" ")).toBeUndefined();
    });

    it("fails an empty reply with the billed audio length", async () => {
        fetchMock.mockResolvedValue(
            jsonResponse({ text: " ", words: [], audio_duration_secs: 12.5 }),
        );
        const error = await transcribeWithElevenLabs(input()).catch(
            (caught: unknown) => caught,
        );
        expect(error).toBeInstanceOf(EmptyTranscriptError);
        expect((error as EmptyTranscriptError).durationMs).toBe(12_500);
    });

    it("leaves language, keyterms and diarization out when not asked for", async () => {
        fetchMock.mockResolvedValue(jsonResponse(SCRIBE_RESPONSE));
        await transcribeWithElevenLabs(input());
        const form = (fetchMock.mock.calls[0] as [string, RequestInit])[1]
            .body as FormData;
        expect(form.has("language_code")).toBe(false);
        expect(form.has("keyterms")).toBe(false);
        expect(form.get("diarize")).toBe("false");
    });

    it("maps words into speaker segments, language, duration and metadata", async () => {
        fetchMock.mockResolvedValue(jsonResponse(SCRIBE_RESPONSE));
        const artifact = await transcribeWithElevenLabs(
            input({ config: { diarization: true, keywords: "ok, <bad>" } }),
        );
        expect(artifact.text).toBe("Namaste. Order kab aayega? Kal tak.");
        expect(artifact.detectedLanguage).toBe("hin");
        expect(artifact.durationMs).toBe(5_500);
        expect(artifact.segments).toEqual([
            {
                text: "Namaste.",
                speaker: "speaker_0",
                startMs: 100,
                endMs: 600,
            },
            {
                text: "Order kab aayega?",
                speaker: "speaker_0",
                startMs: 700,
                endMs: 1_900,
            },
            {
                text: "Kal tak.",
                speaker: "speaker_1",
                startMs: 2_200,
                endMs: 3_200,
            },
        ]);
        expect(artifact.speakers).toEqual([
            { id: "speaker_0", label: "speaker_0" },
            { id: "speaker_1", label: "speaker_1" },
        ]);
        expect(artifact.providerMetadata).toEqual({
            diarizationMode: "native",
            raw: SCRIBE_RESPONSE,
        });
        expect(artifact.warnings).toEqual([
            expect.stringContaining("skipped 1 term(s)"),
        ]);
    });

    it("falls back to the last word's end time when no duration is given", async () => {
        const { audio_duration_secs: _unused, ...withoutDuration } =
            SCRIBE_RESPONSE;
        fetchMock.mockResolvedValue(jsonResponse(withoutDuration));
        const artifact = await transcribeWithElevenLabs(input());
        expect(artifact.durationMs).toBe(3_200);
        expect(artifact.providerMetadata?.diarizationMode).toBeUndefined();
    });

    it("needs a key before calling anyone", async () => {
        await expect(
            transcribeWithElevenLabs(input({ elevenlabsApiKey: undefined })),
        ).rejects.toThrow("Add your ElevenLabs API key in Settings");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
        [
            422,
            { detail: [{ loc: ["body", "model_id"], msg: "field required" }] },
            "ElevenLabs transcription failed (422): field required",
        ],
        [
            401,
            {
                detail: {
                    status: "invalid_api_key",
                    message: "Invalid API key",
                },
            },
            "ElevenLabs transcription failed (401): Invalid API key",
        ],
        [500, undefined, "ElevenLabs transcription failed (500)"],
    ])(
        "reports a %s error with the provider's message",
        async (status, body, message) => {
            fetchMock.mockResolvedValue(
                body === undefined
                    ? new Response("oops", { status })
                    : jsonResponse(body, status),
            );
            await expect(transcribeWithElevenLabs(input())).rejects.toThrow(
                message,
            );
        },
    );

    it("rejects an empty transcript and an unexpected multichannel reply", async () => {
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ ...SCRIBE_RESPONSE, text: " ", words: [] }),
        );
        await expect(transcribeWithElevenLabs(input())).rejects.toThrow(
            "empty text",
        );
        fetchMock.mockResolvedValueOnce(
            jsonResponse({ transcripts: [SCRIBE_RESPONSE] }),
        );
        await expect(transcribeWithElevenLabs(input())).rejects.toThrow(
            "multichannel",
        );
    });
});

describe("elevenLabsSegments", () => {
    it("splits on a long pause and keeps words without timing", () => {
        expect(
            elevenLabsSegments({
                words: [
                    { text: "one", type: "word", start: 0, end: 0.5 },
                    { text: " ", type: "spacing" },
                    { text: "two", type: "word", start: 2, end: 2.4 },
                    { text: " ", type: "spacing" },
                    { text: "three", type: "word" },
                    "not-a-word",
                ],
            }),
        ).toEqual([
            { text: "one", startMs: 0, endMs: 500 },
            { text: "two three", startMs: 2_000, endMs: 2_400 },
        ]);
        expect(elevenLabsSegments({})).toEqual([]);
    });
});
