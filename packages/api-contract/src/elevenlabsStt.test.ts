import { describe, expect, it } from "vitest";
import {
    elevenLabsKeyterms,
    invalidSttConfigMessagesForModelId,
    sttConfigFieldsForModelId,
    sttModelIdentityForId,
    sttModelSupportsLanguage,
} from "./index.js";

describe("ElevenLabs Scribe STT contract", () => {
    it("maps the model id to the ElevenLabs speech-to-text route", () => {
        expect(sttModelIdentityForId("elevenlabs:scribe_v2")).toEqual({
            providerId: "elevenlabs",
            routeId: "elevenlabs-speech-to-text",
            canonicalModelId: "scribe_v2",
        });
    });

    it("offers language, keyword boost and diarization", () => {
        expect(
            sttConfigFieldsForModelId("elevenlabs:scribe_v2").map(
                (field) => field.key,
            ),
        ).toEqual(["language", "keywords", "diarization"]);
        expect(sttModelSupportsLanguage("elevenlabs:scribe_v2")).toBe(true);
        expect(
            invalidSttConfigMessagesForModelId("elevenlabs:scribe_v2", {
                diarization: "yes",
            }),
        ).toEqual(["Diarization must be true or false."]);
    });

    it("keeps keyterms inside ElevenLabs' limits and reports the rest", () => {
        expect(
            elevenLabsKeyterms(
                " Avalon , Brightwater  Labs, Avalon,, a b c d e f, [x], back\\slash, " +
                    "x".repeat(51),
            ),
        ).toEqual({
            terms: ["Avalon", "Brightwater Labs"],
            rejected: ["a b c d e f", "[x]", "back\\slash", "x".repeat(51)],
        });
        expect(elevenLabsKeyterms(undefined)).toEqual({
            terms: [],
            rejected: [],
        });
    });

    it("caps the request at 1000 keyterms", () => {
        const many = Array.from({ length: 1001 }, (_, i) => `term${i}`);
        const result = elevenLabsKeyterms(many.join(","));
        expect(result.terms).toHaveLength(1000);
        expect(result.rejected).toEqual(["term1000"]);
    });
});
