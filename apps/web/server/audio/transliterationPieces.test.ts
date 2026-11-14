import { describe, expect, it } from "vitest";
import {
    joinTranscriptPieces,
    splitTranscriptIntoPieces,
    transcriptWordCount,
    transliterationLooksComplete,
} from "./transliterationPieces";

const SENTENCE = "आज मौसम बहुत अच्छा है और हम बाज़ार जा रहे हैं।";

describe("splitTranscriptIntoPieces", () => {
    it("keeps a short transcript as one piece", () => {
        expect(splitTranscriptIntoPieces(`  ${SENTENCE}  `, 1_200)).toEqual([
            { text: SENTENCE, separator: "" },
        ]);
    });

    it("splits a long transcript at sentence ends, within the size limit", () => {
        const source = Array.from({ length: 60 }, () => SENTENCE).join(" ");
        const pieces = splitTranscriptIntoPieces(source, 600);

        expect(pieces.length).toBeGreaterThan(1);
        for (const piece of pieces) {
            expect(piece.text.length).toBeLessThanOrEqual(600);
            // Every piece ends on a sentence end, never mid-word.
            expect(piece.text.endsWith("।")).toBe(true);
        }
        // Nothing is lost or added.
        expect(joinTranscriptPieces(pieces)).toBe(source);
    });

    it("prefers line breaks and keeps them when rejoined", () => {
        const lines = Array.from(
            { length: 40 },
            (_, index) => `वक्ता ${index}: ${SENTENCE}`,
        );
        const source = lines.join("\n");
        const pieces = splitTranscriptIntoPieces(source, 500);

        expect(pieces.length).toBeGreaterThan(1);
        expect(pieces.every((piece) => !piece.text.startsWith("\n"))).toBe(
            true,
        );
        expect(joinTranscriptPieces(pieces)).toBe(source);
    });

    it("splits a long sentence at spaces and an overlong word where it must", () => {
        const words = Array.from({ length: 200 }, () => "शब्द").join(" ");
        const wordPieces = splitTranscriptIntoPieces(words, 100);
        expect(wordPieces.every((piece) => piece.text.length <= 100)).toBe(
            true,
        );
        expect(joinTranscriptPieces(wordPieces)).toBe(words);

        const glued = "क".repeat(250);
        const gluedPieces = splitTranscriptIntoPieces(glued, 100);
        expect(gluedPieces.map((piece) => piece.text.length)).toEqual([
            100, 100, 50,
        ]);
        expect(joinTranscriptPieces(gluedPieces)).toBe(glued);
    });
});

describe("transliterationLooksComplete", () => {
    it("counts words that carry a letter or digit", () => {
        expect(transcriptWordCount(SENTENCE)).toBe(11);
        expect(transcriptWordCount("है । 42 ...")).toBe(2);
        expect(transcriptWordCount("   ")).toBe(0);
    });

    it("accepts a reply that keeps the words", () => {
        expect(
            transliterationLooksComplete(
                SENTENCE,
                "aaj mausam bahut achchha hai aur hum bazaar ja rahe hain.",
            ),
        ).toBe(true);
    });

    it("rejects a reply that dropped most of the text", () => {
        const source = Array.from({ length: 50 }, () => SENTENCE).join(" ");
        const kept = Array.from(
            { length: 7 },
            () => "aaj mausam bahut achchha hai aur hum bazaar ja rahe hain.",
        ).join(" ");
        expect(transliterationLooksComplete(source, kept)).toBe(false);
    });

    it("rejects a reply that ran away", () => {
        expect(
            transliterationLooksComplete(
                SENTENCE,
                Array.from({ length: 40 }, () => "haan").join(" "),
            ),
        ).toBe(false);
    });

    it("has nothing to check when the source has no words", () => {
        expect(transliterationLooksComplete("।।", "")).toBe(true);
    });
});
