import { describe, expect, it } from "vitest";
import type { IBenchmarkRulesTask } from "@flash-evals/api-contract";
import { scoreAgainstBenchmark } from "./benchmark";
import { checkRule, scoreRulesTask } from "./rules";

// Synthetic answers; not client data.
const answer = {
    summary: "Speaker 1 asked about Acme Tea pricing. The colleague agreed.",
    products: ["Acme Tea", "acme-salt", "Mystery Snack"],
    insights: "**What was pitched**\nTea\n**Follow-ups**\nCall back",
    empty: "",
};

describe("checkRule", () => {
    it("finds forbidden text, case-insensitively", () => {
        expect(
            checkRule(
                {
                    key: "labels",
                    name: "No speaker labels",
                    kind: "pattern_absent",
                    paths: ["$.summary"],
                    patterns: ["\\bspeaker[ _]?\\d+\\b", "\\bcolleague\\b"],
                },
                answer,
            ),
        ).toEqual({
            key: "labels",
            passed: false,
            offending: ["Speaker 1", "colleague"],
        });
    });

    it("compares list values after normalising case and punctuation", () => {
        expect(
            checkRule(
                {
                    key: "official",
                    name: "Official products",
                    kind: "in_list",
                    paths: ["$.products"],
                    allowed: ["Acme Tea", "Acme Salt"],
                },
                answer,
            ),
        ).toEqual({
            key: "official",
            passed: false,
            offending: ["Mystery Snack"],
        });
    });

    it("lists missing headings, and passes an empty field", () => {
        const rule = {
            key: "headings",
            name: "Headings",
            kind: "contains_all" as const,
            paths: ["$.insights"],
            required: ["What was pitched", "What worked", "Follow-ups"],
        };
        expect(checkRule(rule, answer)).toEqual({
            key: "headings",
            passed: false,
            offending: ["What worked"],
        });
        expect(checkRule({ ...rule, paths: ["$.empty"] }, answer).passed).toBe(
            true,
        );
    });

    it("skips patterns that don't compile instead of throwing", () => {
        const bad = (patterns: string[]) =>
            checkRule(
                {
                    key: "bad",
                    name: "Bad",
                    kind: "pattern_absent",
                    paths: ["$.summary"],
                    patterns,
                },
                answer,
            );
        expect(bad(["(", "absent"]).passed).toBe(true);
        // With nothing left to run, the rule is not checked rather than passed.
        expect(bad(["("])).toEqual({
            key: "bad",
            passed: false,
            notChecked: true,
            offending: [
                'Not checked: "(" is not a valid pattern. Fix the rule\'s patterns.',
            ],
        });
    });
});

describe("checkRule pattern safety", () => {
    const check = (patterns: string[]) =>
        checkRule(
            {
                key: "p",
                name: "P",
                kind: "pattern_absent",
                paths: ["$.summary"],
                patterns,
            },
            answer,
        );

    it("does not match empty text as forbidden text", () => {
        expect(check(["x*", "colleague"])).toMatchObject({
            passed: false,
            offending: ["colleague"],
        });
        expect(check(["\\b", "absent"]).passed).toBe(true);
        expect(check(["\\b"]).passed).toBe(true);
        expect(check(["", "colleague"])).toMatchObject({
            passed: false,
            offending: ["colleague"],
        });
    });

    it("skips patterns the linear-time engine can't run", () => {
        expect(check(["(?<!a)b", "absent"]).passed).toBe(true);
    });

    it("runs patterns that backtrack badly without stalling the worker", () => {
        const long = { summary: `${"a".repeat(50_000)}!` };
        const started = performance.now();
        const result = checkRule(
            {
                key: "p",
                name: "P",
                kind: "pattern_absent",
                paths: ["$.summary"],
                patterns: ["\\w*\\w*\\w*\\w*!", ".*.*.*.*x", "(a|aa)+b"],
            },
            long,
        );
        expect(performance.now() - started).toBeLessThan(200);
        expect(result).toMatchObject({ passed: false });
        expect(result.offending).toEqual([long.summary]);
    });

    it("reports a rule with no pattern it can run as not checked, not passed", () => {
        for (const patterns of [[""], ["x*"], ["(?=a)b"], ["a{1001}"]]) {
            const result = check(patterns);
            expect(result.passed).toBe(false);
            expect(result.offending![0]).toMatch(/^Not checked: /);
        }
    });
});

