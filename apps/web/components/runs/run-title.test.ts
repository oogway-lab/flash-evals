import { describe, expect, it } from "vitest";
import { RUN_TITLE_MAX_LENGTH, runNoteTitle, runTitle } from "./run-title";

describe("runNoteTitle", () => {
    it("uses the first non-empty line of the note", () => {
        expect(runNoteTitle("\n  \nBaseline run\nSecond line")).toBe(
            "Baseline run",
        );
    });

    it("strips a leading heading or list marker", () => {
        expect(runNoteTitle("## Prompt v2 check")).toBe("Prompt v2 check");
        expect(runNoteTitle("- Prompt v2 check")).toBe("Prompt v2 check");
    });

    it("truncates long first lines with an ellipsis", () => {
        const title = runNoteTitle("x".repeat(200))!;
        expect(title).toHaveLength(RUN_TITLE_MAX_LENGTH);
        expect(title.endsWith("…")).toBe(true);
    });

    it("is undefined for missing or blank notes", () => {
        expect(runNoteTitle(undefined)).toBeUndefined();
        expect(runNoteTitle("")).toBeUndefined();
        expect(runNoteTitle("  \n \n")).toBeUndefined();
    });
});

describe("runTitle", () => {
    const id = "e12581e7-d31b-4555-8303-59f3ab2ecf11";

    it("prefers the note title", () => {
        expect(runTitle(id, "Result with optimized prompts")).toBe(
            "Result with optimized prompts",
        );
    });

    it("falls back to the short ID", () => {
        expect(runTitle(id)).toBe("Run e12581e7");
        expect(runTitle(id, "   ")).toBe("Run e12581e7");
    });
});
