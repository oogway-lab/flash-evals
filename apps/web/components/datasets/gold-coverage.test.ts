import { describe, expect, it } from "vitest";
import { goldCoverage } from "./gold-coverage";

describe("goldCoverage", () => {
    it("reports transcript, Latin, and speaker-turn coverage independently", () => {
        expect(
            goldCoverage({
                expectedTranscript: "hello",
                expectedSpeakerTurns: [{ speaker: "A", text: "hello" }],
            }),
        ).toEqual({ transcript: true, latin: false, speakerTurns: true });
        expect(goldCoverage(undefined)).toEqual({
            transcript: false,
            latin: false,
            speakerTurns: false,
        });
        expect(
            goldCoverage({
                expectedSpeakerTurns: [{ speaker: 1, text: "hello" }],
            }).speakerTurns,
        ).toBe(false);
    });
});
