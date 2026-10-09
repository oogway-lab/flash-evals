import { describe, expect, it } from "vitest";
import {
    audioReferenceFromLabel,
    validateAudioReferenceLabel,
} from "./reference";

describe("audioReferenceFromLabel", () => {
    it("reads native and Latin transcript references from audio labels", () => {
        expect(
            audioReferenceFromLabel({
                referenceKind: "silver",
                expectedTranscript: "नमस्ते",
                expectedTranscriptLatin: "namaste",
                expectedLanguage: "hi",
            }),
        ).toMatchObject({
            referenceKind: "silver",
            expectedTranscript: "नमस्ते",
            expectedTranscriptLatin: "namaste",
            expectedLanguage: "hi",
        });
    });

    it("reads nested STT labels and speaker turns", () => {
        expect(
            audioReferenceFromLabel({
                stt: {
                    referenceKind: "prod_reference",
                    expectedTranscriptLatin: "kya haal hai",
                    expectedSpeakerTurns: [
                        { speaker: "S1", text: "kya haal", startMs: 0, endMs: 500 },
                    ],
                },
            }),
        ).toMatchObject({
            referenceKind: "prod_reference",
            expectedTranscriptLatin: "kya haal hai",
            expectedSpeakerTurns: [
                { speaker: "S1", text: "kya haal", startMs: 0, endMs: 500 },
            ],
        });
    });

    it("reads optional domain terms and expected numbers", () => {
        expect(
            audioReferenceFromLabel({
                stt: {
                    expectedTranscript: "take 5 mg aspirin",
                    domainTerms: ["aspirin", "hypertension"],
                    expectedNumbers: [5],
                    latencySlaMs: 2500,
                    costOutlierUsd: 0.01,
                },
            }),
        ).toMatchObject({
            domainTerms: ["aspirin", "hypertension"],
            expectedNumbers: [5],
            latencySlaMs: 2500,
            costOutlierUsd: 0.01,
        });
    });
});

describe("validateAudioReferenceLabel", () => {
    it("rejects malformed reference kinds and speaker turns", () => {
        expect(
            validateAudioReferenceLabel({
                referenceKind: "unknown",
                expectedSpeakerTurns: [{ speaker: "S1" }],
            }),
        ).toEqual([
            "referenceKind must be one of human_gold, silver, or prod_reference.",
            "expectedSpeakerTurns must contain speaker/text objects with optional numeric startMs/endMs.",
        ]);
    });

    it("rejects malformed domain terms and expected numbers", () => {
        expect(
            validateAudioReferenceLabel({
                domainTerms: ["aspirin", ""],
                expectedNumbers: [5, Number.NaN],
                latencySlaMs: Number.NaN,
                costOutlierUsd: "too much",
            }),
        ).toEqual([
            "domainTerms must be an array of non-empty strings.",
            "expectedNumbers must be an array of finite numbers.",
            "latencySlaMs must be a finite number.",
            "costOutlierUsd must be a finite number.",
        ]);
    });
});
