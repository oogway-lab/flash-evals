/**
 * Benchmark comparison: score candidate models against a benchmark model's
 * output, task by task, instead of against a fixed pass/fail bar.
 *
 * A Task Map splits one prompt's output into the jobs it does (for example
 * "competitor mentions" or "sales vs non-sales"). Each task is scored one of
 * two ways:
 *
 * - `agreement`: compare the task's output fields with the benchmark's values
 *   (exact, numeric tolerance, or set overlap). Optionally ask a judge who is
 *   right when they disagree.
 * - `head_to_head`: a judge compares the two answers blind and the candidate
 *   wins, ties, or loses. Use it for free text such as summaries.
 * - `rules`: fixed checks on each model's own answer (no yardstick, no model
 *   call): text that must not appear, values that must come from a list,
 *   headings that must be present. Every model is scored, today's included.
 *
 * The benchmark is the reference, not the truth: a candidate can beat it.
 */
import type {
    FieldMatcherSpec,
    IJsonSchemaObject,
    ProviderTransport,
    ReasoningEffort,
} from "./index.js";
import {
    assessModel,
    assessTask,
    agreementInterval,
    wilsonInterval,
    type BenchmarkModelVerdict,
    type IBenchmarkModelAssessment,
    type IBenchmarkPolicy,
    type IBenchmarkTaskAssessment,
} from "./benchmarkVerdict.js";
import { canonicalizePair } from "./textMatching.js";

export type BenchmarkTaskMethod =
    "agreement" | "head_to_head" | "rules" | "rubric";

/**
 * Where a task's yardstick comes from: "model" is the run's reference
 * model's answer for the item, "labels" the item's stored answer.
 */
export type BenchmarkSource = "model" | "labels";

/** Candidate's result against the benchmark for one task. */
export type BenchmarkVerdict = "win" | "tie" | "loss";

/** One output field an agreement task owns. `path` uses `$.a.b` notation. */
export type IBenchmarkAgreementField = { path: string } & FieldMatcherSpec;

export interface IBenchmarkAgreementTask {
    key: string;
    name: string;
    description?: string;
    method: "agreement";
    fields: IBenchmarkAgreementField[];
    /** Ask the judge who is right when the candidate disagrees with the benchmark. */
    judgeDisagreements?: boolean;
    /** How text values are matched; see IBenchmarkTextMatching. */
    textMatching?: IBenchmarkTextMatching;
    /** This task's yardstick; the run's `benchmark.source` when absent. */
    source?: BenchmarkSource;
}

/**
 * Text in agreement tasks is always compared after normalization: case,
 * accents, spaces and punctuation are ignored, so "Parle-G" equals
 * "parle g". Transliterated speech also spells the same name differently
 * from call to call, which these options absorb.
 */
export interface IBenchmarkTextMatching {
    /** Canonical name → other spellings, e.g. { "Parle-G": ["parleji"] }. */
    aliases?: Record<string, string[]>;
    /**
     * Also match strings whose normalized edit similarity is at least this
     * (0 to 1, e.g. 0.85). Off when absent: close names can be different
     * brands, so turn it on only after checking the data.
     */
    fuzzy?: number;
}

export interface IBenchmarkHeadToHeadTask {
    key: string;
    name: string;
    description?: string;
    method: "head_to_head";
    /** Output paths the judge compares together, in `$.a.b` notation. */
    paths: string[];
    /** What "better" means for this task; the task description is used when absent. */
    rubric?: string;
    /** This task's yardstick; the run's `benchmark.source` when absent. */
    source?: BenchmarkSource;
}

/**
 * One fixed check on an answer's fields:
 * - `pattern_absent`: none of `patterns` (case-insensitive regular
 *   expressions, run in linear time, so no lookarounds or backreferences)
 *   appears in the fields' text, e.g. "Speaker \\d", Aadhaar-like numbers;
 * - `in_list`: every value in the fields is in `allowed` (compared after the
 *   same normalisation as agreement tasks), e.g. the official product list;
 * - `contains_all`: the fields' text contains every one of `required`, e.g.
 *   the five sales-insight headings. An empty field passes, since the
 *   prompt may leave it empty when there is nothing to say;
 * - `word_count`: each field holds between `min` and `max` words (either
 *   bound may be left out). Put length limits here, not in a head-to-head or
 *   rubric judge's criteria: LLM judges miscount words. See
 *   {@link countWords} for what counts.
 */
export interface IBenchmarkRule {
    key: string;
    name: string;
    kind: "pattern_absent" | "in_list" | "contains_all" | "word_count";
    /** Output paths checked, in `$.a.b` notation. */
    paths: string[];
    patterns?: string[];
    allowed?: string[];
    required?: string[];
    /** `word_count`: fewest words allowed per field, inclusive. */
    min?: number;
    /** `word_count`: most words allowed per field, inclusive. */
    max?: number;
}

export interface IBenchmarkRulesTask {
    key: string;
    name: string;
    description?: string;
    method: "rules";
    rules: IBenchmarkRule[];
    /** Unused: rule checks have no yardstick. Kept so tasks share a shape. */
    source?: BenchmarkSource;
}

/** One thing the rubric judge scores, 1 (poor) to 5 (excellent). */
export interface IBenchmarkCriterion {
    key: string;
    name: string;
    /** What a 5 looks like, and what pulls the score down. */
    description?: string;
}

/**
 * A judge scores each model's own answer on every criterion, 1 to 5, in one
 * call, without seeing any other answer. The reference model is scored the
 * same way, so each criterion can be compared model against reference. The
 * task's agreement is the mean score scaled to 0 to 1 (1 → 0, 5 → 1).
 */
export interface IBenchmarkRubricTask {
    key: string;
    name: string;
    description?: string;
    method: "rubric";
    /** Output paths the judge reads, in `$.a.b` notation. */
    paths: string[];
    criteria: IBenchmarkCriterion[];
    /** Extra context for the judge, e.g. official product names. */
    instructions?: string;
    /** Unused: rubric tasks have no yardstick. Kept so tasks share a shape. */
    source?: BenchmarkSource;
}

export type IBenchmarkTask =
    | IBenchmarkAgreementTask
    | IBenchmarkHeadToHeadTask
    | IBenchmarkRulesTask
    | IBenchmarkRubricTask;

/** Rule checks look only at each model's own answer. */
export function isRulesTask(task: IBenchmarkTask): task is IBenchmarkRulesTask {
    return task.method === "rules";
}

/**
 * Tasks that look only at each model's own answer, with no yardstick: rule
 * checks and rubrics. The reference model is scored on them too.
 */
export function isSelfScoredTask(
    task: IBenchmarkTask,
): task is IBenchmarkRulesTask | IBenchmarkRubricTask {
    return task.method === "rules" || task.method === "rubric";
}

/** Lowest and highest score a rubric criterion can get. */
export const RUBRIC_MIN_SCORE = 1;
export const RUBRIC_MAX_SCORE = 5;

