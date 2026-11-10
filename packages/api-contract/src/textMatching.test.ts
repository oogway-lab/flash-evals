import { describe, expect, it } from "vitest";
import {
    canonicalizePair,
    normalizeText,
    textSimilarity,
} from "./textMatching.js";

describe("normalizeText", () => {
    it("ignores case, accents, spaces and punctuation", () => {
        expect(normalizeText("Parle-G")).toBe("parleg");
        expect(normalizeText(" parle g ")).toBe("parleg");
        expect(normalizeText("Café Nescafé")).toBe("cafenescafe");
        expect(normalizeText("पारले-जी")).toBe(normalizeText("पारलेजी"));
    });

    it("keeps Indic vowel signs and viramas, which change the word", () => {
        expect(normalizeText("काम")).not.toBe(normalizeText("कम"));
        expect(normalizeText("क्या")).not.toBe(normalizeText("कया"));
        expect(normalizeText("கடை")).not.toBe(normalizeText("கட"));
        expect(normalizeText("क्या हाल है")).toBe(normalizeText("क्याहालहै"));
        expect(normalizeText("Ёлка Ελλάδα")).toBe("елкаελλαδα");
    });

    it("matches chandrabindu with anusvara", () => {
        expect(normalizeText("हाँ")).toBe(normalizeText("हां"));
        expect(normalizeText("माँ")).not.toBe(normalizeText("मा"));
    });
});

describe("textSimilarity", () => {
    it("is 1 for equal strings and falls with edits", () => {
        expect(textSimilarity("parleg", "parleg")).toBe(1);
        expect(textSimilarity("", "")).toBe(1);
        expect(textSimilarity("britannia", "britania")).toBeCloseTo(8 / 9);
    });
});

describe("canonicalizePair", () => {
    it("makes spelling variants of the same name identical", () => {
        expect(
            canonicalizePair(["Parle G", "Sunfeast"], ["parle-g"], undefined),
        ).toEqual({
            candidate: ["parleg", "sunfeast"],
            benchmark: ["parleg"],
        });
    });

    it("maps aliases to their canonical name on both sides", () => {
        const matching = {
            aliases: { "Parle-G": ["parleji", "parle glucose"] },
        };
        expect(canonicalizePair("Parleji", "Parle Glucose", matching)).toEqual({
            candidate: "parleg",
            benchmark: "parleg",
        });
    });

    it("snaps close spellings only when fuzzy matching is on", () => {
        expect(
            canonicalizePair(["britania"], ["Britannia"], undefined).candidate,
        ).toEqual(["britania"]);
        expect(
            canonicalizePair(
                ["britania", "hide n seek"],
                ["Britannia", "Hide & Seek"],
                {
                    fuzzy: 0.85,
                },
            ),
        ).toEqual({
            // "hidenseek" is 8/9 similar to "hideseek", above 0.85.
            candidate: ["britannia", "hideseek"],
            benchmark: ["britannia", "hideseek"],
        });
    });

    it("lets exact matches claim their target before fuzzy ones", () => {
        expect(
            canonicalizePair(["goodday", "gooday"], ["Good Day"], {
                fuzzy: 0.8,
            }).candidate,
        ).toEqual(["goodday", "gooday"]);
    });

    it("leaves non-text values alone", () => {
        expect(canonicalizePair(3, 3, { fuzzy: 0.9 })).toEqual({
            candidate: 3,
            benchmark: 3,
        });
        expect(canonicalizePair(true, false, undefined)).toEqual({
            candidate: true,
            benchmark: false,
        });
    });
});
