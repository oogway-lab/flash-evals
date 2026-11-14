import { describe, expect, it } from "vitest";
import type { IBenchmarkRule } from "@flash-evals/api-contract";
import {
    RULE_KIND_LABELS,
    parseWordLimit,
    ruleValues,
    trimRule,
    withRuleKind,
    withWordLimit,
} from "./rule-checks";

const patternRule: IBenchmarkRule = {
    key: "labels",
    name: "No speaker labels",
    kind: "pattern_absent",
    paths: ["$.summary"],
    patterns: ["speaker \\d"],
};

describe("word-count checks in the editor", () => {
    it("is offered as a kind", () => {
        expect(RULE_KIND_LABELS.word_count).toBe("Word count within limits");
    });

    it("drops the list when switching to a word count, and limits when switching back", () => {
        const counted = withRuleKind(patternRule, "word_count");
        expect(counted).toEqual({
            key: "labels",
            name: "No speaker labels",
            kind: "word_count",
            paths: ["$.summary"],
        });
        expect(ruleValues(counted)).toEqual([]);
        const limited = withWordLimit(counted, "max", 100);
        expect(withRuleKind(limited, "in_list")).toEqual({
            key: "labels",
            name: "No speaker labels",
            kind: "in_list",
            paths: ["$.summary"],
            allowed: [],
        });
    });

    it("sets and clears one limit at a time, and keeps them when trimmed", () => {
        const counted = withRuleKind(patternRule, "word_count");
        const both = withWordLimit(
            withWordLimit(counted, "min", 75),
            "max",
            100,
        );
        expect(both).toMatchObject({ min: 75, max: 100 });
        expect(withWordLimit(both, "min", undefined)).not.toHaveProperty("min");
        expect(trimRule({ ...both, name: " Length " })).toMatchObject({
            name: "Length",
            min: 75,
            max: 100,
        });
    });

    it("reads an empty box as no limit and keeps other input for validation", () => {
        expect(parseWordLimit("  ")).toBeUndefined();
        expect(parseWordLimit(" 75 ")).toBe(75);
        expect(parseWordLimit("7.5")).toBe(7.5);
    });
});