/** A 1–5 rubric score as 0 to 1. */
export function rubricScoreToAgreement(score: number): number {
    return (score - RUBRIC_MIN_SCORE) / (RUBRIC_MAX_SCORE - RUBRIC_MIN_SCORE);
}

export interface ITaskMap {
    tasks: IBenchmarkTask[];
}

/** The model that runs head-to-head comparisons. */
export interface IBenchmarkJudgeSpec {
    modelId: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
}

/**
 * Benchmark settings stored on a run. The run's reference model is the
 * benchmark; every other model is scored against it with this Task Map.
 */
export interface IRunBenchmarkConfig {
    /**
     * Where the benchmark answers come from by default: "model" (default)
     * uses the run's reference model; "labels" uses the dataset's stored
     * answers, e.g. production outputs or hand-checked answers, so every
     * model in the run is a candidate (a reference model is only the
     * leaderboard's baseline) and no benchmark calls are made. A task's own
     * `source` overrides it, so one run can check a hand-checked field
     * against the stored answers and the rest against the benchmark model.
     */
    source?: BenchmarkSource;
    taskMap: ITaskMap;
    judge?: IBenchmarkJudgeSpec;
    /** Limits for the verdict; DEFAULT_BENCHMARK_POLICY when absent. */
    policy?: IBenchmarkPolicy;
}

/** The yardstick a task is scored against: its own, else the run's. */
export function benchmarkTaskSource(
    task: Pick<IBenchmarkTask, "source">,
    config: Pick<IRunBenchmarkConfig, "source"> | undefined,
): BenchmarkSource {
    return task.source ?? config?.source ?? "model";
}

/**
 * True when any task is scored against `source`. A Task Map without tasks
 * falls back to the run's source.
 */
export function benchmarkUsesSource(
    config: Pick<IRunBenchmarkConfig, "source" | "taskMap">,
    source: BenchmarkSource,
): boolean {
    const compared = config.taskMap.tasks.filter(
        (task) => !isSelfScoredTask(task),
    );
    if (compared.length === 0) return (config.source ?? "model") === source;
    return compared.some(
        (task) => benchmarkTaskSource(task, config) === source,
    );
}

/** True when any task sends answers to a judge. */
export function taskMapNeedsJudge(taskMap: ITaskMap): boolean {
    return taskMap.tasks.some(
        (task) =>
            task.method === "head_to_head" ||
            task.method === "rubric" ||
            (task.method === "agreement" && task.judgeDisagreements === true),
    );
}

export interface IBenchmarkFieldAgreement {
    path: string;
    matcher: FieldMatcherSpec["matcher"];
    /** 0 to 1. */
    score: number;
    candidate: unknown;
    benchmark: unknown;
}

/** One rule's outcome on one answer. */
export interface IBenchmarkRuleResult {
    key: string;
    passed: boolean;
    /**
     * What broke it: matched text, values not in the list, missing headings,
     * or for word counts e.g. "summary: 68 words (needs 75–100)".
     */
    offending?: string[];
    /** `word_count`: each field's count; absent for a missing or non-text field. */
    wordCounts?: IBenchmarkWordCount[];
    /**
     * The rule could not be run (every pattern is one validation now
     * refuses, only possible on older runs). `passed` is then false but means
     * nothing about the answer; the reason is in `offending`.
     */
    notChecked?: true;
}

/** One field's word count under a `word_count` rule. */
export interface IBenchmarkWordCount {
    path: string;
    words: number;
}

/** One rubric criterion's score on one answer. */
export interface IBenchmarkCriterionScore {
    key: string;
    /** 1 to 5. */
    score: number;
    reasoning?: string;
}

export interface IBenchmarkTaskResult {
    key: string;
    method: BenchmarkTaskMethod;
    /** Rule-check tasks: each rule's outcome. */
    rules?: IBenchmarkRuleResult[];
    /** Rubric tasks: each criterion's score. */
    criteria?: IBenchmarkCriterionScore[];
    /** 0 to 1 agreement with the benchmark (agreement tasks only). */
    agreement?: number;
    fields?: IBenchmarkFieldAgreement[];
    /** Head-to-head result, or the judged outcome of a disagreement. */
    verdict?: BenchmarkVerdict;
    rationale?: string;
    error?: string;
    /** Cost of this task's judge call, when the provider or pricing gave one. */
    judgeCostUsd?: number;
}

/** Persisted per candidate cell. */
export interface IBenchmarkCellDetails {
    tasks: IBenchmarkTaskResult[];
}

export function taskPaths(task: IBenchmarkTask): string[] {
    if (task.method === "agreement")
        return task.fields.map((field) => field.path);
    if (task.method === "rules")
        return [...new Set(task.rules.flatMap((rule) => rule.paths))];
    return task.paths;
}

/** `$.a.b` → `["a", "b"]`; a bare `a` → `["a"]`. Empty segments are invalid. */
export function benchmarkPathSegments(path: string): string[] | undefined {
    const body = path.startsWith("$.") ? path.slice(2) : path;
    if (body.length === 0) return undefined;
    const segments = body.split(".");
    return segments.every((segment) => segment.length > 0)
        ? segments
        : undefined;
}

export function valueAtBenchmarkPath(source: unknown, path: string): unknown {
    const segments = benchmarkPathSegments(path);
    if (!segments) return undefined;
    let value: unknown = source;
    for (const segment of segments) {
        if (!isPlainObject(value)) return undefined;
        value = value[segment];
    }
    return value;
}

// ---------------------------------------------------------------------------
// Proposal
// ---------------------------------------------------------------------------

/**
 * A starting Task Map from the output schema alone: one task per top-level
 * property. Lists compare by set overlap, labels and flags by exact match,
 * numbers within 5%, and free text or nested objects head to head. A person
 * reviews and regroups it before it is used.
 */
export function proposeTaskMapFromSchema(schema: IJsonSchemaObject): ITaskMap {
    const properties = isPlainObject(schema.properties)
        ? schema.properties
        : {};
    const tasks: IBenchmarkTask[] = [];
    for (const [name, raw] of Object.entries(properties)) {
        const property = isPlainObject(raw) ? raw : {};
        const path = `$.${name}`;
        const base = {
            key: taskKeyFor(name, tasks),
            name: humanize(name),
            ...(typeof property.description === "string" &&
            property.description.trim()
                ? { description: property.description.trim() }
                : {}),
        };
        const matcher = matcherForProperty(property);
        tasks.push(
            matcher
                ? {
                      ...base,
                      method: "agreement",
                      fields: [{ path, ...matcher }],
                  }
                : { ...base, method: "head_to_head", paths: [path] },
        );
    }
    return { tasks };
}

