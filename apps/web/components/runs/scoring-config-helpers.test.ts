import { describe, expect, it } from "vitest";
import type { IPipelineFieldConfig } from "@/server/db/jsonTypes";
import {
    isMatcherValue,
    updateFieldMatcher,
    updateNumericTolerance,
    updateGenerativeField,
} from "./scoring-config-helpers";

const factual = (field: string): IPipelineFieldConfig => ({
    field,
    kind: "factual",
});

describe("isMatcherValue", () => {
    it("accepts the known matcher values plus the none sentinel", () => {
        for (const v of ["none", "exact", "numeric_tolerance", "set_overlap"]) {
            expect(isMatcherValue(v)).toBe(true);
        }
    });

    it("rejects unknown values", () => {
        expect(isMatcherValue("fuzzy")).toBe(false);
        expect(isMatcherValue("")).toBe(false);
    });
});

describe("updateFieldMatcher", () => {
    const configs = [factual("a"), factual("b")];

    it("strips the spec for none", () => {
        const next = updateFieldMatcher(
            [{ field: "a", kind: "factual", spec: { matcher: "exact" } }],
            0,
            "none",
        );
        expect(next[0]).toEqual({ field: "a", kind: "factual" });
    });

    it("sets an exact spec", () => {
        expect(updateFieldMatcher(configs, 0, "exact")[0]).toEqual({
            field: "a",
            kind: "factual",
            spec: { matcher: "exact" },
        });
    });

    it("sets a numeric_tolerance spec with defaults", () => {
        expect(updateFieldMatcher(configs, 1, "numeric_tolerance")[1]).toEqual({
            field: "b",
            kind: "factual",
            spec: {
                matcher: "numeric_tolerance",
                tolerance: 0.1,
                relative: true,
            },
        });
    });

    it("sets a set_overlap spec", () => {
        expect(updateFieldMatcher(configs, 0, "set_overlap")[0]).toEqual({
            field: "a",
            kind: "factual",
            spec: { matcher: "set_overlap" },
        });
    });

    it("is a no-op for a generative field", () => {
        const generative: IPipelineFieldConfig[] = [
            { field: "a", kind: "generative", rubric: "r", modelId: "gpt-4o" },
        ];
        expect(updateFieldMatcher(generative, 0, "exact")).toBe(generative);
    });
});

describe("updateNumericTolerance", () => {
    it("patches the tolerance on a numeric_tolerance field", () => {
        const configs: IPipelineFieldConfig[] = [
            {
                field: "a",
                kind: "factual",
                spec: {
                    matcher: "numeric_tolerance",
                    tolerance: 0.1,
                    relative: true,
                },
            },
        ];
        const next = updateNumericTolerance(configs, 0, 0.5);
        expect(next[0]).toEqual({
            field: "a",
            kind: "factual",
            spec: {
                matcher: "numeric_tolerance",
                tolerance: 0.5,
                relative: true,
            },
        });
    });

    it("is a no-op when the field is not a numeric_tolerance matcher", () => {
        const configs: IPipelineFieldConfig[] = [
            { field: "a", kind: "factual", spec: { matcher: "exact" } },
        ];
        expect(updateNumericTolerance(configs, 0, 0.5)).toBe(configs);
    });
});

describe("updateGenerativeField", () => {
    it("patches rubric and modelId on a generative field", () => {
        const configs: IPipelineFieldConfig[] = [
            {
                field: "a",
                kind: "generative",
                rubric: "old",
                modelId: "gpt-4o-mini",
            },
        ];
        const next = updateGenerativeField(configs, 0, {
            rubric: "new",
            modelId: "gpt-4o",
        });
        expect(next[0]).toEqual({
            field: "a",
            kind: "generative",
            rubric: "new",
            modelId: "gpt-4o",
        });
    });

    it("is a no-op for a factual field", () => {
        const configs = [factual("a")];
        expect(updateGenerativeField(configs, 0, { rubric: "x" })).toBe(
            configs,
        );
    });
});
