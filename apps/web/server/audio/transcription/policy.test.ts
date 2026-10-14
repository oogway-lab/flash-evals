import { describe, expect, it } from "vitest";
import { sttExecutionPolicy } from "./policy";

const gemini = {
    providerId: "openrouter" as const,
    canonicalModelId: "google/gemini-3.8-flash",
};

describe("sttExecutionPolicy", () => {
    it("keeps single attempts and no preparation for other providers", () => {
        expect(
            sttExecutionPolicy(
                { providerId: "soniox", canonicalModelId: "stt-async-v5" },
                {},
            ),
        ).toEqual({ maxAttempts: 1 });
    });

    it("uses the documented defaults for Gemini on OpenRouter", () => {
        const policy = sttExecutionPolicy(gemini, {});
        expect(policy).toMatchObject({
            maxAttempts: 3,
            timeoutMs: 180_000,
            maxAudioBytes: 14 * 1024 * 1024,
            preparation: { maxBytes: 14 * 1024 * 1024, maxDurationMs: 600_000 },
        });
    });

    it("caps chunk length so an encoded chunk fits the byte budget", () => {
        const long = sttExecutionPolicy(gemini, {
            STT_AUDIO_MAX_CHUNK_MS: "3600000",
        });
        // 14 MiB at 48 kbps is about 40 minutes; keep 5% headroom.
        const maxMs = long.preparation!.maxDurationMs;
        expect(maxMs).toBeLessThan(3_600_000);
        expect((maxMs / 1000) * 6_000).toBeLessThanOrEqual(14 * 1024 * 1024);

        const small = sttExecutionPolicy(gemini, {
            STT_OPENROUTER_AUDIO_MAX_BYTES: String(2 * 1024 * 1024),
        });
        const smallMs = small.preparation!.maxDurationMs;
        expect(smallMs).toBeLessThan(600_000);
        expect((smallMs / 1000) * 6_000).toBeLessThanOrEqual(2 * 1024 * 1024);
    });

    it("clamps out-of-range values", () => {
        expect(
            sttExecutionPolicy(gemini, {
                STT_MAX_ATTEMPTS: "50",
                STT_REQUEST_TIMEOUT_MS: "5",
            }),
        ).toMatchObject({ maxAttempts: 5, timeoutMs: 10_000 });
    });
});
