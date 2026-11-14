import { describe, expect, it } from "vitest";
import { goldenScoreLabel } from "./golden-score";

describe("goldenScoreLabel", () => {
    it("names a run without field match settings for what it measures", () => {
        // The run form saves an empty list: every stored field, exactly.
        const label = goldenScoreLabel({ fieldConfigs: [] });
        expect(label.label).toBe("Exact match, all stored fields");
        expect(label.explanation).toMatch(/matches exactly/);
    });

    it("names a run with field match settings as a stored-answer match", () => {
        const label = goldenScoreLabel({
            fieldConfigs: [
                { key: "tags", kind: "deterministic", matcher: "set_overlap" },
            ],
        });
        expect(label.label).toBe("Stored answer match");
        expect(label.explanation).toMatch(/field match settings/);
        expect(goldenScoreLabel(undefined).label).toBe("Stored answer match");
    });
});
