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
        ).toEqual({
            maxAttempts: 1,
            levelledAudioFormat: "flac",
            levelledAudioMaxBytes: 100 * 1024 * 1024,
            levelledAudioMaxDurationMs: 290 * 60_000,
        });
    });

    it("keeps levelled uploads under each provider's documented duration limit", () => {
        // Soniox async: 300 minutes per file.
        const soniox = sttExecutionPolicy(
            { providerId: "soniox", canonicalModelId: "stt-async-v5" },
            {},
        ).levelledAudioMaxDurationMs;
        expect(soniox).toBeLessThan(300 * 60_000);
        // Gemini API: 9.5 hours of audio per prompt.
        const gemini = sttExecutionPolicy(
            { providerId: "gemini", canonicalModelId: "gemini-3.8-flash" },
            {},
        ).levelledAudioMaxDurationMs;
        expect(gemini).toBe(9 * 3_600_000);
        expect(gemini).toBeLessThan(9.5 * 3_600_000);
        // ElevenLabs documents a 5 GB file limit and no duration limit; the
        // app keeps its own 100 MiB in-memory ceiling.
        expect(
            sttExecutionPolicy(
                { providerId: "elevenlabs", canonicalModelId: "scribe_v2" },
                {},
            ),
        ).toMatchObject({ levelledAudioMaxBytes: 100 * 1024 * 1024 });
    });

    it("gives every route a levelled upload budget under OpenAI's 25 MB limit where it applies", () => {
        const openai = sttExecutionPolicy(
            { providerId: "openai", canonicalModelId: "gpt-4o-transcribe" },
            {},
        );
        expect(openai.levelledAudioMaxBytes).toBe(23 * 1024 * 1024);
        expect(openai.levelledAudioMaxBytes).toBeLessThanOrEqual(25_000_000);
        for (const providerId of ["openrouter", "vercel-gateway"] as const) {
            expect(
                sttExecutionPolicy(
                    { providerId, canonicalModelId: "whisper-1" },
                    {},
                ).levelledAudioMaxBytes,
            ).toBe(23 * 1024 * 1024);
        }
    });

    it("limits levelled uploads of gpt-4o-transcribe models by duration on every route", () => {
        for (const [providerId, canonicalModelId] of [
            ["openai", "gpt-4o-transcribe"],
            ["openai", "gpt-4o-mini-transcribe"],
            ["openrouter", "openai/gpt-4o-mini-transcribe"],
            ["vercel-gateway", "openai/gpt-4o-transcribe"],
            // Dated snapshots of the same models.
            ["openai", "gpt-4o-mini-transcribe-2025-03-20"],
            ["openai", "gpt-4o-transcribe-2025-03-20"],
            ["openrouter", "openai/gpt-4o-mini-transcribe-2025-12-15"],
            ["openai", "gpt-4o-transcribe-diarize-2025-10-15"],
        ] as const) {
            const limit = sttExecutionPolicy(
                { providerId, canonicalModelId },
                {},
            ).levelledAudioMaxDurationMs;
            expect(limit).toBe(1_400_000);
            expect(limit!).toBeLessThan(1_500_000);
        }
        // whisper-1 and non-OpenAI models on the same routes are not split.
        for (const [providerId, canonicalModelId] of [
            ["openai", "whisper-1"],
            ["vercel-gateway", "openai/whisper-1"],
            ["openrouter", "whisper-large-v3-turbo"],
            ["openrouter", "google/gemini-3.8-flash"],
            ["openai", "gpt-4o-transcribe-preview"],
            ["openai", "gpt-4o-transcribe-2025"],
        ] as const) {
            expect(
                sttExecutionPolicy({ providerId, canonicalModelId }, {})
                    .levelledAudioMaxDurationMs,
            ).toBeUndefined();
        }
        expect(
            sttExecutionPolicy(
                { providerId: "elevenlabs", canonicalModelId: "scribe_v1" },
                {},
            ).levelledAudioMaxDurationMs,
        ).toBeUndefined();
    });

    it("uses the documented defaults for Gemini on OpenRouter", () => {
        const policy = sttExecutionPolicy(gemini, {});
        expect(policy).toMatchObject({
            maxAttempts: 3,
            timeoutMs: 180_000,
            maxAudioBytes: 14 * 1024 * 1024,
            levelledAudioFormat: "wav",
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
