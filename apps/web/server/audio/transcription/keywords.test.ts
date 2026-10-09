import { describe, expect, it } from "vitest";
import { parseSttKeywords, promptWithKeywords } from "./keywords";

describe("STT keyword formatting", () => {
    it("trims, removes empty values, and deduplicates terms", () => {
        expect(parseSttKeywords(" Avalon, Brightwater, Avalon,  ")).toEqual([
            "Avalon",
            "Brightwater",
        ]);
    });

    it("appends a plain term list to Whisper-style prompts", () => {
        const prompt = promptWithKeywords(
            "Prior transcript context.",
            "Avalon, Brightwater",
        );

        expect(prompt).toBe("Prior transcript context.\nAvalon, Brightwater");
        expect(prompt).not.toContain("Vocabulary:");
    });
});
