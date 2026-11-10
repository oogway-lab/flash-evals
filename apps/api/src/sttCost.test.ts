import { describe, expect, it } from "vitest";
import {
    sttAudioHourPriceUsdForId,
    sttCostUsdForDuration,
} from "@flash-evals/api-contract";

describe("STT audio-duration pricing", () => {
    it("prices a known model from its audio length", () => {
        // 23.93 minutes of audio at $0.10/hour — the real Soniox run this
        // pricing was derived against.
        expect(
            sttCostUsdForDuration("soniox:stt-async-v5", 1_435_590),
        ).toBeCloseTo(0.03988, 5);
    });

    it.each([
        ["whisper-1", 0.36],
        ["gpt-4o-transcribe", 0.36],
        ["gpt-4o-mini-transcribe", 0.18],
        ["soniox:stt-async-v5", 0.1],
        ["elevenlabs:scribe_v2", 0.22],
    ])("prices %s at $%s per audio hour", (modelId, perHour) => {
        expect(sttAudioHourPriceUsdForId(modelId)).toBe(perHour);
    });

    it.each([
        // Token-billed; the audio-to-token ratio is unpublished.
        "openrouter:whisper-large-v3-turbo",
        "bifrost:whisper-large-v3-turbo",
        // The gateway supplies its own live pricing metadata.
        "vercel:openai/whisper-1",
        // No separately published rate.
        "openai:gpt-4o-transcribe-diarize",
    ])("leaves %s unpriced rather than inventing a rate", (modelId) => {
        // Better no number than a wrong one: an invented rate would silently
        // skew every cost comparison it feeds.
        expect(sttAudioHourPriceUsdForId(modelId)).toBeUndefined();
        expect(sttCostUsdForDuration(modelId, 1_435_590)).toBeUndefined();
    });

    it("scales linearly with audio length", () => {
        const hour = sttCostUsdForDuration("whisper-1", 3_600_000);
        const halfHour = sttCostUsdForDuration("whisper-1", 1_800_000);
        expect(hour).toBeCloseTo(0.36, 6);
        expect(halfHour).toBeCloseTo(0.18, 6);
    });

    it.each([undefined, 0, -1])(
        "returns undefined for duration %s",
        (durationMs) => {
            expect(
                sttCostUsdForDuration("soniox:stt-async-v5", durationMs),
            ).toBeUndefined();
        },
    );

    it("adds ElevenLabs' keyterm add-on only when a usable term is sent", () => {
        // elevenlabs.io/pricing/api: Scribe v2 $0.22/hour, keyterms +$0.05/hour.
        expect(
            sttAudioHourPriceUsdForId("elevenlabs:scribe_v2", {
                keywords: "Avalon, Brightwater",
            }),
        ).toBeCloseTo(0.27, 6);
        expect(
            sttCostUsdForDuration("elevenlabs:scribe_v2", 3_600_000, {
                keywords: "Avalon",
            }),
        ).toBeCloseTo(0.27, 6);
        expect(
            sttCostUsdForDuration("elevenlabs:scribe_v2", 1_800_000),
        ).toBeCloseTo(0.11, 6);
        // Blank or rejected-only boosts send no keyterms, so no add-on.
        expect(
            sttAudioHourPriceUsdForId("elevenlabs:scribe_v2", {
                keywords: " , ",
            }),
        ).toBe(0.22);
        expect(
            sttAudioHourPriceUsdForId("elevenlabs:scribe_v2", {
                keywords: "<tag>",
            }),
        ).toBe(0.22);
        // Other providers ignore the keyword config when pricing.
        expect(
            sttAudioHourPriceUsdForId("soniox:stt-async-v5", {
                keywords: "Avalon",
            }),
        ).toBe(0.1);
    });
});
