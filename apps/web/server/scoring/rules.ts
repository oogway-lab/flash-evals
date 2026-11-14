import {
    countWords,
    normalizeText,
    valueAtBenchmarkPath,
    wordCountProblem,
    type IBenchmarkRule,
    type IBenchmarkRuleResult,
    type IBenchmarkRulesTask,
    type IBenchmarkTaskResult,
} from "@flash-evals/api-contract";
import {
    compileRulePattern,
    rulePatternMatches,
    type RulePattern,
} from "@flash-evals/api-contract/rule-patterns";
import type { OutputJson } from "../db/jsonTypes";

/** Most offending values kept per rule, so one bad answer can't bloat a row. */
const MAX_OFFENDING = 10;

/**
 * Rule checks on one model's own answer: no yardstick, no model call. The
 * task's agreement is 1 when every rule passes and 0 when any fails, so a
 * single broken rule counts as a hard failure for that answer; the details
 * keep each rule's outcome and what broke it. A rule that could not be run
 * says nothing about the answer: unless another rule already failed, the
 * task is an error with no agreement, left out of the rates like a judge
 * error instead of failing every answer (the reference's too).
 */
export function scoreRulesTask(
    task: IBenchmarkRulesTask,
    output: OutputJson,
): IBenchmarkTaskResult {
    const rules = task.rules.map((rule) => checkRule(rule, output));
    const result = { key: task.key, method: "rules" as const, rules };
    if (rules.some((rule) => !rule.passed && !rule.notChecked))
        return { ...result, agreement: 0 };
    const notChecked = rules.find((rule) => rule.notChecked);
    if (notChecked)
        return {
            ...result,
            error: notChecked.offending?.[0] ?? "Not checked.",
        };
    return { ...result, agreement: 1 };
}

export function checkRule(
    rule: IBenchmarkRule,
    output: OutputJson,
): IBenchmarkRuleResult {
    if (rule.kind === "word_count") return checkWordCount(rule, output);
    const notChecked = uncheckablePatterns(rule);
    if (notChecked)
        return {
            key: rule.key,
            passed: false,
            notChecked: true,
            offending: [notChecked],
        };
    const values = rule.paths.flatMap((path) =>
        leafStrings(valueAtBenchmarkPath(output, path)),
    );
    const offending = offendingValues(rule, values);
    return offending.length === 0
        ? { key: rule.key, passed: true }
        : {
              key: rule.key,
              passed: false,
              offending: [...new Set(offending)].slice(0, MAX_OFFENDING),
          };
}

/**
 * Every field must hold between `min` and `max` words. A missing or non-text
 * field fails the rule: a length limit on a field the answer doesn't fill is
 * not met. Each counted field's total is kept, pass or fail, so the result
 * can show how close an answer came.
 */
function checkWordCount(
    rule: IBenchmarkRule,
    output: OutputJson,
): IBenchmarkRuleResult {
    const counted = rule.paths.map((path) => ({
        path,
        value: valueAtBenchmarkPath(output, path),
    }));
    const wordCounts = counted.flatMap(({ path, value }) => {
        const words = countWords(value);
        return words === undefined ? [] : [{ path, words }];
    });
    const offending = counted.flatMap(({ path, value }) => {
        const problem = wordCountProblem(path, value, rule.min, rule.max);
        return problem ? [problem] : [];
    });
    return offending.length === 0
        ? { key: rule.key, passed: true, wordCounts }
        : {
              key: rule.key,
              passed: false,
              offending: offending.slice(0, MAX_OFFENDING),
              wordCounts,
          };
}

function offendingValues(rule: IBenchmarkRule, values: string[]): string[] {
    if (rule.kind === "pattern_absent") {
        const patterns = runnable(compiled(rule.patterns));
        return values.flatMap((value) =>
            patterns.flatMap((pattern) => rulePatternMatches(pattern, value)),
        );
    }
    if (rule.kind === "in_list") {
        const allowed = new Set(
            (rule.allowed ?? []).map(normalizeText).filter(Boolean),
        );
        return values.filter((value) => {
            const key = normalizeText(value);
            return key.length > 0 && !allowed.has(key);
        });
    }
    // contains_all: an empty answer has nothing to structure, so it passes.
    const text = values.join("\n");
    if (text.trim().length === 0) return [];
    const haystack = text.toLowerCase();
    return (rule.required ?? []).filter(
        (needle) => needle.trim() && !haystack.includes(needle.toLowerCase()),
    );
}

/**
 * Each pattern compiled for the linear-time engine, or why it can't run.
 * Patterns validation now refuses (empty-matching, too long, lookarounds,
 * backreferences) can still be in older runs.
 */
function compiled(patterns: string[] | undefined): RulePattern[] {
    return (patterns ?? []).map(compileRulePattern);
}

/** The patterns that can run; the others are skipped. */
function runnable(patterns: RulePattern[]) {
    return patterns.flatMap(({ regex }) => (regex ? [regex] : []));
}

/**
 * Why a `pattern_absent` rule cannot be checked at all: every pattern it has
 * is one validation now refuses (only possible on older runs). Such a rule
 * is reported as not checked with the reason, neither passed nor failed.
 */
function uncheckablePatterns(rule: IBenchmarkRule): string | undefined {
    if (rule.kind !== "pattern_absent") return undefined;
    const patterns = compiled(rule.patterns);
    if (patterns.length === 0 || runnable(patterns).length > 0)
        return undefined;
    return `Not checked: ${patterns[0]!.problem} Fix the rule's patterns.`;
}

/** Every string inside a value, at any depth; numbers count as text. */
function leafStrings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "number") return [String(value)];
    if (Array.isArray(value)) return value.flatMap(leafStrings);
    if (value && typeof value === "object")
        return Object.values(value).flatMap(leafStrings);
    return [];
}