function matcherForProperty(
    property: Record<string, unknown>,
): FieldMatcherSpec | undefined {
    if (Array.isArray(property.enum) || "const" in property)
        return { matcher: "exact" };
    switch (primaryType(property.type)) {
        case "array":
            return { matcher: "set_overlap" };
        case "boolean":
        case "integer":
            return { matcher: "exact" };
        case "number":
            return {
                matcher: "numeric_tolerance",
                tolerance: 0.05,
                relative: true,
            };
        default:
            return undefined;
    }
}

function primaryType(type: unknown): string | undefined {
    if (typeof type === "string") return type;
    if (Array.isArray(type))
        return type.find(
            (entry): entry is string =>
                typeof entry === "string" && entry !== "null",
        );
    return undefined;
}

function taskKeyFor(name: string, existing: IBenchmarkTask[]): string {
    const base =
        name
            .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "") || "task";
    let key = base;
    for (let n = 2; existing.some((task) => task.key === key); n++)
        key = `${base}_${n}`;
    return key;
}

function humanize(name: string): string {
    const words = name
        .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
        .replace(/[_\-.]+/g, " ")
        .trim()
        .toLowerCase();
    return words ? words[0]!.toUpperCase() + words.slice(1) : name;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const TASK_KEY = /^[a-z0-9][a-z0-9_-]*$/;

/** Problems that make a Task Map unusable; empty when it is valid. */
export function validateTaskMap(
    taskMap: ITaskMap,
    schema?: IJsonSchemaObject,
): string[] {
    const errors: string[] = [];
    if (taskMap.tasks.length === 0) errors.push("Add at least one task.");
    const keys = new Set<string>();
    const owners = new Map<string, string>();
    for (const task of taskMap.tasks) {
        const label = taskLabel(task);
        if (!TASK_KEY.test(task.key))
            errors.push(
                `${label}: key must be lowercase letters, digits, "_" or "-".`,
            );
        else if (keys.has(task.key))
            errors.push(`${label}: key "${task.key}" is used twice.`);
        keys.add(task.key);
        if (!task.name.trim()) errors.push(`Task "${task.key}" needs a name.`);

        const paths = taskPaths(task);
        if (paths.length === 0)
            errors.push(`${label}: choose at least one output field.`);
        if (task.method === "rules") errors.push(...ruleErrors(label, task));
        if (task.method === "rubric")
            errors.push(...criterionErrors(label, task));
        for (const path of paths) {
            if (!benchmarkPathSegments(path)) {
                errors.push(`${label}: "${path}" is not a valid field path.`);
                continue;
            }
            // Rule checks and rubrics read fields other tasks own; they
            // don't own them.
            if (isSelfScoredTask(task)) {
                if (schema && !schemaHasPath(schema, path))
                    errors.push(
                        `${label}: "${path}" is not in the output schema.`,
                    );
                continue;
            }
            const owner = owners.get(path);
            if (owner && owner !== task.key)
                errors.push(
                    `${label}: "${path}" already belongs to another task.`,
                );
            owners.set(path, task.key);
            if (schema && !schemaHasPath(schema, path))
                errors.push(`${label}: "${path}" is not in the output schema.`);
        }
        if (task.method === "agreement") {
            const fuzzy = task.textMatching?.fuzzy;
            if (fuzzy !== undefined && !(fuzzy > 0 && fuzzy <= 1))
                errors.push(
                    `${label}: fuzzy matching must be above 0 and at most 1.`,
                );
            for (const [name, spellings] of Object.entries(
                task.textMatching?.aliases ?? {},
            )) {
                if (!name.trim() || spellings.some((alias) => !alias.trim()))
                    errors.push(`${label}: aliases cannot be empty.`);
            }
            for (const field of task.fields) {
                if (
                    field.matcher === "numeric_tolerance" &&
                    !(Number.isFinite(field.tolerance) && field.tolerance >= 0)
                )
                    errors.push(
                        `${label}: tolerance for "${field.path}" must be zero or more.`,
                    );
            }
        }
    }
    return errors;
}

function taskLabel(task: IBenchmarkTask): string {
    return task.name.trim() || task.key || "A task";
}

function ruleName(rule: IBenchmarkRule): string {
    return rule.name.trim() || rule.key || "A check";
}

/** "Task / Check", as validation messages name a check. */
export function ruleCheckLabel(
    task: IBenchmarkRulesTask,
    rule: IBenchmarkRule,
): string {
    return `${taskLabel(task)} / ${ruleName(rule)}`;
}

function ruleErrors(label: string, task: IBenchmarkRulesTask): string[] {
    const errors: string[] = [];
    if (task.rules.length === 0)
        errors.push(`${label}: add at least one check.`);
    const keys = new Set<string>();
    for (const rule of task.rules) {
        const name = ruleName(rule);
        if (!TASK_KEY.test(rule.key))
            errors.push(
                `${label} / ${name}: key must be lowercase letters, digits, "_" or "-".`,
            );
        else if (keys.has(rule.key))
            errors.push(`${label}: check key "${rule.key}" is used twice.`);
        keys.add(rule.key);
        if (rule.paths.length === 0)
            errors.push(
                `${label} / ${name}: choose at least one output field.`,
            );
        errors.push(...ruleSettingErrors(`${label} / ${name}`, rule));
    }
    return errors;
}

/** What a check needs besides its fields: a list, or word limits. */
function ruleSettingErrors(label: string, rule: IBenchmarkRule): string[] {
    if (rule.kind === "word_count") return wordLimitErrors(label, rule);
    const errors: string[] = [];
    const list =
        rule.kind === "pattern_absent"
            ? rule.patterns
            : rule.kind === "in_list"
              ? rule.allowed
              : rule.required;
    if (!list || list.filter((entry) => entry.trim()).length === 0)
        errors.push(
            `${label}: add at least one ${
                rule.kind === "pattern_absent"
                    ? "pattern"
                    : rule.kind === "in_list"
                      ? "allowed value"
                      : "required text"
            }.`,
        );
    if (rule.kind === "pattern_absent")
        for (const pattern of rule.patterns ?? []) {
            const problem = rulePatternProblem(pattern);
            if (problem) errors.push(`${label}: ${problem}`);
        }
    return errors;
}

/** Longest pattern a check may use; longer ones are refused. */
export const RULE_PATTERN_MAX_LENGTH = 200;

/**
 * Why a pattern_absent pattern cannot be used, or undefined. A pattern that
 * matches empty text would flag every answer. Patterns are written in
 * JavaScript syntax and run on the worker with a linear-time engine (RE2),
 * which has no lookarounds or backreferences; those are refused here so the
 * form can say so. This check needs no engine, so it is safe in the browser;
 * the server also compiles each pattern with the engine
 * (`@flash-evals/api-contract/rule-patterns`) and refuses what it can't run.
 */
export function rulePatternProblem(pattern: string): string | undefined {
    if (pattern.trim() === "") return "a pattern is empty.";
    if (pattern.length > RULE_PATTERN_MAX_LENGTH)
        return `"${pattern.slice(0, 40)}…" is longer than ${RULE_PATTERN_MAX_LENGTH} characters.`;
    let compiled: RegExp;
    try {
        compiled = new RegExp(pattern, "iu");
    } catch {
        return `"${pattern}" is not a valid pattern.`;
    }
    const unsupported = unsupportedSyntax(pattern);
    if (unsupported)
        return `"${pattern}" uses ${unsupported}, which rule checks can't run; rewrite it without one.`;
    // Testing empty text is instant whatever the pattern.
    if (compiled.test(""))
        return `"${pattern}" matches empty text, so every answer would break it.`;
    return undefined;
}

/**
 * Lookarounds and backreferences in a pattern that is valid JavaScript with
 * the "u" flag, where "\1".."\9" and "\k" can only be backreferences.
 */
function unsupportedSyntax(pattern: string): string | undefined {
    let inClass = false;
    for (let index = 0; index < pattern.length; index++) {
        const char = pattern[index]!;
        if (char === "\\") {
            if (!inClass && /[1-9k]/u.test(pattern[index + 1] ?? ""))
                return "a backreference";
            index++;
        } else if (inClass) {
            if (char === "]") inClass = false;
        } else if (char === "[") inClass = true;
        else if (char === "(" && /^\(\?<?[=!]/u.test(pattern.slice(index)))
            return "a lookahead or lookbehind";
    }
    return undefined;
}

function wordLimitErrors(label: string, rule: IBenchmarkRule): string[] {
    const errors: string[] = [];
    if (rule.min === undefined && rule.max === undefined)
        return [`${label}: set a minimum or a maximum number of words.`];
    for (const [bound, value] of [
        ["minimum", rule.min],
        ["maximum", rule.max],
    ] as const) {
        if (value !== undefined && !(Number.isInteger(value) && value >= 0))
            errors.push(
                `${label}: the ${bound} number of words must be a whole number, zero or more.`,
            );
    }
    if (
        errors.length === 0 &&
        rule.min !== undefined &&
        rule.max !== undefined &&
        rule.min > rule.max
    )
        errors.push(
            `${label}: the minimum number of words (${rule.min}) is above the maximum (${rule.max}).`,
        );
    return errors;
}

function criterionErrors(label: string, task: IBenchmarkRubricTask): string[] {
    const errors: string[] = [];
    if (task.criteria.length === 0)
        errors.push(`${label}: add at least one criterion.`);
    const keys = new Set<string>();
    for (const criterion of task.criteria) {
        const name = criterion.name.trim() || criterion.key || "A criterion";
        if (!TASK_KEY.test(criterion.key))
            errors.push(
                `${label} / ${name}: key must be lowercase letters, digits, "_" or "-".`,
            );
        else if (keys.has(criterion.key))
            errors.push(
                `${label}: criterion key "${criterion.key}" is used twice.`,
            );
        keys.add(criterion.key);
        if (!criterion.name.trim())
            errors.push(`${label}: criterion "${criterion.key}" needs a name.`);
    }
    return errors;
}

function schemaHasPath(schema: IJsonSchemaObject, path: string): boolean {
    const segments = benchmarkPathSegments(path);
    if (!segments) return false;
    let node: unknown = schema;
    for (const segment of segments) {
        if (!isPlainObject(node) || !isPlainObject(node.properties))
            return false;
        node = node.properties[segment];
        if (node === undefined) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface IBenchmarkModelInput {
    /** Run model id. */
    id: string;
    modelId: string;
    /**
     * The run's reference model: the benchmark for model-sourced tasks, and
     * the cost and latency baseline either way.
     */
    isBenchmark: boolean;
}

export interface IBenchmarkCellInput {
    runModelId: string;
    datasetItemId: string;
    /** True when the cell produced an output that was scored. */
    succeeded: boolean;
    costUsd: number | null;
    latencyMs: number | null;
    /** Comparison details; absent on cells with nothing to compare. */
    details?: IBenchmarkCellDetails;
    /**
     * Everything judging this cell cost over every scoring pass, when the
     * caller has it: the comparison judge and any prompt, legacy or
     * transcript judge too. Used for the judging total instead of the
     * details, which only hold the latest comparison pass: a cell scored
     * again keeps what earlier passes paid. A cell without it adds its
     * details' comparison task costs instead, and the model's total then
     * says it is mixed.
     */
    judgeCostUsd?: number;
}

export interface IBenchmarkTaskSummary {
    key: string;
    name: string;
    method: BenchmarkTaskMethod;
    /** The yardstick this task was compared with. */
    source?: BenchmarkSource;
    /** Items compared for this task. */
    n: number;
    /** Mean 0 to 1 agreement (agreement tasks). */
    agreement?: number;
    wins: number;
    ties: number;
    losses: number;
    /** Judge or scoring errors; excluded from the rates. */
    errors: number;
    /** Share of judged items the candidate won or tied. */
    winOrTieRate?: number;
    /** Rubric tasks: each criterion's scores. */
    criteria?: IBenchmarkCriterionSummary[];
    /**
     * Classification tasks (one exact-match field with at most
     * CLASS_BREAKDOWN_MAX_LABELS distinct yardstick values): results per
     * yardstick label, most frequent first. Failed items are not included.
     */
    classes?: IBenchmarkClassResult[];
    /**
     * Items left out of `classes` because the yardstick's or the model's
     * answer was a list or object, not one label. Absent when none were.
     */
    classesSkipped?: number;
    /** Interval and verdict against the policy threshold. */
    assessment: IBenchmarkTaskAssessment;
}

/**
 * One label of a classification task: of the items whose yardstick (stored
 * answer or reference model) has this label, how many the model got right
 * and what it said instead on the rest.
 */
export interface IBenchmarkClassResult {
    /** The yardstick's label, as text ("(empty)" for no value). */
    label: string;
    /** Scored items whose yardstick has this label. */
    total: number;
    /** Of those, items the model matched. */
    correct: number;
    /** Of those, items the model did not match (total - correct). */
    missed: number;
    /** correct / total. */
    recall: number;
    /** Items the model gave this label where the yardstick said otherwise. */
    wronglyGiven: number;
    /** On missed items, what the model answered instead, most frequent first. */
    confusions: Array<{ predicted: string; count: number }>;
}

/** Tasks with more distinct yardstick values are not treated as classes. */
const CLASS_BREAKDOWN_MAX_LABELS = 20;

/** One rubric criterion across a model's answers, scores 1 to 5. */
export interface IBenchmarkCriterionSummary {
    key: string;
    name: string;
    /** Answers the judge scored on it. */
    n: number;
    mean?: number;
    /** The reference model's mean on the same items (`pairs` of them). */
    referenceMean?: number;
    /** Mean of this model's score minus the reference's, per item. */
    difference?: number;
    pairs?: number;
}

export interface IBenchmarkModelSummary {
    runModelId: string;
    modelId: string;
    isBenchmark: boolean;
    /**
     * The run's reference model ("today's model"). Its values are shown, but
     * it has no overall verdict and its tasks carry the neutral "reference"
     * verdict: it is what the candidates are measured against, not one of them.
     */
    isReference?: true;
    /**
     * Items a comparison was possible on: the benchmark model answered them,
     * or, for tasks on stored answers, they have one. On the benchmark row,
     * the items it answered.
     */
    comparableItems: number;
    /** Comparable items this model failed on; counted as losses. */
    failedItems: number;
    /**
     * Per-task results. The benchmark model has only the tasks compared
     * with the stored answers, if any.
     */
    tasks: IBenchmarkTaskSummary[];
    /**
     * Mean agreement across agreement tasks. On the benchmark row, across
     * the tasks compared with the stored answers, if any.
     */
    agreement?: number;
    /** Wins plus ties over all judged task results. */
    winOrTieRate?: number;
    /**
     * Cost on items where both have a cost, divided by the run's reference
     * model's cost on them. Set even when the tasks use stored answers.
     */
    relativeCost?: number;
    /** Mean latency on items where both have one, divided by the reference model's. */
    relativeLatency?: number;
    /** Verdict against the policy; never set on the reference model. */
    assessment?: IBenchmarkModelAssessment;
    /** What judging this model's answers cost, when any judge call reported a cost. */
    judgeCostUsd?: number;
    /**
     * What `judgeCostUsd` covers: "all" judging on the model's cells (the
     * comparison judge plus any prompt, legacy or transcript judge), only
     * the "comparison" judge (latest pass) when the caller gave no cell
     * totals, or "mixed" when some cells had a total and others only the
     * comparison judge's costs.
     */
    judgeCostCovers?: BenchmarkJudgeCostCovers;
}

export type BenchmarkJudgeCostCovers = "all" | "comparison" | "mixed";

/** The items each yardstick can be compared on. */
interface IYardsticks {
    /** The benchmark model's successful cells, when a task uses them. */
    model?: Map<string, IBenchmarkCellInput>;
    /** Items with a stored answer, when a task uses them. */
    labels?: Set<string>;
    /** Items comparable on at least one task. */
    all: Set<string>;
}

/**
 * Per-model, per-task comparison with the benchmark. Each task is compared
 * on the items its yardstick covers: the items the benchmark model answered,
 * or the items with a stored answer. A model that fails a comparable item
 * gets zero agreement and a loss on every task for it, so failures never
 * flatter a model.
 *
 * When any task uses the benchmark model, that model is the benchmark row;
 * it is also scored on the tasks that use stored answers. Otherwise every
 * model is a candidate.
 */
export function summarizeBenchmarkComparison(input: {
    taskMap: ITaskMap;
    models: IBenchmarkModelInput[];
    cells: IBenchmarkCellInput[];
    policy?: IBenchmarkPolicy;
    /**
     * The run's `benchmark.source`; tasks without their own source use it.
     * Defaults to "labels" when `labeledItemIds` is given, else "model".
     */
    source?: BenchmarkSource;
    /**
     * Items with a stored answer, needed when any task uses the dataset's
     * answers as its benchmark.
     */
    labeledItemIds?: string[];
}): IBenchmarkModelSummary[] {
    const config = {
        source:
            input.source ??
            (input.labeledItemIds ? ("labels" as const) : ("model" as const)),
        taskMap: input.taskMap,
    };
    const yardsticks = benchmarkCellsFor(input, config);
    if (!yardsticks) return [];
    // Cost and latency are compared with the run's reference model whatever
    // the tasks are scored against, so stored-answer runs still show them.
    const referenceCells = yardsticks.model ?? referenceCellsOf(input);
    const sourced = input.taskMap.tasks.map((task) => ({
        task,
        source: benchmarkTaskSource(task, config),
    }));
    const covers = (source: BenchmarkSource, itemId: string) =>
        source === "model"
            ? (yardsticks.model?.has(itemId) ?? false)
            : (yardsticks.labels?.has(itemId) ?? false);
    const coversTask = (
        task: IBenchmarkTask,
        source: BenchmarkSource,
        itemId: string,
    ) => isSelfScoredTask(task) || covers(source, itemId);
    // The reference model's per-item score on tasks it is scored on itself
    // (stored answers), so candidates can be compared with it item by item.
    const referenceScores = referenceTaskScores(input, sourced);
    const referenceCriteria = referenceCriterionScores(input);
    const summarizeTasks = (
        tasks: typeof sourced,
        cells: IBenchmarkCellInput[],
        withReference = false,
    ) =>
        tasks.map(({ task, source }) =>
            summarizeTask(
                task,
                source,
                cells.filter((cell) =>
                    coversTask(task, source, cell.datasetItemId),
                ),
                input.policy,
                withReference ? referenceScores.get(task.key) : undefined,
                withReference ? referenceCriteria.get(task.key) : undefined,
            ),
        );

    return input.models.map((model) => {
        const hasSelfScored = input.taskMap.tasks.some(isSelfScoredTask);
        const cells = input.cells.filter(
            (cell) =>
                cell.runModelId === model.id &&
                (hasSelfScored || yardsticks.all.has(cell.datasetItemId)),
        );
        if (model.isBenchmark && yardsticks.model) {
            return benchmarkRow({
                model,
                benchmarkCells: yardsticks.model,
                tasks: summarizeTasks(
                    sourced.filter(
                        ({ task, source }) =>
                            isSelfScoredTask(task) || source === "labels",
                    ),
                    cells,
                ),
                cells: cells.filter(
                    (cell) =>
                        sourced.some(({ task }) => isSelfScoredTask(task)) ||
                        covers("labels", cell.datasetItemId),
                ),
            });
        }

        const tasks = summarizeTasks(sourced, cells, !model.isBenchmark);

        const failedItems = cells.filter((cell) => !cell.succeeded).length;
        const judgeCost = sumJudgeCost(cells);
        const relativeCost = pairedRatio(
            cells,
            referenceCells,
            (cell) => cell.costUsd,
        );
        const row: IBenchmarkModelSummary = {
            runModelId: model.id,
            modelId: model.modelId,
            isBenchmark: false,
            comparableItems: yardsticks.all.size,
            failedItems,
            tasks,
            ...overallRates(tasks),
            relativeCost,
            relativeLatency: pairedRatio(
                cells,
                referenceCells,
                (cell) => cell.latencyMs,
            ),
            ...judgeCost,
        };
        // On stored answers the reference model is scored like a candidate,
        // but it is the yardstick for the others: its values are shown,
        // never judged.
        if (model.isBenchmark) return asReferenceRow(row);
        return {
            ...row,
            assessment: assessModel({
                tasks: tasks.map((task) => ({
                    name: task.name,
                    assessment: task.assessment,
                })),
                relativeCost,
                failedItems,
                policy: input.policy,
            }),
        };
    });
}

/**
 * The reference model's row: no overall verdict, and each task's verdict
 * replaced by the neutral "reference" (its value and range are kept).
 */
function asReferenceRow(row: IBenchmarkModelSummary): IBenchmarkModelSummary {
    const { assessment: _verdict, ...rest } = row;
    return {
        ...rest,
        isReference: true,
        tasks: row.tasks.map((task) => ({
            ...task,
            assessment: { ...task.assessment, verdict: "reference" },
        })),
    };
}

const VERDICT_RANK: Record<BenchmarkModelVerdict, number> = {
    pass: 0,
    conditional: 1,
    inconclusive: 2,
    fail: 3,
};

/**
 * The candidate closest to replacing the reference model: best verdict
 * first, then fewest tasks below target, then lowest cost relative to the
 * reference, then highest agreement. The reference model itself (by
 * `referenceRunModelId`, or the benchmark row) is never a candidate, and
 * neither is a model without a verdict. The page headline uses this, so it
 * always agrees with the verdicts.
 */
export function pickClosestReplacement(
    models: readonly IBenchmarkModelSummary[],
    referenceRunModelId?: string,
): IBenchmarkModelSummary | undefined {
    const candidates = models.filter(
        (model) =>
            !model.isBenchmark &&
            model.runModelId !== referenceRunModelId &&
            model.assessment !== undefined,
    );
    const failedTasks = (model: IBenchmarkModelSummary) =>
        model.tasks.filter((task) => task.assessment.verdict === "fail").length;
    const rank = (model: IBenchmarkModelSummary): number[] => [
        VERDICT_RANK[model.assessment!.verdict],
        failedTasks(model),
        model.relativeCost ?? Infinity,
        -(model.agreement ?? model.winOrTieRate ?? -Infinity),
    ];
    let best: IBenchmarkModelSummary | undefined;
    for (const model of candidates) {
        if (!best || compareRanks(rank(model), rank(best)) < 0) best = model;
    }
    return best;
}

function compareRanks(a: number[], b: number[]): number {
    for (let i = 0; i < a.length; i++) {
        if (a[i]! !== b[i]!) return a[i]! < b[i]! ? -1 : 1;
    }
    return 0;
}

/**
 * The benchmark model's row: the yardstick for the model-sourced tasks, and
 * scored like a candidate on the tasks that use stored answers, if any.
 */
function benchmarkRow(input: {
    model: IBenchmarkModelInput;
    benchmarkCells: Map<string, IBenchmarkCellInput>;
    /** Summaries of the tasks that use stored answers. */
    tasks: IBenchmarkTaskSummary[];
    /** Its cells on items with a stored answer. */
    cells: IBenchmarkCellInput[];
}): IBenchmarkModelSummary {
    const row: IBenchmarkModelSummary = {
        runModelId: input.model.id,
        modelId: input.model.modelId,
        isBenchmark: true,
        comparableItems: input.benchmarkCells.size,
        failedItems: 0,
        tasks: [],
        relativeCost: anyValue(input.benchmarkCells, (cell) => cell.costUsd)
            ? 1
            : undefined,
        relativeLatency: anyValue(
            input.benchmarkCells,
            (cell) => cell.latencyMs,
        )
            ? 1
            : undefined,
    };
    if (input.tasks.length === 0) return asReferenceRow(row);
    const judgeCost = sumJudgeCost(input.cells);
    const rates = overallRates(input.tasks);
    return asReferenceRow({
        ...row,
        failedItems: input.cells.filter((cell) => !cell.succeeded).length,
        tasks: input.tasks,
        ...(rates.agreement !== undefined
            ? { agreement: rates.agreement }
            : {}),
        ...(rates.winOrTieRate !== undefined
            ? { winOrTieRate: rates.winOrTieRate }
            : {}),
        ...judgeCost,
    });
}

/** Mean agreement across agreement tasks, and wins plus ties over all judged results. */
function overallRates(
    tasks: IBenchmarkTaskSummary[],
): Pick<IBenchmarkModelSummary, "agreement" | "winOrTieRate"> {
    const agreements = tasks
        .map((task) => task.agreement)
        .filter((value): value is number => value !== undefined);
    const judged = tasks.reduce(
        (total, task) => total + task.wins + task.ties + task.losses,
        0,
    );
    const winsOrTies = tasks.reduce(
        (total, task) => total + task.wins + task.ties,
        0,
    );
    return {
        agreement: mean(agreements),
        winOrTieRate: judged > 0 ? winsOrTies / judged : undefined,
    };
}

/**
 * A model's judging total: per cell, its own total (all judging) when it has
 * one, else its comparison tasks' costs, so no cell's judging is left out.
 * The label says which sources were added, "mixed" when both were.
 */
function sumJudgeCost(
    cells: IBenchmarkCellInput[],
): Pick<IBenchmarkModelSummary, "judgeCostUsd" | "judgeCostCovers"> {
    const sources = new Set<"all" | "comparison">();
    let total = 0;
    for (const cell of cells) {
        if (cell.judgeCostUsd !== undefined) {
            total += cell.judgeCostUsd;
            sources.add("all");
            continue;
        }
        for (const task of cell.details?.tasks ?? []) {
            if (task.judgeCostUsd === undefined) continue;
            total += task.judgeCostUsd;
            sources.add("comparison");
        }
    }
    if (sources.size === 0) return {};
    return {
        judgeCostUsd: total,
        judgeCostCovers: sources.size > 1 ? "mixed" : [...sources][0]!,
    };
}

/**
 * The items each yardstick in use covers, or undefined when a task needs
 * the benchmark model and the run has none.
 */
function benchmarkCellsFor(
    input: {
        models: IBenchmarkModelInput[];
        cells: IBenchmarkCellInput[];
        labeledItemIds?: string[];
    },
    config: Pick<IRunBenchmarkConfig, "source" | "taskMap">,
): IYardsticks | undefined {
    const yardsticks: IYardsticks = { all: new Set() };
    if (benchmarkUsesSource(config, "model")) {
        if (!input.models.some((model) => model.isBenchmark)) return undefined;
        yardsticks.model = referenceCellsOf(input);
    }
    if (benchmarkUsesSource(config, "labels"))
        yardsticks.labels = new Set(input.labeledItemIds ?? []);
    for (const itemId of [
        ...(yardsticks.model?.keys() ?? []),
        ...(yardsticks.labels ?? []),
    ])
        yardsticks.all.add(itemId);
    return yardsticks;
}

/** The reference (benchmark) model's successful cells by item; empty without one. */
function referenceCellsOf(input: {
    models: IBenchmarkModelInput[];
    cells: IBenchmarkCellInput[];
}): Map<string, IBenchmarkCellInput> {
    const reference = input.models.find((model) => model.isBenchmark);
    if (!reference) return new Map();
    return new Map(
        input.cells
            .filter(
                (cell) => cell.runModelId === reference.id && cell.succeeded,
            )
            .map((cell) => [cell.datasetItemId, cell]),
    );
}

/** True when a task's rate is a judge's won-or-tied share. */
export function isJudgedTask(task: IBenchmarkTask): boolean {
    return (
        task.method === "head_to_head" ||
        (task.method === "agreement" && task.judgeDisagreements === true)
    );
}

/** 1 when a judged item was won or tied, 0 when lost; undefined without a verdict. */
function wonOrTied(verdict: BenchmarkVerdict | undefined): number | undefined {
    if (verdict === "win" || verdict === "tie") return 1;
    return verdict === "loss" ? 0 : undefined;
}

/**
 * Per task, the reference model's own score on each item, on tasks where it
 * is scored too: rule checks, rubrics, and tasks against stored answers. For
 * judged tasks the score is 1 when it won or tied against the stored answer
 * and 0 when it lost; otherwise it is the agreement. A failed reference
 * answer scores 0, as it does in the reference's own row and as a failed
 * candidate answer does.
 */
function referenceTaskScores(
    input: { models: IBenchmarkModelInput[]; cells: IBenchmarkCellInput[] },
    sourced: Array<{ task: IBenchmarkTask; source: BenchmarkSource }>,
): Map<string, Map<string, number>> {
    const scores = new Map<string, Map<string, number>>();
    const reference = input.models.find((model) => model.isBenchmark);
    if (!reference) return scores;
    for (const { task, source } of sourced) {
        if (!isSelfScoredTask(task) && source !== "labels") continue;
        const judged = isJudgedTask(task);
        const byItem = new Map<string, number>();
        for (const cell of input.cells) {
            if (cell.runModelId !== reference.id) continue;
            if (!cell.succeeded) {
                byItem.set(cell.datasetItemId, 0);
                continue;
            }
            const result = cell.details?.tasks.find(
                (entry) => entry.key === task.key,
            );
            const score = judged
                ? wonOrTied(result?.verdict)
                : result?.agreement;
            if (score !== undefined) byItem.set(cell.datasetItemId, score);
        }
        scores.set(task.key, byItem);
    }
    return scores;
}

/** Per rubric task, item and criterion: the reference model's score. */
function referenceCriterionScores(input: {
    models: IBenchmarkModelInput[];
    cells: IBenchmarkCellInput[];
}): Map<string, Map<string, Map<string, number>>> {
    const scores = new Map<string, Map<string, Map<string, number>>>();
    const reference = input.models.find((model) => model.isBenchmark);
    if (!reference) return scores;
    for (const cell of input.cells) {
        if (cell.runModelId !== reference.id || !cell.succeeded) continue;
        for (const result of cell.details?.tasks ?? []) {
            if (!result.criteria) continue;
            const byItem =
                scores.get(result.key) ??
                new Map<string, Map<string, number>>();
            byItem.set(
                cell.datasetItemId,
                new Map(result.criteria.map((c) => [c.key, c.score])),
            );
            scores.set(result.key, byItem);
        }
    }
    return scores;
}

/**
 * Mean score per rubric criterion. With the reference model's scores, also
 * its mean and the mean difference, both on the items both were scored on.
 */
function summarizeCriteria(
    task: IBenchmarkRubricTask,
    cells: IBenchmarkCellInput[],
    referenceByItem?: Map<string, Map<string, number>>,
): IBenchmarkCriterionSummary[] {
    return task.criteria.map((criterion) => {
        const scores: number[] = [];
        const references: number[] = [];
        const differences: number[] = [];
        for (const cell of cells) {
            if (!cell.succeeded) continue;
            const score = cell.details?.tasks
                .find((entry) => entry.key === task.key)
                ?.criteria?.find((entry) => entry.key === criterion.key)?.score;
            if (score === undefined) continue;
            scores.push(score);
            const reference = referenceByItem
                ?.get(cell.datasetItemId)
                ?.get(criterion.key);
            if (reference === undefined) continue;
            references.push(reference);
            differences.push(score - reference);
        }
        const average = mean(scores);
        const referenceMean = mean(references);
        const difference = mean(differences);
        return {
            key: criterion.key,
            name: criterion.name,
            n: scores.length,
            ...(average !== undefined ? { mean: average } : {}),
            ...(referenceMean !== undefined && difference !== undefined
                ? { referenceMean, difference, pairs: differences.length }
                : {}),
        };
    });
}

function summarizeTask(
    task: IBenchmarkTask,
    source: BenchmarkSource,
    cells: IBenchmarkCellInput[],
    policy: IBenchmarkPolicy | undefined,
    referenceByItem?: Map<string, number>,
    referenceCriteria?: Map<string, Map<string, number>>,
): IBenchmarkTaskSummary {
    const agreements: number[] = [];
    const referencePairs: Array<[number, number]> = [];
    const pairWithReference = (itemId: string, agreement: number) => {
        const reference = referenceByItem?.get(itemId);
        if (reference !== undefined)
            referencePairs.push([agreement, reference]);
    };
    const summary: Omit<IBenchmarkTaskSummary, "assessment"> = {
        key: task.key,
        name: task.name,
        method: task.method,
        // Rule checks and rubrics have no yardstick.
        ...(isSelfScoredTask(task) ? {} : { source }),
        n: 0,
        wins: 0,
        ties: 0,
        losses: 0,
        errors: 0,
    };
    // Judged tasks pair won-or-tied (1 or 0) with the reference's own
    // result on the item; other tasks pair agreement. A failed item is 0
    // either way.
    const judges = isJudgedTask(task);

    for (const cell of cells) {
        if (!cell.succeeded) {
            summary.n++;
            if (task.method !== "head_to_head") agreements.push(0);
            pairWithReference(cell.datasetItemId, 0);
            if (judges) summary.losses++;
            continue;
        }
        const result = cell.details?.tasks.find(
            (entry) => entry.key === task.key,
        );
        if (!result) continue;
        summary.n++;
        if (result.error) summary.errors++;
        if (task.method !== "head_to_head" && result.agreement !== undefined) {
            agreements.push(result.agreement);
            if (!judges)
                pairWithReference(cell.datasetItemId, result.agreement);
        }
        const judgedScore = judges ? wonOrTied(result.verdict) : undefined;
        if (judgedScore !== undefined)
            pairWithReference(cell.datasetItemId, judgedScore);
        if (result.verdict === "win") summary.wins++;
        else if (result.verdict === "tie") summary.ties++;
        else if (result.verdict === "loss") summary.losses++;
    }

    const judged = summary.wins + summary.ties + summary.losses;
    const winsOrTies = summary.wins + summary.ties;
    const agreement =
        task.method !== "head_to_head" ? mean(agreements) : undefined;
    const winOrTieRate = judged > 0 ? winsOrTies / judged : undefined;
    return {
        ...summary,
        ...(agreement !== undefined ? { agreement } : {}),
        ...(winOrTieRate !== undefined ? { winOrTieRate } : {}),
        ...(task.method === "rubric"
            ? { criteria: summarizeCriteria(task, cells, referenceCriteria) }
            : {}),
        ...classBreakdown(task, cells),
        assessment: judges
            ? assessTask({
                  key: task.key,
                  judged: true,
                  n: judged,
                  value: winOrTieRate,
                  interval: wilsonInterval(winsOrTies, judged),
                  policy,
                  ...(referenceByItem ? { referencePairs } : {}),
              })
            : assessTask({
                  key: task.key,
                  judged: false,
                  n: agreements.length,
                  value: agreement,
                  interval: agreementInterval(agreements),
                  policy,
                  ...(referenceByItem ? { referencePairs } : {}),
              }),
    };
}

function classLabel(value: unknown): string {
    if (value === undefined || value === null || value === "") return "(empty)";
    return typeof value === "string" ? value : JSON.stringify(value);
}

/** A succeeded cell's scored field for a task, unless the task errored. */
function scoredField(
    cell: IBenchmarkCellInput,
    taskKey: string,
    path: string,
): IBenchmarkFieldAgreement | undefined {
    if (!cell.succeeded) return undefined;
    const result = cell.details?.tasks.find((entry) => entry.key === taskKey);
    if (!result || result.error) return undefined;
    return result.fields?.find((entry) => entry.path === path);
}

/**
 * The key a value is grouped under: text as scoring compares it (already
 * canonical from `canonicalizePair`), other values as JSON.
 */
function classKey(value: unknown): string {
    return typeof value === "string" && value !== ""
        ? `text:${value}`
        : `json:${classLabel(value)}`;
}

/** How often each spelling of each label was seen. */
class Spellings {
    private readonly byKey = new Map<string, Map<string, number>>();

    add(key: string, raw: unknown): void {
        const spelling = classLabel(typeof raw === "string" ? raw.trim() : raw);
        const counts = this.byKey.get(key) ?? new Map<string, number>();
        counts.set(spelling, (counts.get(spelling) ?? 0) + 1);
        this.byKey.set(key, counts);
    }

    /** The most common spelling; the first seen on a tie. */
    get(key: string): string | undefined {
        let best: [string, number] | undefined;
        for (const entry of this.byKey.get(key) ?? [])
            if (!best || entry[1] > best[1]) best = entry;
        return best?.[0];
    }
}

/**
 * Per-label results for a classification task: one exact-match field whose
 * yardstick values are scalars and few. Labels are grouped as scoring
 * compares them (trimmed, ignoring case, the task's aliases and fuzzy
 * rule), so "Sales" and "sales" are one label, shown as the yardstick most
 * often spells it. A match is the field's own score (1).
 */
function classBreakdown(
    task: IBenchmarkTask,
    cells: IBenchmarkCellInput[],
): { classes?: IBenchmarkClassResult[]; classesSkipped?: number } {
    if (task.method !== "agreement" || task.fields.length !== 1) return {};
    const field = task.fields[0]!;
    if (field.matcher !== "exact") return {};
    const byLabel = new Map<
        string,
        { total: number; correct: number; confusions: Map<string, number> }
    >();
    const wronglyGiven = new Map<string, number>();
    const truthSpellings = new Spellings();
    const answerSpellings = new Spellings();
    const isObject = (value: unknown) =>
        typeof value === "object" && value !== null;
    // A list or object answer has no one label: that item is left out.
    let skipped = 0;
    for (const cell of cells) {
        const scored = scoredField(cell, task.key, field.path);
        if (!scored) continue;
        if (isObject(scored.benchmark) || isObject(scored.candidate)) {
            skipped++;
            continue;
        }
        const pair = canonicalizePair(
            scored.candidate,
            scored.benchmark,
            task.textMatching,
        );
        const label = classKey(pair.benchmark);
        truthSpellings.add(label, scored.benchmark);
        const entry = byLabel.get(label) ?? {
            total: 0,
            correct: 0,
            confusions: new Map<string, number>(),
        };
        entry.total++;
        if (scored.score >= 1) entry.correct++;
        else {
            const predicted = classKey(pair.candidate);
            answerSpellings.add(predicted, scored.candidate);
            entry.confusions.set(
                predicted,
                (entry.confusions.get(predicted) ?? 0) + 1,
            );
            wronglyGiven.set(predicted, (wronglyGiven.get(predicted) ?? 0) + 1);
        }
        byLabel.set(label, entry);
        if (byLabel.size > CLASS_BREAKDOWN_MAX_LABELS) return {};
    }
    if (byLabel.size === 0) return {};
    const shown = (key: string) =>
        truthSpellings.get(key) ?? answerSpellings.get(key) ?? key;
    const classes = [...byLabel]
        .map(([key, entry]) => ({ key, label: shown(key), entry }))
        .sort(
            (a, b) =>
                b.entry.total - a.entry.total || a.label.localeCompare(b.label),
        )
        .map(({ key, label, entry }): IBenchmarkClassResult => ({
            label,
            total: entry.total,
            correct: entry.correct,
            missed: entry.total - entry.correct,
            recall: entry.correct / entry.total,
            wronglyGiven: wronglyGiven.get(key) ?? 0,
            confusions: [...entry.confusions]
                .map(([predicted, count]) => ({
                    predicted: shown(predicted),
                    count,
                }))
                .sort(
                    (a, b) =>
                        b.count - a.count ||
                        a.predicted.localeCompare(b.predicted),
                ),
        }));
    return { classes, ...(skipped > 0 ? { classesSkipped: skipped } : {}) };
}

function pairedRatio(
    cells: IBenchmarkCellInput[],
    benchmarkCells: Map<string, IBenchmarkCellInput>,
    value: (cell: IBenchmarkCellInput) => number | null,
): number | undefined {
    // Summed over the same item pairs on both sides, so this ratio also
    // equals the ratio of means.
    let candidateTotal = 0;
    let benchmarkTotal = 0;
    let pairs = 0;
    for (const cell of cells) {
        const benchmarkCell = benchmarkCells.get(cell.datasetItemId);
        const candidateValue = value(cell);
        const benchmarkValue = benchmarkCell ? value(benchmarkCell) : null;
        if (candidateValue == null || benchmarkValue == null) continue;
        candidateTotal += candidateValue;
        benchmarkTotal += benchmarkValue;
        pairs++;
    }
    if (pairs === 0 || benchmarkTotal <= 0) return undefined;
    return candidateTotal / benchmarkTotal;
}

function anyValue(
    cells: Map<string, IBenchmarkCellInput>,
    value: (cell: IBenchmarkCellInput) => number | null,
): boolean {
    return [...cells.values()].some((cell) => value(cell) != null);
}

function mean(values: number[]): number | undefined {
    return values.length === 0
        ? undefined
        : values.reduce((total, value) => total + value, 0) / values.length;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
