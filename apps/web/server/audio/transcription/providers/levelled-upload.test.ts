import { Buffer } from "buffer";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ITranscriptionProviderInput } from "../types";
import { levelledAudioFormatFor } from "../policy";
import { LEVELLED_AUDIO_OUTPUTS } from "../../preparation/ffmpeg";

const doGenerate = vi.fn(async () => {
    throw new Error("stop after the request is built");
});
vi.mock("@ai-sdk/gateway", () => ({
    createGateway: () => ({ transcription: () => ({ doGenerate }) }),
}));

import { transcribeWithElevenLabs } from "./elevenlabs";
import { transcribeWithGemini } from "./gemini";
import { transcribeWithOpenAI } from "./openai";
import { transcribeWithOpenRouter } from "./openrouter";
import { transcribeWithSoniox } from "./soniox";
import { transcribeWithVercelGateway } from "./vercel-gateway";

// No provider is called: fetch is stubbed and fails after the request is
// captured, so only what each route would send is checked.
const FLAC = LEVELLED_AUDIO_OUTPUTS.flac.mimeType;

function input(
    overrides: Partial<ITranscriptionProviderInput>,
): ITranscriptionProviderInput {
    return {
        bytes: Buffer.from("fLaC-levelled"),
        mimeType: FLAC,
        modelId: "model",
        canonicalModelId: "model",
        providerId: "openai",
        language: undefined,
        ...overrides,
    };
}

function stubFetch() {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
        "fetch",
        vi.fn(async (url: string, init: RequestInit) => {
            calls.push({ url, init });
            return new Response("{}", { status: 500 });
        }),
    );
    return calls;
}

function uploadedFile(init: RequestInit | undefined): File {
    const file = (init?.body as FormData).get("file");
    if (!(file instanceof File)) throw new Error("no file part");
    return file;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});

describe("levelled audio format per route", () => {
    it("uses FLAC everywhere except Gemini on OpenRouter chat audio", () => {
        const format = (
            providerId: ITranscriptionProviderInput["providerId"],
            canonicalModelId: string,
        ) => levelledAudioFormatFor({ providerId, canonicalModelId });
        expect(format("openai", "gpt-4o-transcribe")).toBe("flac");
        expect(format("elevenlabs", "scribe_v2")).toBe("flac");
        expect(format("soniox", "stt-async-v5")).toBe("flac");
        expect(format("gemini", "gemini-2.5-flash")).toBe("flac");
        expect(format("vercel-gateway", "openai/whisper-1")).toBe("flac");
        expect(format("openrouter", "gpt-4o-transcribe")).toBe("flac");
        expect(format("openrouter", "google/gemini-3.8-flash")).toBe("wav");
    });

    it("FLAC output is audio/flac in a .flac file, WAV is audio/wav", () => {
        expect(LEVELLED_AUDIO_OUTPUTS.flac).toMatchObject({
            mimeType: "audio/flac",
            fileName: "levelled.flac",
        });
        expect(LEVELLED_AUDIO_OUTPUTS.wav).toMatchObject({
            mimeType: "audio/wav",
            fileName: "levelled.wav",
        });
    });
});

describe("levelled FLAC upload per provider", () => {
    it.each([
        [
            "OpenAI",
            () => transcribeWithOpenAI(input({ openaiApiKey: "test" })),
            "https://api.openai.com/v1/audio/transcriptions",
        ],
        [
            "ElevenLabs",
            () =>
                transcribeWithElevenLabs(
                    input({
                        providerId: "elevenlabs",
                        canonicalModelId: "scribe_v2",
                        elevenlabsApiKey: "test",
                    }),
                ),
            "https://api.elevenlabs.io/v1/speech-to-text",
        ],
        [
            "Soniox",
            () =>
                transcribeWithSoniox(
                    input({
                        providerId: "soniox",
                        canonicalModelId: "stt-async-v5",
                        sonioxApiKey: "test",
                    }),
                ),
            "https://api.soniox.com/v1/files",
        ],
        [
            "OpenRouter transcriptions",
            () =>
                transcribeWithOpenRouter(
                    input({
                        providerId: "openrouter",
                        canonicalModelId: "gpt-4o-transcribe",
                        openrouterApiKey: "test",
                    }),
                ),
            "https://openrouter.ai/api/v1/audio/transcriptions",
        ],
    ])(
        "%s uploads audio.flac as audio/flac",
        async (_name, transcribe, url) => {
            const calls = stubFetch();
            await expect(transcribe()).rejects.toThrow();
            expect(calls[0]?.url).toBe(url);
            const file = uploadedFile(calls[0]?.init);
            expect(file.name).toBe("audio.flac");
            expect(file.type).toBe("audio/flac");
        },
    );

    it("Gemini sends inline audio/flac", async () => {
        const calls = stubFetch();
        await expect(
            transcribeWithGemini(
                input({
                    providerId: "gemini",
                    canonicalModelId: "gemini-2.5-flash",
                    geminiApiKey: "test",
                }),
            ),
        ).rejects.toThrow();
        const body = JSON.parse(String(calls[0]?.init.body)) as {
            contents: Array<{
                parts: Array<{ inlineData?: { mimeType: string } }>;
            }>;
        };
        const audio = body.contents[0]?.parts.find((part) => part.inlineData);
        expect(audio?.inlineData?.mimeType).toBe("audio/flac");
    });

    it("Vercel Gateway passes audio/flac as the media type", async () => {
        await expect(
            transcribeWithVercelGateway(
                input({
                    providerId: "vercel-gateway",
                    canonicalModelId: "openai/whisper-1",
                    aiGatewayApiKey: "test",
                }),
            ),
        ).rejects.toThrow();
        expect(doGenerate).toHaveBeenCalledWith(
            expect.objectContaining({ mediaType: "audio/flac" }),
        );
    });
});
