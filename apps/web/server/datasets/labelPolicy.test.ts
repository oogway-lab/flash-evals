import { describe, expect, it } from "vitest";
import {
    resolveLabelMode,
    usesFreeformLabel,
} from "./labelPolicy";

describe("resolveLabelMode", () => {
    it("returns evaluation for evaluation datasets", () => {
        expect(
            resolveLabelMode({
                purpose: "evaluation",
                pipelineId: "pipe-1",
                hasLegacySchema: true,
            }),
        ).toBe("evaluation");
    });

    it("returns pipeline when a pipeline is attached", () => {
        expect(
            resolveLabelMode({
                purpose: "golden",
                pipelineId: "pipe-1",
                hasLegacySchema: false,
            }),
        ).toBe("pipeline");
    });

    it("returns legacySchema without pipeline but with dataset schema", () => {
        expect(
            resolveLabelMode({
                purpose: "golden",
                pipelineId: null,
                hasLegacySchema: true,
            }),
        ).toBe("legacySchema");
    });

    it("returns independent for schema-free golden datasets", () => {
        expect(
            resolveLabelMode({
                purpose: "golden",
                pipelineId: null,
                hasLegacySchema: false,
            }),
        ).toBe("independent");
    });
});

describe("usesFreeformLabel", () => {
    it("is true for schema-free modes (independent and evaluation)", () => {
        expect(usesFreeformLabel("independent")).toBe(true);
        expect(usesFreeformLabel("evaluation")).toBe(true);
        expect(usesFreeformLabel("pipeline")).toBe(false);
        expect(usesFreeformLabel("legacySchema")).toBe(false);
    });
});