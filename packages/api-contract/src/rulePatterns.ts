/**
 * Runs user-written rule patterns (`pattern_absent`) with RE2, a regular
 * expression engine whose matching time grows linearly with the text, so no
 * pattern can stall the worker however it is written. Server-only: a
 * separate entry point (`@flash-evals/api-contract/rule-patterns`) keeps the
 * engine out of the browser bundle.
 *
 * Patterns are written in JavaScript syntax and matched case-insensitively,
 * as before. RE2 has no lookarounds or backreferences; validation refuses
 * those and anything else the engine can't compile.
 */
import { RE2JS } from "re2js";
import {
    isRulesTask,
    ruleCheckLabel,
    rulePatternProblem,
    type ITaskMap,
} from "./benchmark.js";

/** A pattern ready to run, or why it can't be used. */
export type RulePattern =
    | { regex: RE2JS; problem?: undefined }
    | { regex?: undefined; problem: string };

/** Compiles a pattern for the worker, applying every validation check. */
export function compileRulePattern(pattern: string): RulePattern {
    const problem = rulePatternProblem(pattern);
    if (problem) return { problem };
    try {
        // translateRegExp turns JavaScript-only syntax ("é", "\u{1F600}",
        // "(?<name>…)") into RE2's; backreferences were refused above.
        const source = RE2JS.translateRegExp(pattern);
        return { regex: RE2JS.compile(source, RE2JS.CASE_INSENSITIVE) };
    } catch (error) {
        return {
            problem: `"${pattern}" can't be run by the rule checker (${engineReason(error)}); simplify it.`,
        };
    }
}

/** The engine's reason, without its prefix or the added "(?i)" flag. */
function engineReason(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message
        .replace(/^error parsing regexp: /u, "")
        .replace("`(?i)", "`")
        .trim();
}

/** Every non-empty match of a compiled pattern in `text`, in order. */
export function rulePatternMatches(regex: RE2JS, text: string): string[] {
    const matcher = regex.matcher(text);
    const matches: string[] = [];
    while (matcher.find()) {
        const match = matcher.group();
        // An empty match (e.g. "\b") is no forbidden text.
        if (match) matches.push(match);
    }
    return matches;
}

/**
 * Patterns in a Task Map that pass the browser checks but that the engine
 * can't compile, as validation messages ("Task / Check: …"). The server runs
 * this after `validateTaskMap`.
 */
export function rulePatternEngineErrors(taskMap: ITaskMap): string[] {
    const errors: string[] = [];
    for (const task of taskMap.tasks ?? []) {
        if (!isRulesTask(task)) continue;
        for (const rule of task.rules ?? []) {
            if (rule.kind !== "pattern_absent") continue;
            for (const pattern of rule.patterns ?? []) {
                if (rulePatternProblem(pattern)) continue;
                const { problem } = compileRulePattern(pattern);
                if (problem)
                    errors.push(`${ruleCheckLabel(task, rule)}: ${problem}`);
            }
        }
    }
    return errors;
}
