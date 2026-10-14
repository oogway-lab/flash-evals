import { describe, expect, it, vi } from "vitest";
import {
    classifyTranscriptionError,
    TranscriptionAttemptsError,
    transcribeWithRetry,
} from "./retry";
import type { ITranscriptArtifact } from "./types";

const artifact: ITranscriptArtifact = {
    text: "hello",
    segments: [],
    speakers: [],
    warnings: [],
};

function statusError(status: number, name = "APIError") {
    return Object.assign(new Error(`${status} status code`), { status, name });
}

describe("classifyTranscriptionError transport errors", () => {
    it("reads socket codes nested two causes deep, as fetch reports them", () => {
        const socket = Object.assign(new Error("other side closed"), {
            code: "UND_ERR_SOCKET",
        });
        const fetchError = Object.assign(new TypeError("terminated"), {
            cause: socket,
        });
        const sdkError = Object.assign(new Error("Connection error."), {
            cause: fetchError,
        });
        expect(classifyTranscriptionError(sdkError)).toBe("connection");
    });
});

describe("classifyTranscriptionError", () => {
    it.each([
        [
            Object.assign(new Error("Request timed out."), {
                name: "APIConnectionTimeoutError",
            }),
            "timeout",
        ],
        [
            Object.assign(new Error("aborted"), { name: "AbortError" }),
            "timeout",
        ],
        [statusError(429), "rate_limit"],
        [statusError(503), "upstream_unavailable"],
        [statusError(504), "timeout"],
        [
            new Error("OpenRouter transcription failed (502): bad gateway"),
            "upstream_unavailable",
        ],
        [new TypeError("fetch failed"), "connection"],
        [statusError(400), "permanent"],
        [statusError(401), "permanent"],
        [
            new Error("OpenRouter transcription failed (413): too large"),
            "permanent",
        ],
        [
            new Error(
                "Gemini on OpenRouter accepts WAV or MP3 audio in Flash Evals.",
            ),
            "permanent",
        ],
    ])("classifies %s as %s", (error, expected) => {
        expect(classifyTranscriptionError(error)).toBe(expected);
    });
});

describe("transcribeWithRetry", () => {
    const sleep = vi.fn(async () => undefined);

    it("retries a timeout and records that its billing is unknown", async () => {
        const run = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(new Error("Request timed out."), {
                    name: "APIConnectionTimeoutError",
                }),
            )
            .mockResolvedValueOnce(artifact);
        const result = await transcribeWithRetry(run, {
            maxAttempts: 3,
            sleep,
            random: () => 0,
        });
        expect(result.artifact).toBe(artifact);
        expect(result.attempts).toMatchObject([
            {
                attempt: 1,
                outcome: "failed",
                errorClass: "timeout",
                billingUnknown: true,
            },
            { attempt: 2, outcome: "succeeded" },
        ]);
        expect(sleep).toHaveBeenCalledWith(1_000);
    });

    it("fails a permanent error without retrying", async () => {
        const run = vi.fn().mockRejectedValue(statusError(401));
        await expect(
            transcribeWithRetry(run, { maxAttempts: 3, sleep }),
        ).rejects.toBeInstanceOf(TranscriptionAttemptsError);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("stops at the attempt cap and reports possibly billed timeouts", async () => {
        const run = vi.fn().mockRejectedValue(
            Object.assign(new Error("Request timed out."), {
                name: "APIConnectionTimeoutError",
            }),
        );
        const error = await transcribeWithRetry(run, {
            maxAttempts: 2,
            sleep,
        }).catch((caught: unknown) => caught);
        expect(run).toHaveBeenCalledTimes(2);
        expect(error).toBeInstanceOf(TranscriptionAttemptsError);
        expect((error as Error).message).toBe(
            "Request timed out. (after 2 attempts) 2 timed-out requests may have been billed.",
        );
    });

    it("honors Retry-After up to the backoff cap", async () => {
        const run = vi
            .fn()
            .mockRejectedValueOnce(
                Object.assign(statusError(429), {
                    headers: new Headers({ "retry-after": "120" }),
                }),
            )
            .mockResolvedValueOnce(artifact);
        await transcribeWithRetry(run, { maxAttempts: 2, sleep });
        expect(sleep).toHaveBeenLastCalledWith(30_000);
    });
});
