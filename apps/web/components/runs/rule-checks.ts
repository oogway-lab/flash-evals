import type {
    IBenchmarkRule,
    IBenchmarkRulesTask,
    IBenchmarkTask,
    IJsonSchemaObject,
} from "@flash-evals/api-contract";

export type RuleKind = IBenchmarkRule["kind"];

export const RULE_KIND_LABELS: Record<RuleKind, string> = {
    pattern_absent: "Must not contain",
    in_list: "Every value must be on a list",
    contains_all: "Must contain all of",
    word_count: "Word count within limits",
};

/** What the one-per-line box holds for each kind of check. */
export const RULE_VALUES_LABELS: Record<RuleKind, string> = {
    pattern_absent: "Patterns, one per line (case doesn't matter)",
    in_list: "Allowed values, one per line",
    contains_all: "Required text, one per line",
    word_count: "Words per field",
};

export function isRuleKind(value: string): value is RuleKind {
    return value in RULE_KIND_LABELS;
}

export function emptyRule(paths: string[] = [], n = 1): IBenchmarkRule {
    return {
        key: `check_${n}`,
        name: `Check ${n}`,
        kind: "pattern_absent",
        paths,
        patterns: [],
    };
}

/**
 * The list a check uses: patterns, allowed values or required text. A word
 * count has limits instead of a list.
 */
export function ruleValues(rule: IBenchmarkRule): string[] {
    if (rule.kind === "pattern_absent") return rule.patterns ?? [];
    if (rule.kind === "in_list") return rule.allowed ?? [];
    if (rule.kind === "word_count") return [];
    return rule.required ?? [];
}

/** A check with this list, dropping settings its kind doesn't use. */
export function withRuleValues(
    rule: IBenchmarkRule,
    values: string[],
): IBenchmarkRule {
    const { patterns: _p, allowed: _a, required: _r, min, max, ...rest } = rule;
    if (rule.kind === "word_count")
        return {
            ...rest,
            ...(min === undefined ? {} : { min }),
            ...(max === undefined ? {} : { max }),
        };
    if (rule.kind === "pattern_absent") return { ...rest, patterns: values };
    if (rule.kind === "in_list") return { ...rest, allowed: values };
    return { ...rest, required: values };
}

/** "" clears a word limit; anything else is kept as typed for validation. */
export function parseWordLimit(text: string): number | undefined {
    const trimmed = text.trim();
    return trimmed === "" ? undefined : Number(trimmed);
}

/** A word-count check with one limit changed. */
export function withWordLimit(
    rule: IBenchmarkRule,
    bound: "min" | "max",
    value: number | undefined,
): IBenchmarkRule {
    const { [bound]: _old, ...rest } = rule;
    return value === undefined ? rest : { ...rest, [bound]: value };
}

/** Switch a check's kind, keeping its list. */
export function withRuleKind(
    rule: IBenchmarkRule,
    kind: RuleKind,
): IBenchmarkRule {
    return withRuleValues({ ...rule, kind }, ruleValues(rule));
}

/** "a\nb\n\n" → ["a", "b"]; also used for comma-separated field lists. */
export function splitLines(text: string, separator: RegExp = /\n/): string[] {
    return text
        .split(separator)
        .map((line) => line.trim())
        .filter(Boolean);
}

export function trimRule(rule: IBenchmarkRule): IBenchmarkRule {
    return withRuleValues(
        {
            ...rule,
            key: rule.key.trim(),
            name: rule.name.trim(),
            paths: rule.paths.map((path) => path.trim()).filter(Boolean),
        },
        ruleValues(rule)
            .map((value) => value.trim())
            .filter(Boolean),
    );
}

export function addRule(task: IBenchmarkRulesTask): IBenchmarkRulesTask {
    let n = task.rules.length + 1;
    while (task.rules.some((rule) => rule.key === `check_${n}`)) n++;
    return { ...task, rules: [...task.rules, emptyRule([], n)] };
}

/** Top-level output fields that hold text, or lists of text. */
export function textFields(schema: IJsonSchemaObject | undefined): string[] {
    const properties = schema?.properties;
    if (!properties || typeof properties !== "object") return [];
    return Object.entries(properties as Record<string, unknown>).flatMap(
        ([name, node]) => (holdsText(node) ? [`$.${name}`] : []),
    );
}

function holdsText(node: unknown): boolean {
    if (!node || typeof node !== "object") return false;
    const record = node as Record<string, unknown>;
    if (record.type === "string") return true;
    if (record.type === "array") return holdsText(record.items);
    // A $ref'd or nested object may hold names and places too.
    return record.type === "object" || typeof record.$ref === "string";
}

/**
 * Checks that suit most write-up prompts, on every text field: no
 * diarisation labels, no generic roles instead of names, nothing that looks
 * like an Aadhaar number or a one-time password. Lists (official products)
 * and headings are prompt-specific, so they are added by hand.
 */
export function starterRulesTask(
    schema: IJsonSchemaObject | undefined,
    existing: IBenchmarkTask[],
): IBenchmarkRulesTask {
    let key = "rule_checks";
    for (let n = 2; existing.some((task) => task.key === key); n++)
        key = `rule_checks_${n}`;
    const paths = textFields(schema);
    return {
        key,
        name: "Rule checks",
        description:
            "Fixed checks on each answer, no model call. One broken check fails the answer.",
        method: "rules",
        rules: [
            {
                key: "speaker_labels",
                name: "No speaker labels",
                kind: "pattern_absent",
                paths,
                patterns: ["\\bspeaker[ _]?\\d+\\b"],
            },
            {
                key: "generic_roles",
                name: "Names, not generic roles",
                kind: "pattern_absent",
                paths,
                patterns: ["\\b(colleague|team member|participant)s?\\b"],
            },
            {
                key: "personal_numbers",
                name: "No Aadhaar or OTP numbers",
                kind: "pattern_absent",
                paths,
                patterns: [
                    "\\b\\d{4}[ -]?\\d{4}[ -]?\\d{4}\\b",
                    "\\botp\\b\\D{0,15}\\d{4,8}\\b",
                ],
            },
        ],
    };
}
