import { describe, expect, it } from "vitest";
import {
    MOSAIC_REUSE_LABELS,
    NODE_TYPE_LABELS,
    REASONING_EFFORT_LABELS,
    TRANSPORT_LABELS,
    humanize,
    labelFor,
} from "./labels";
import { transportLabel } from "./transport";

describe("labels", () => {
    it("humanizes every underscore into sentence case", () => {
        expect(humanize("legacy_not_invoked")).toBe("Legacy not invoked");
        expect(humanize("force_fresh")).toBe("Force fresh");
    });

    it("maps known values and humanizes unknown ones", () => {
        expect(labelFor(MOSAIC_REUSE_LABELS, "force_fresh")).toBe(
            "Force fresh",
        );
        expect(
            labelFor(
                MOSAIC_REUSE_LABELS as Record<string, string>,
                "brand_new_mode",
            ),
        ).toBe("Brand new mode");
    });

    it("gives every node type and effort a sentence-case label", () => {
        for (const label of [
            ...Object.values(NODE_TYPE_LABELS),
            ...Object.values(REASONING_EFFORT_LABELS),
        ]) {
            expect(label).not.toMatch(/_/);
            expect(label.charAt(0)).toBe(label.charAt(0).toUpperCase());
        }
        expect(NODE_TYPE_LABELS.metric_compare).toBe("Metric compare");
        expect(REASONING_EFFORT_LABELS.xhigh).toBe("Extra high");
    });

    it("uses one transport vocabulary everywhere", () => {
        expect(transportLabel("gateway")).toBe(TRANSPORT_LABELS.gateway);
        expect(transportLabel("bifrost")).toBe("Bifrost");
    });
});
