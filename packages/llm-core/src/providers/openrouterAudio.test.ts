import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { transcribeOpenRouterAudio } from "./openrouterAudio.js";

beforeEach(() => {
    vi.stubEnv("MOSAIC_GATEWAY_HTTP_REFERER", "");
    vi.stubEnv("MOSAIC_GATEWAY_APP_TITLE", "");
    vi.stubEnv("MOSAIC_PROVIDER_ATTRIBUTION", "");
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
});

it.each(["नमस्ते", "வணக்கம்", "నమస్కారం", "নমস্কার", "vanakkam்"])(
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
    const headers = new Headers(options?.headers);
    expect(headers.get("http-referer")).toBe("https://flashevals.dev");
    expect(headers.get("x-title")).toBe("Flash Evals");
    const body = JSON.parse(String(options?.body));
    expect(body.model).toBe("google/gemini-3.8-flash");
    expect(body.reasoning).toEqual({ effort: "low" });
    expect(body.temperature).toBe(0);
    expect(body.messages[0].content).toContain("Latin alphabet");
    expect(body.messages[0].content).toContain("return exactly [no speech]");
    expect(body.messages[0].content).toContain(
        "Use [inaudible] only when speech is present",
    );
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

it("repairs native fragments without changing Latin text and accounts for both calls", async () => {
    const outputs = [
        "Total 2.5 Cr, ஏன்னா budget. cafe\u0301வணக்கம்!",
        JSON.stringify({ replacements: ["enna", "vanakkam"] }),
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: "stop",
                                message: { content: outputs.shift() },
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
        ),
    );
    const result = await transcribeOpenRouterAudio({
        apiKey: "test",
        modelId: "google/gemini-3.8-flash",
        base64Data: "YXVkaW8=",
        mimeType: "audio/wav",
    });
    expect(result).toMatchObject({
        text: "Total 2.5 Cr, enna budget. cafe\u0301vanakkam!",
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60 },
        costUsd: 0.002,
        scriptRepair: {
            modelId: "google/gemini-3.5-flash-lite",
            fragmentCount: 2,
        },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    const repair = JSON.parse(
        String(vi.mocked(fetch).mock.calls[1]?.[1]?.body),
    );
    expect(repair.model).toBe("google/gemini-3.5-flash-lite");
    expect(repair).not.toHaveProperty("reasoning");
    expect(repair).not.toHaveProperty("reasoning_effort");
    expect(JSON.stringify(repair.messages)).not.toContain("input_audio");
});

it.each([
    { replacements: [] },
    { replacements: [""] },
    { replacements: ["வணக்கம்"] },
])("rejects incomplete or non-Latin repairs: %j", async (repair) => {
    const outputs = ["Hello வணக்கம்", JSON.stringify(repair)];
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: "stop",
                                message: { content: outputs.shift() },
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
    expect(vi.mocked(fetch).mock.calls.length).toBeLessThanOrEqual(3);
});

it("keeps the total cost unknown when repair billing is missing", async () => {
    const responses = [
        {
            choices: [
                { finish_reason: "stop", message: { content: "வணக்கம்" } },
            ],
            usage: {
                prompt_tokens: 10,
                completion_tokens: 10,
                total_tokens: 20,
                cost: 0.001,
            },
        },
        {
            choices: [
                {
                    finish_reason: "stop",
                    message: {
                        content: JSON.stringify({ replacements: ["vanakkam"] }),
                    },
                },
            ],
        },
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(JSON.stringify(responses.shift()), {
                    headers: { "Content-Type": "application/json" },
                }),
        ),
    );
    const result = await transcribeOpenRouterAudio({
        apiKey: "test",
        modelId: "google/gemini-3.8-flash",
        base64Data: "YXVkaW8=",
        mimeType: "audio/wav",
    });
    expect(result.text).toBe("vanakkam");
    expect(result.costUsd).toBeUndefined();
    expect(result.usage.totalTokens).toBeUndefined();
});

it("batches large script repairs while preserving transcript order and total billing", async () => {
    const native = Array.from({ length: 65 }, (_, i) =>
        String.fromCodePoint(0x4e00 + i),
    );
    const outputs = [
        native.join(" "),
        ...[32, 32, 1].map((count) =>
            JSON.stringify({
                replacements: Array.from({ length: count }, () => "word"),
            }),
        ),
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: "stop",
                                message: { content: outputs.shift() },
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
        ),
    );
    const result = await transcribeOpenRouterAudio({
        apiKey: "test",
        modelId: "google/gemini-3.8-flash",
        base64Data: "YXVkaW8=",
        mimeType: "audio/wav",
    });
    expect(result.text).toBe(native.map(() => "word").join(" "));
    expect(result.costUsd).toBe(0.004);
    expect(result.usage.totalTokens).toBe(120);
    expect(fetch).toHaveBeenCalledTimes(4);
});

it("corrects only invalid replacements once and includes correction billing", async () => {
    const outputs = [
        "Hello வணக்கம் வை!",
        JSON.stringify({ replacements: ["vanakkam", "vaை"] }),
        JSON.stringify({ replacements: ["vai"] }),
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: "stop",
                                message: { content: outputs.shift() },
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
        ),
    );
    const result = await transcribeOpenRouterAudio({
        apiKey: "test",
        modelId: "google/gemini-3.8-flash",
        base64Data: "YXVkaW8=",
        mimeType: "audio/wav",
    });
    expect(result.text).toBe("Hello vanakkam vai!");
    expect(result.costUsd).toBe(0.003);
    expect(fetch).toHaveBeenCalledTimes(3);
    const correction = JSON.parse(
        String(vi.mocked(fetch).mock.calls[2]?.[1]?.body),
    );
    expect(JSON.parse(correction.messages[1].content).fragments).toEqual([
        "வை",
    ]);
});

it("gives malformed repair JSON one bounded correction attempt", async () => {
    const outputs = [
        "Hello வணக்கம்!",
        "not JSON",
        JSON.stringify({ replacements: ["vanakkam"] }),
    ];
    vi.stubGlobal(
        "fetch",
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        choices: [
                            {
                                finish_reason: "stop",
                                message: { content: outputs.shift() },
                            },
                        ],
                        usage: { cost: 0.001 },
                    }),
                    { headers: { "Content-Type": "application/json" } },
                ),
        ),
    );
    const result = await transcribeOpenRouterAudio({
        apiKey: "test",
        modelId: "google/gemini-3.8-flash",
        base64Data: "YXVkaW8=",
        mimeType: "audio/wav",
    });
    expect(result.text).toBe("Hello vanakkam!");
    expect(result.costUsd).toBe(0.003);
    expect(fetch).toHaveBeenCalledTimes(3);
});
