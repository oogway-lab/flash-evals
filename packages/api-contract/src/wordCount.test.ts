import { describe, expect, it } from "vitest";
import { validateTaskMap, type IBenchmarkRule } from "./benchmark.js";
import { countWords, wordCountProblem, wordLimitText } from "./wordCount.js";

// Synthetic schema and answers; not client data.
const SCHEMA = {
    type: "object",
    properties: {
        summary: { type: "string" },
        notes: { type: "array", items: { type: "string" } },
    },
};

function errorsFor(limits: Partial<IBenchmarkRule>): string[] {
    return validateTaskMap(
        {
            tasks: [
                {
                    key: "checks",
                    name: "Checks",
                    method: "rules",
                    rules: [
                        {
                            key: "length",
                            name: "Length",
                            kind: "word_count",
                            paths: ["$.summary"],
                            ...limits,
                        },
                    ],
                },
            ],
        },
        SCHEMA,
    );
}

describe("word_count validation", () => {
    it("accepts a range, a minimum only or a maximum only", () => {
        expect(errorsFor({ min: 75, max: 100 })).toEqual([]);
        expect(errorsFor({ min: 0 })).toEqual([]);
        expect(errorsFor({ max: 100 })).toEqual([]);
        expect(errorsFor({ min: 50, max: 50 })).toEqual([]);
    });

    it("needs a minimum or a maximum, and no list", () => {
        expect(errorsFor({})).toEqual([
            "Checks / Length: set a minimum or a maximum number of words.",
        ]);
    });

    it("rejects a minimum above the maximum", () => {
        expect(errorsFor({ min: 100, max: 75 })).toEqual([
            "Checks / Length: the minimum number of words (100) is above the maximum (75).",
        ]);
    });

    it("rejects negative and fractional limits", () => {
        expect(errorsFor({ min: -1, max: 10 })).toEqual([
            "Checks / Length: the minimum number of words must be a whole number, zero or more.",
        ]);
        expect(errorsFor({ max: 7.5 })).toEqual([
            "Checks / Length: the maximum number of words must be a whole number, zero or more.",
        ]);
        expect(errorsFor({ min: Number.NaN })).toHaveLength(1);
    });

    it("still checks the fields like other checks", () => {
        expect(errorsFor({ max: 10, paths: [] })).toContain(
            "Checks / Length: choose at least one output field.",
        );
        expect(errorsFor({ max: 10, paths: ["$.missing"] })).toContain(
            'Checks: "$.missing" is not in the output schema.',
        );
    });
});

describe("countWords", () => {
    it("counts runs of non-whitespace", () => {
        expect(countWords("  The call, in short:  agreed.\n\tNext week ")).toBe(
            7,
        );
        expect(countWords("")).toBe(0);
        expect(countWords("   ")).toBe(0);
    });

    it("counts Hindi and mixed-script text by whitespace", () => {
        expect(countWords("ग्राहक ने दाम पूछा")).toBe(4);
        expect(countWords("Customer ने order दिया।")).toBe(4);
    });

    it("skips bullets, dashes and list numbers, and splits on zero-width spaces", () => {
        expect(
            countWords("- Price • agreed\n1. Call back\n- 2) Send quote"),
        ).toBe(6);
        expect(countWords("Launch in 2026, 3 stores")).toBe(5);
        expect(countWords("price\u200Bagreed\uFEFFtoday")).toBe(3);
        // A zero-width joiner sits inside an Indic word; it does not split it.
        expect(countWords("क्\u200Dष ने")).toBe(2);
    });

    it("counts numbers that end a sentence or sit mid-line", () => {
        // Only a number opening a line is a list marker.
        expect(countWords("Budget is 50.")).toBe(3);
        expect(countWords("Call 2) then send 12.")).toBe(5);
        expect(countWords("ग्राहक ने 50. कहा\r\n2) अगला")).toBe(5);
        expect(countWords(["1. Call back", "2. Send quote"])).toBe(4);
        // An inline list: the next number in the same style is a marker.
        expect(countWords("1) a 2) b 3) c")).toBe(3);
        expect(countWords("1. We sold 50. Then 2) more")).toBe(6);
        expect(countWords("1) a 3) b")).toBe(3);
    });

    it("counts a list of strings as one text", () => {
        expect(countWords(["two words", "three more words", ""])).toBe(5);
        expect(countWords([])).toBe(0);
    });

    it("has no count for missing or non-text values", () => {
        expect(countWords(undefined)).toBeUndefined();
        expect(countWords(null)).toBeUndefined();
        expect(countWords(42)).toBeUndefined();
        expect(countWords({ text: "hi" })).toBeUndefined();
        expect(countWords(["hi", 3])).toBeUndefined();
    });
});

describe("wordLimitText and wordCountProblem", () => {
    it("states the limit plainly", () => {
        expect(wordLimitText(75, 100)).toBe("75–100");
        expect(wordLimitText(75)).toBe("at least 75");
        expect(wordLimitText(undefined, 100)).toBe("at most 100");
        expect(wordLimitText(50, 50)).toBe("exactly 50");
        expect(wordLimitText()).toBe("");
    });

    it("explains a field outside the limit, and nothing inside it", () => {
        const text = (n: number) =>
            Array.from({ length: n }, () => "w").join(" ");
        expect(wordCountProblem("$.summary", text(68), 75, 100)).toBe(
            "summary: 68 words (needs 75–100 words)",
        );
        expect(wordCountProblem("$.summary", text(101), 75, 100)).toBe(
            "summary: 101 words (needs 75–100 words)",
        );
        expect(wordCountProblem("$.meta.summary", "one", 2)).toBe(
            "meta.summary: 1 word (needs at least 2 words)",
        );
        expect(
            wordCountProblem("$.summary", text(75), 75, 100),
        ).toBeUndefined();
        expect(
            wordCountProblem("$.summary", text(100), 75, 100),
        ).toBeUndefined();
    });

    it("explains a missing or non-text field", () => {
        expect(wordCountProblem("$.summary", undefined, 1, 5)).toBe(
            "summary: missing (needs 1–5 words)",
        );
        expect(wordCountProblem("$.summary", null, undefined, 5)).toBe(
            "summary: missing (needs at most 5 words)",
        );
        expect(wordCountProblem("$.summary", 12, undefined, 5)).toBe(
            "summary: not text (needs at most 5 words)",
        );
    });
});
