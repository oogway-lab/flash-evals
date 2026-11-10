import { describe, expect, it } from "vitest";
import type { ITaskMap } from "./benchmark.js";
import {
    compileRulePattern,
    rulePatternEngineErrors,
    rulePatternMatches,
} from "./rulePatterns.js";

function matches(pattern: string, text: string): string[] {
    const { regex, problem } = compileRulePattern(pattern);
    if (!regex) throw new Error(problem);
    return rulePatternMatches(regex, text);
}

describe("compileRulePattern", () => {
    it("finds every match, ignoring case, as the JavaScript flags did", () => {
        expect(matches("speaker \\d", "Speaker 1 met SPEAKER 2.")).toEqual([
            "Speaker 1",
            "SPEAKER 2",
        ]);
        expect(matches("ÉTÉ", "un été")).toEqual(["été"]);
        expect(matches("\\bcolleague\\b", "colleagues, colleague")).toEqual([
            "colleague",
        ]);
        // JavaScript-only syntax still works.
        expect(matches("caf\\u00e9", "Café")).toEqual(["Café"]);
        expect(matches("(?<n>\\d{4})", "PIN 1234")).toEqual(["1234"]);
        expect(matches("\\p{Lu}{2}\\d", "AB1 cd2")).toEqual(["AB1", "cd2"]);
        // Empty matches are no forbidden text.
        expect(matches("\\b", "two words")).toEqual([]);
    });

    it("runs patterns that backtrack badly in linear time", () => {
        const long = "a".repeat(50_000);
        for (const pattern of [
            "\\w*\\w*\\w*\\w*!",
            ".*.*.*.*x",
            "(a+)+$",
            "(a|aa)+b",
            "(?:\\d{1,3},)*\\d{3}x",
        ]) {
            const started = performance.now();
            expect(matches(pattern, long)).toEqual(
                pattern === "(a+)+$" ? [long] : [],
            );
            expect(performance.now() - started).toBeLessThan(200);
        }
    });

    it("refuses what the engine can't compile, with the reason", () => {
        expect(compileRulePattern("a{1001}").problem).toBe(
            '"a{1001}" can\'t be run by the rule checker (invalid repeat count: `{1001}`); simplify it.',
        );
        expect(compileRulePattern("(?=x)a").problem).toMatch(
            /uses a lookahead or lookbehind/,
        );
        expect(compileRulePattern("(").problem).toBe(
            '"(" is not a valid pattern.',
        );
    });
});

describe("rulePatternEngineErrors", () => {
    const taskMap = (patterns: string[]): ITaskMap => ({
        tasks: [
            {
                key: "checks",
                name: "Checks",
                method: "rules",
                rules: [
                    {
                        key: "a",
                        name: "A",
                        kind: "pattern_absent",
                        paths: ["$.summary"],
                        patterns,
                    },
                ],
            },
        ],
    });

    it("names only patterns the browser checks let through", () => {
        expect(rulePatternEngineErrors(taskMap(["speaker \\d", "("]))).toEqual(
            [],
        );
        expect(rulePatternEngineErrors(taskMap(["x{1001}"]))).toEqual([
            'Checks / A: "x{1001}" can\'t be run by the rule checker (invalid repeat count: `{1001}`); simplify it.',
        ]);
    });
});
