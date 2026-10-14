import { afterEach, expect, it, vi } from "vitest";
import { transcribeOpenRouterAudio } from "./openrouterAudio.js";

afterEach(() => vi.unstubAllGlobals());

it.each(["नमस्ते", "வணக்கம்", "నమస్కారం", "নমস্কার"])(
    "rejects native-script drift: %s",
    async (text) => {
        vi.stubGlobal(
            "fetch",
            vi.fn(
                async () =>
                    new Response(
                        JSON.stringify({
                            choices: [
                                {
                                    finish_reason: "stop",
                                    message: { content: text },
                                },
                            ],
                        }),
                        { headers: { "Content-Type": "application/json" } },
                    ),
            ),
        );
        await expect(
            transcribeOpenRouterAudio({
                apiKey: "test",
                modelId: "google/gemini-3.8-flash",
                base64Data: "YXVkaW8=",
                mimeType: "audio/wav",
            }),
        ).rejects.toThrow("Latin-script output requirement");
    },
);

it("sends encoded audio to Gemini and preserves billed usage", async () => {
    const fetcher = vi.fn(
        async () =>
            new Response(
                JSON.stringify({
                    choices: [
                        {
                            finish_reason: "stop",
                            message: { content: "  Hello Flash Evals.  " },
                        },
                    ],
                    usage: {
                        prompt_tokens: 20,
                        completion_tokens: 10,
                        total_tokens: 30,
                        cost: 0.001,
                    },
                }),
                { headers: { "Content-Type": "application/json" } },
            ),
    );
    vi.stubGlobal("fetch", fetcher);
    const result = await transcribeOpenRouterAudio({
        apiKey: "test",
        modelId: "google/gemini-3.8-flash",
        base64Data: "YXVkaW8=",
        mimeType: "audio/wav",
        language: "ta",
    });
    expect(result).toEqual({
        text: "Hello Flash Evals.",
        usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
        costUsd: 0.001,
    });
    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("google/gemini-3.8-flash");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content).toContain("Latin alphabet");
    expect(body.messages[0].content).toContain("Vanakkam, meeting");
    expect(body.messages[1].content[0].text).toContain("ta-Latn");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body.messages[1].content[1]).toEqual({
        type: "input_audio",
        input_audio: {
            data: "YXVkaW8=",
            format: "wav",
        },
    });
});

it("rejects unsupported audio before sending a request", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(
        transcribeOpenRouterAudio({
            apiKey: "test",
            modelId: "google/gemini-3.8-flash",
            base64Data: "YXVkaW8=",
            mimeType: "audio/webm",
        }),
    ).rejects.toThrow("WAV or MP3");
    expect(fetcher).not.toHaveBeenCalled();
});

it("does not store a truncated transcript as a successful result", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: "length",
                                message: { content: "Incomplete" },
                            },
                        ],
                    }),
                    { headers: { "Content-Type": "application/json" } },
                ),
        ),
    );
    await expect(
        transcribeOpenRouterAudio({
            apiKey: "test",
            modelId: "google/gemini-3.8-flash",
            base64Data: "YXVkaW8=",
            mimeType: "audio/wav",
        }),
    ).rejects.toThrow("output token limit");
});

it("lets the caller raise the inline audio budget", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const oversized = "A".repeat(4 * Math.ceil((2 * 1024 * 1024) / 3) + 4);
    await expect(
        transcribeOpenRouterAudio({
            apiKey: "test",
            modelId: "google/gemini-3.8-flash",
            base64Data: oversized,
            mimeType: "audio/mpeg",
            maxAudioBytes: 2 * 1024 * 1024,
        }),
    ).rejects.toThrow("up to 2 MB");
    expect(fetcher).not.toHaveBeenCalled();
});

it("classifies SDK transport failures that carry no name or status", async () => {
    const { APIConnectionError, APIConnectionTimeoutError } =
        await import("openai");
    const { openAiTransportErrorClass } = await import("./openrouterAudio.js");
    expect(openAiTransportErrorClass(new APIConnectionTimeoutError())).toBe(
        "timeout",
    );
    expect(
        openAiTransportErrorClass(
            new APIConnectionError({ cause: new TypeError("fetch failed") }),
        ),
    ).toBe("connection");
    expect(openAiTransportErrorClass(new Error("Connection error."))).toBe(
        undefined,
    );
});