describe("checkRule word_count", () => {
    const words = (n: number) =>
        Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const lengthRule = {
        key: "length",
        name: "Summary length",
        kind: "word_count" as const,
        paths: ["$.summary"],
        min: 75,
        max: 100,
    };

    it("passes within the limit and keeps the count", () => {
        expect(checkRule(lengthRule, { summary: words(75) })).toEqual({
            key: "length",
            passed: true,
            wordCounts: [{ path: "$.summary", words: 75 }],
        });
        expect(checkRule(lengthRule, { summary: words(100) }).passed).toBe(
            true,
        );
    });

    it("fails under or over the limit, saying by how much", () => {
        expect(checkRule(lengthRule, { summary: words(68) })).toEqual({
            key: "length",
            passed: false,
            offending: ["summary: 68 words (needs 75–100 words)"],
            wordCounts: [{ path: "$.summary", words: 68 }],
        });
        expect(checkRule(lengthRule, { summary: words(101) })).toEqual({
            key: "length",
            passed: false,
            offending: ["summary: 101 words (needs 75–100 words)"],
            wordCounts: [{ path: "$.summary", words: 101 }],
        });
    });

    it("fails a missing, null or non-text field without a count", () => {
        for (const output of [{}, { summary: null }]) {
            expect(checkRule(lengthRule, output)).toEqual({
                key: "length",
                passed: false,
                offending: ["summary: missing (needs 75–100 words)"],
                wordCounts: [],
            });
        }
        expect(checkRule(lengthRule, { summary: { text: "hi" } })).toEqual({
            key: "length",
            passed: false,
            offending: ["summary: not text (needs 75–100 words)"],
            wordCounts: [],
        });
    });

    it("checks every field on its own; a list of strings counts as one text", () => {
        const rule = {
            ...lengthRule,
            paths: ["$.summary", "$.notes"],
            min: 2,
            max: 4,
        };
        expect(
            checkRule(rule, { summary: "one two three", notes: ["a b", "c"] }),
        ).toEqual({
            key: "length",
            passed: true,
            wordCounts: [
                { path: "$.summary", words: 3 },
                { path: "$.notes", words: 3 },
            ],
        });
        const result = checkRule(rule, {
            summary: "one two three",
            notes: ["a b c", "d e"],
        });
        expect(result.passed).toBe(false);
        expect(result.offending).toEqual(["notes: 5 words (needs 2–4 words)"]);
    });

    it("counts Hindi text by whitespace", () => {
        expect(
            checkRule(
                { ...lengthRule, min: undefined, max: 3 },
                { summary: "ग्राहक ने दाम पूछा" },
            ),
        ).toMatchObject({
            passed: false,
            wordCounts: [{ path: "$.summary", words: 4 }],
        });
    });

    it("counts toward the task's agreement like any other check", () => {
        const lengthTask: IBenchmarkRulesTask = {
            key: "checks",
            name: "Rule checks",
            method: "rules",
            rules: [lengthRule],
        };
        expect(
            scoreRulesTask(lengthTask, { summary: words(80) }).agreement,
        ).toBe(1);
        expect(
            scoreRulesTask(lengthTask, { summary: words(20) }).agreement,
        ).toBe(0);
    });
});

const task: IBenchmarkRulesTask = {
    key: "checks",
    name: "Rule checks",
    method: "rules",
    rules: [
        {
            key: "labels",
            name: "No speaker labels",
            kind: "pattern_absent",
            paths: ["$.summary"],
            patterns: ["speaker \\d"],
        },
        {
            key: "headings",
            name: "Headings",
            kind: "contains_all",
            paths: ["$.insights"],
            required: ["What was pitched"],
        },
    ],
};

describe("scoreRulesTask", () => {
    it("fails the answer when any check breaks, and keeps each outcome", () => {
        const result = scoreRulesTask(task, answer);
        expect(result.agreement).toBe(0);
        expect(result.rules?.map((rule) => rule.passed)).toEqual([false, true]);
        expect(
            scoreRulesTask(task, { ...answer, summary: "All good." }).agreement,
        ).toBe(1);
    });

    it("makes a rule it cannot run a task error, not a failed answer", () => {
        const unrunnable = {
            key: "old",
            name: "Old pattern",
            kind: "pattern_absent" as const,
            paths: ["$.summary"],
            patterns: ["(a)\\1"],
        };
        const withOld = { ...task, rules: [...task.rules, unrunnable] };
        const good = { ...answer, summary: "All good." };
        // Every answer, the reference's too, would fail; it is left out of
        // the rates instead, like a judge error.
        const result = scoreRulesTask(withOld, good);
        expect(result.agreement).toBeUndefined();
        expect(result.error).toMatch(/^Not checked: /);
        expect(result.rules?.at(-1)).toMatchObject({ notChecked: true });
        // A rule that did run and broke still fails the answer.
        expect(scoreRulesTask(withOld, answer)).toMatchObject({ agreement: 0 });
        expect(scoreRulesTask(withOld, answer).error).toBeUndefined();
    });

    it("scores without any yardstick, e.g. today's model's own answer", async () => {
        const { score, details } = await scoreAgainstBenchmark({
            taskMap: { tasks: [task] },
            candidate: answer,
            cellId: "cell-1",
            apiKeys: {},
        });
        expect(score).toBe(0);
        expect(details.tasks.map((result) => result.key)).toEqual(["checks"]);
    });
});
