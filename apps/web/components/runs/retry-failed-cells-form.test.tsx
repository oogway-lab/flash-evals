import { describe, expect, it } from "vitest";
import { retryLabel } from "./retry-failed-cells-form";

describe("retryLabel", () => {
    it("names how many answers a re-judge judges again", () => {
        expect(retryLabel("rejudge", 3)).toBe("Re-judge 3 answers");
        expect(retryLabel("rejudge", 1)).toBe("Re-judge 1 answer");
        expect(retryLabel("rejudge")).toBe("Re-judge answers");
    });

    it("keeps the other labels", () => {
        expect(retryLabel("failed")).toBe("Retry failed cells");
        expect(retryLabel("resume", 2)).toBe("Resume run");
    });
});
