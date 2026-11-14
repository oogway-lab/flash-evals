import {
    benchmarkPathSegments,
    valueAtBenchmarkPath,
    type IBenchmarkCellDetails,
} from "./benchmark.js";
import {
    placeholderValue,
    renderTemplate,
    templatePlaceholderList,
    templateStepNamed,
} from "./stepTemplates.js";

/**
 * Conditions that let a pipeline step end the chain for an item: a step with
 * a condition runs only when a field of an earlier step's answer matches.
 * When it does not, the step and every step after it are skipped for that
 * item: no model call, no cost, recorded as skipped.
 */

/** A value a step's answer field is compared with. */
export type WorkflowConditionValue = string | number | boolean | null;

export interface IWorkflowStepCondition {
    /** The earlier step (node key) whose answer is checked. */
    stepKey: string;
    /** Field of that answer, e.g. `$.is_sales` or `$.call.kind`. */
    path: string;
    /** "equals" uses the first value; "one_of" any of them. */
    operator: "equals" | "one_of";
    values: WorkflowConditionValue[];
    /** Compare text ignoring upper and lower case ("Sales" is "sales"). */
    ignoreCase?: boolean;
}

/** The answer a step produced: its parsed JSON, else its text as JSON, else the text. */
export function stepAnswerValue(artifact: {
    text?: string;
    json?: Record<string, unknown>;
}): unknown {
    if (artifact.json !== undefined) return artifact.json;
    const text = artifact.text ?? "";
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}

function sameValue(
    left: unknown,
    right: WorkflowConditionValue,
    ignoreCase = false,
): boolean {
    if (left === undefined) return false;
    if (ignoreCase && typeof left === "string" && typeof right === "string")
        return left.toLowerCase() === right.toLowerCase();
    return left === right;
}

/** Whether the step may run: the checked field matches the condition. */
export function stepConditionHolds(
    condition: IWorkflowStepCondition,
    answer: unknown,
): boolean {
    const value =
        condition.path.trim() === "$" || condition.path.trim() === ""
            ? answer
            : valueAtBenchmarkPath(answer, condition.path);
    const values =
        condition.operator === "equals"
            ? condition.values.slice(0, 1)
            : condition.values;
    return values.some((expected) =>
        sameValue(value, expected, condition.ignoreCase === true),
    );
}

/** Splits `a, "b, c"` on commas outside double quotes. */
function splitOnCommas(text: string): string[] {
    const parts: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of text) {
        if (char === '"') quoted = !quoted;
        if (char === "," && !quoted) {
            parts.push(current);
            current = "";
        } else current += char;
    }
    parts.push(current);
    return parts;
}

/**
 * Values typed in a form, comma separated: `true`, `false`, `null` and
 * numbers become those values; anything else stays text (quotes optional;
 * a quoted value may hold commas).
 */
export function parseConditionValues(text: string): WorkflowConditionValue[] {
    return splitOnCommas(text)
        .map((part) => part.trim())
        .filter((part) => part.length > 0)
        .map((part): WorkflowConditionValue => {
            if (part === "true") return true;
            if (part === "false") return false;
            if (part === "null") return null;
            if (/^-?\d+(\.\d+)?$/.test(part)) return Number(part);
            const quoted = /^"(.*)"$/.exec(part);
            return quoted ? quoted[1]! : part;
        });
}

/** The inverse of `parseConditionValues`, for showing saved values in a form. */
export function formatConditionValues(
    values: readonly WorkflowConditionValue[],
): string {
    return values
        .map((value) =>
            typeof value === "string" &&
            (["true", "false", "null"].includes(value) || value.includes(","))
                ? `"${value}"`
                : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value)
                  ? `"${value}"`
                  : String(value),
        )
        .join(", ");
}

/**
 * One value typed in a form: `true`, `false`, `null` and numbers become
 * those values, quoted text is text; anything else stays text as typed
 * (blank is empty text).
 */
export function parseFinalValue(text: string): WorkflowConditionValue {
    const trimmed = text.trim();
    if (trimmed === "true") return true;
    if (trimmed === "false") return false;
    if (trimmed === "null") return null;
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
    const quoted = /^"(.*)"$/.exec(trimmed);
    return quoted ? quoted[1]! : text;
}

/** The inverse of `parseFinalValue`, for showing a saved value in a form. */
export function formatFinalValue(value: WorkflowConditionValue): string {
    return typeof value === "string" && value.length > 0
        ? formatConditionValues([value])
        : typeof value === "string"
          ? ""
          : String(value);
}

/**
 * Problems with a step's condition, given the steps that run before it
 * (its ancestors). Empty when it is valid.
 */
export function stepConditionErrors(
    condition: IWorkflowStepCondition,
    label: string,
    ancestorKeys: ReadonlySet<string>,
): string[] {
    const errors: string[] = [];
    if (!ancestorKeys.has(condition.stepKey))
        errors.push(
            `Step "${label}" can only check a step that runs before it.`,
        );
    if (
        typeof condition.path !== "string" ||
        (condition.path.trim() !== "$" &&
            benchmarkPathSegments(condition.path.trim()) === undefined)
    )
        errors.push(
            `Step "${label}" needs a field to check, such as $.is_sales.`,
        );
    if (condition.operator !== "equals" && condition.operator !== "one_of")
        errors.push(`Step "${label}" has an unknown condition.`);
    if (
        condition.ignoreCase !== undefined &&
        typeof condition.ignoreCase !== "boolean"
    )
        errors.push(`Step "${label}" needs ignoreCase to be true or false.`);
    if (!Array.isArray(condition.values) || condition.values.length === 0)
        errors.push(`Step "${label}" needs at least one value to match.`);
    else if (
        condition.values.some(
            (value) =>
                value !== null &&
                !["string", "number", "boolean"].includes(typeof value),
        )
    )
        errors.push(
            `Step "${label}" can only match text, numbers, true, false or null.`,
        );
    return errors;
}

/**
 * Several conditions that must all hold, e.g. `$.archived` is false and
 * `$.type` is "sales". Stored as an object, not a bare array, so a saved
 * single condition keeps its shape.
 */
export interface IWorkflowStepConditionGroup {
    all: IWorkflowStepCondition[];
}

/** A step's run condition: one condition, or several that must all hold. */
export type WorkflowRunCondition =
    IWorkflowStepCondition | IWorkflowStepConditionGroup;

/** The conditions of a run condition, one or several; none when unset. */
export function runConditionList(
    condition: WorkflowRunCondition | null | undefined,
): IWorkflowStepCondition[] {
    if (!condition) return [];
    return "all" in condition ? condition.all : [condition];
}

/** A run condition from a list: one condition stays a single condition. */
export function runConditionFrom(
    conditions: readonly IWorkflowStepCondition[],
): WorkflowRunCondition | undefined {
    if (conditions.length === 0) return undefined;
    if (conditions.length === 1) return conditions[0];
    return { all: [...conditions] };
}

/** Problems with a step's run condition (one or several); empty when valid. */
export function runConditionErrors(
    condition: WorkflowRunCondition,
    label: string,
    ancestorKeys: ReadonlySet<string>,
): string[] {
    if (typeof condition !== "object" || condition === null)
        return [`Step "${label}" has an unknown condition.`];
    if ("all" in condition) {
        if (!Array.isArray(condition.all) || condition.all.length === 0)
            return [`Step "${label}" needs at least one condition.`];
        return condition.all.flatMap((part) =>
            typeof part === "object" && part !== null
                ? stepConditionErrors(part, label, ancestorKeys)
                : [`Step "${label}" has an unknown condition.`],
        );
    }
    return stepConditionErrors(condition, label, ancestorKeys);
}

/** Plain words for a condition, e.g. `Runs only when Classify $.is_sales is true`. */
export function describeStepCondition(
    condition: IWorkflowStepCondition,
    stepLabel: string,
): string {
    const values = formatConditionValues(condition.values);
    const anyCase = condition.ignoreCase ? " (any case)" : "";
    return condition.operator === "equals"
        ? `Runs only when ${stepLabel} ${condition.path} is ${values}${anyCase}`
        : `Runs only when ${stepLabel} ${condition.path} is one of ${values}${anyCase}`;
}

/**
 * Plain words for a run condition, e.g. `Runs only when Extract $.archived
 * is false and Extract $.type is sales`.
 */
export function describeRunCondition(
    condition: WorkflowRunCondition,
    labelFor: (stepKey: string) => string,
): string {
    return runConditionList(condition)
        .map((part, index) => {
            const text = describeStepCondition(part, labelFor(part.stepKey));
            return index === 0 ? text : text.replace(/^Runs only when /, "");
        })
        .join(" and ");
}

// ---------------------------------------------------------------------------
// Step settings
// ---------------------------------------------------------------------------

/** Longest input template a step may have. */
export const STEP_INPUT_TEMPLATE_MAX_LENGTH = 20_000;

/** Largest output limit a step may ask for. */
export const STEP_MAX_OUTPUT_TOKENS = 200_000;

function isNumberIn(value: unknown, min: number, max: number): boolean {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= min &&
        value <= max
    );
}

/** Each setting's check: when it is set and fails, the plain-words problem. */
const STEP_SETTING_CHECKS: Array<{
    key: string;
    ok: (value: unknown) => boolean;
    problem: (label: string) => string;
}> = [
    {
        key: "temperature",
        ok: (value) => isNumberIn(value, 0, 2),
        problem: (label) => `Step "${label}" needs a temperature from 0 to 2.`,
    },
    {
        key: "maxOutputTokens",
        ok: (value) =>
            Number.isInteger(value) &&
            isNumberIn(value, 1, STEP_MAX_OUTPUT_TOKENS),
        problem: (label) =>
            `Step "${label}" needs an output limit from 1 to ${STEP_MAX_OUTPUT_TOKENS.toLocaleString("en-US")} tokens.`,
    },
    {
        key: "outputMode",
        ok: (value) =>
            ["json_schema", "json_object", "text"].includes(value as string),
        problem: (label) =>
            `Step "${label}" has an unknown output mode; use json_schema, json_object or text.`,
    },
    {
        key: "inputTemplate",
        ok: (value) =>
            typeof value === "string" &&
            value.length <= STEP_INPUT_TEMPLATE_MAX_LENGTH,
        problem: (label) =>
            `Step "${label}" needs an input template of text up to ${STEP_INPUT_TEMPLATE_MAX_LENGTH.toLocaleString("en-US")} characters.`,
    },
];

/** Problems with a step's settings, in plain words; empty when valid. */
export function stepSettingsErrors(settings: unknown, label: string): string[] {
    if (settings === undefined || settings === null) return [];
    if (typeof settings !== "object" || Array.isArray(settings))
        return [`Step "${label}" has settings that aren't an object.`];
    const values = settings as Record<string, unknown>;
    return STEP_SETTING_CHECKS.flatMap((check) =>
        values[check.key] === undefined || check.ok(values[check.key])
            ? []
            : [check.problem(label)],
    );
}

// ---------------------------------------------------------------------------
// Final answer
// ---------------------------------------------------------------------------

/**
 * A value used in a final-answer field instead of a step's: a fixed value,
 * or a template whose `{{step.$.field}}` placeholders take values from steps
 * that ran (the step by its label or key; `$` for its whole answer). A
 * template that is exactly one placeholder keeps that value's type; any
 * other template is text, with a missing value written as nothing.
 */
export type FinalAnswerFallback =
    { value: WorkflowConditionValue } | { template: string };

/** Replace one exact value of a field, e.g. "" with "Customer". */
export interface IFinalAnswerValueMapping {
    from: WorkflowConditionValue;
    to: WorkflowConditionValue;
}

/** One field of a pipeline's final answer, taken from a step's answer. */
export interface IPipelineFinalAnswerField {
    /** Where it goes in the final answer, e.g. `$.mom`. */
    path: string;
    /** The step (node key) it comes from. */
    stepKey: string;
    /** Field of that step's answer, e.g. `$.mom`; `$` for the whole answer. */
    stepPath: string;
    /**
     * Used when the step was skipped (its gate was closed), and when the
     * value is empty and `whenEmpty` is not set.
     */
    fallback?: FinalAnswerFallback;
    /** Used when the step ran but the value is empty (missing, null, "" or []). */
    whenEmpty?: FinalAnswerFallback;
    /** Exact values replaced before the empty check. */
    valueMap?: IFinalAnswerValueMapping[];
    /**
     * Rules checked first, in order: the field is set to `value` when a
     * step that ran has a matching field (e.g. archived = true when Extract
     * `$.type` is "non-sales"). With no rule matching, the field is taken
     * from its step as usual.
     */
    setWhen?: IFinalAnswerRule[];
}

/** "Set to `value` when `when` holds", for one final-answer field. */
export interface IFinalAnswerRule {
    when: IWorkflowStepCondition;
    value: WorkflowConditionValue;
}

/**
 * A pipeline's final answer per item: one JSON object assembled from step
 * answers and checked against a prompt version's output schema, so it can
 * be compared with what one big prompt returns.
 */
export interface IPipelineFinalAnswer {
    fields: IPipelineFinalAnswerField[];
    /** Prompt version whose output schema the answer is checked against. */
    schemaPromptVersionId?: string;
}

/** A step's state when the final answer is assembled. */
export interface IFinalAnswerStepResult {
    status: "succeeded" | "skipped" | "failed" | "pending";
    answer?: unknown;
    /** The step's name on the canvas, which templates may use. */
    label?: string;
}

function valueAtStepPath(answer: unknown, path: string): unknown {
    const trimmed = path.trim();
    return trimmed === "$" || trimmed === ""
        ? answer
        : valueAtBenchmarkPath(answer, trimmed);
}

function setAtPath(
    target: Record<string, unknown>,
    path: string,
    value: unknown,
): void {
    const segments = benchmarkPathSegments(path.trim());
    if (!segments) return;
    let node = target;
    for (const segment of segments.slice(0, -1)) {
        const next = node[segment];
        if (typeof next !== "object" || next === null || Array.isArray(next))
            node[segment] = {};
        node = node[segment] as Record<string, unknown>;
    }
    node[segments[segments.length - 1]!] = value;
}

/** The placeholders of a template, in order. */
export function templatePlaceholders(
    template: string,
): Array<{ text: string; step?: string; path?: string }> {
    return templatePlaceholderList(template).map((placeholder) => ({
        text: placeholder.text,
        ...(placeholder.step ? { step: placeholder.step } : {}),
        ...(placeholder.path ? { path: placeholder.path } : {}),
    }));
}

/**
 * A fallback's value for one item. A template that is exactly one
 * placeholder keeps that value's type; filters (`| default:"…"`,
 * `| pick:a,b`) apply.
 */
export function resolveFallback(
    fallback: FinalAnswerFallback,
    steps: ReadonlyMap<string, IFinalAnswerStepResult>,
): unknown {
    if ("value" in fallback) return fallback.value;
    const template = fallback.template;
    const placeholders = templatePlaceholderList(template);
    if (placeholders.length === 1 && placeholders[0]!.text === template.trim())
        return placeholderValue(placeholders[0]!, { steps });
    return renderTemplate(template, { steps });
}

/** Missing, null, blank text or an empty list. */
export function isEmptyFinalValue(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0)
    );
}

function mappedValue(
    value: unknown,
    valueMap: readonly IFinalAnswerValueMapping[] | undefined,
): unknown {
    const mapping = valueMap?.find((candidate) => candidate.from === value);
    return mapping ? mapping.to : value;
}

/** The value of the first rule whose condition holds on a step that ran. */
function ruleValue(
    rules: readonly IFinalAnswerRule[] | undefined,
    steps: ReadonlyMap<string, IFinalAnswerStepResult>,
): { value: WorkflowConditionValue } | undefined {
    for (const rule of rules ?? []) {
        const step = steps.get(rule.when.stepKey);
        if (step?.status !== "succeeded") continue;
        if (stepConditionHolds(rule.when, step.answer))
            return { value: rule.value };
    }
    return undefined;
}

/** One field's value for an item, or undefined to leave it out. */
function finalFieldValue(
    field: IPipelineFinalAnswerField,
    steps: ReadonlyMap<string, IFinalAnswerStepResult>,
): unknown {
    const ruled = ruleValue(field.setWhen, steps);
    if (ruled) return ruled.value;
    const step = steps.get(field.stepKey);
    if (step?.status === "skipped")
        return field.fallback
            ? resolveFallback(field.fallback, steps)
            : undefined;
    if (step?.status !== "succeeded") return undefined;
    const value = mappedValue(
        valueAtStepPath(step.answer, field.stepPath),
        field.valueMap,
    );
    if (!isEmptyFinalValue(value)) return value;
    const replacement = field.whenEmpty ?? field.fallback;
    return replacement ? resolveFallback(replacement, steps) : value;
}

/**
 * The final answer for one item. A field whose step was skipped takes its
 * fallback; an empty value takes the field's empty default (else its
 * fallback). Fields of failed steps, and fields with nothing to fill them,
 * are left out.
 */
export function assembleFinalAnswer(
    finalAnswer: Pick<IPipelineFinalAnswer, "fields">,
    steps: ReadonlyMap<string, IFinalAnswerStepResult>,
): Record<string, unknown> {
    const answer: Record<string, unknown> = {};
    for (const field of finalAnswer.fields) {
        const value = finalFieldValue(field, steps);
        if (value !== undefined) setAtPath(answer, field.path, value);
    }
    return answer;
}

const SCALAR_TYPES = ["string", "number", "boolean"];

function isScalar(value: unknown): value is WorkflowConditionValue {
    return value === null || SCALAR_TYPES.includes(typeof value);
}

function fallbackErrors(
    fallback: unknown,
    what: string,
    stepNames: ReadonlyMap<string, { label?: string }>,
): string[] {
    if (typeof fallback !== "object" || fallback === null)
        return [`${what} must be a value or a template.`];
    if ("value" in fallback)
        return isScalar(fallback.value)
            ? []
            : [`${what} can only be text, a number, true, false or null.`];
    if (!("template" in fallback) || typeof fallback.template !== "string")
        return [`${what} must be a value or a template.`];
    return templatePlaceholderList(fallback.template).flatMap((placeholder) => {
        if (placeholder.source === "input")
            return [
                `${what} has ${placeholder.text}; final-answer templates read steps, such as {{Extract.$.title}}.`,
            ];
        if (!placeholder.step || !placeholder.path)
            return [
                `${what} has ${placeholder.text}; write a step and a field, such as {{Extract.$.title}}.`,
            ];
        if (placeholder.problem) return [`${what}: ${placeholder.problem}`];
        if (!templateStepNamed(stepNames, placeholder.step))
            return [
                `${what} names "${placeholder.step}", which is not a step.`,
            ];
        return [];
    });
}

function ruleErrors(
    rules: unknown,
    name: string,
    stepKeys: ReadonlySet<string>,
): string[] {
    if (!Array.isArray(rules))
        return [`Final answer field "${name}" needs its rules as a list.`];
    return rules.flatMap((rule: unknown) => {
        if (typeof rule !== "object" || rule === null || !("when" in rule))
            return [
                `Final answer field "${name}" has a rule without a condition.`,
            ];
        const { when, value } = rule as { when: unknown; value: unknown };
        if (!isScalar(value))
            return [
                `A rule of "${name}" can only set text, a number, true, false or null.`,
            ];
        if (typeof when !== "object" || when === null)
            return [`A rule of "${name}" has an unknown condition.`];
        return stepConditionErrors(
            when as IWorkflowStepCondition,
            name,
            stepKeys,
        ).map((error) =>
            error
                .replace(`Step "${name}"`, `A rule of "${name}"`)
                .replace(
                    "can only check a step that runs before it.",
                    "must check a step of the pipeline.",
                ),
        );
    });
}

/**
 * A final-answer field's path as one key, so "mom" and "$.mom" are the
 * same field; undefined when it names no field ("$" alone, or blank).
 */
function finalFieldKey(path: string): string | undefined {
    const segments = benchmarkPathSegments(path.trim());
    return segments && !segments.includes("$") ? segments.join(".") : undefined;
}

/** A final-answer field object whose path and step path are text. */
function hasTextPaths(field: unknown): field is IPipelineFinalAnswerField {
    if (typeof field !== "object" || field === null) return false;
    const { path, stepPath } = field as Record<string, unknown>;
    return typeof path === "string" && typeof stepPath === "string";
}

/**
 * Problems with a final-answer mapping; empty when it is valid. `stepLabels`
 * (key → label) lets templates name steps by their label.
 */
export function finalAnswerErrors(
    finalAnswer: IPipelineFinalAnswer,
    stepKeys: ReadonlySet<string>,
    stepLabels: ReadonlyMap<string, string> = new Map(),
): string[] {
    const errors: string[] = [];
    const paths = new Set<string>();
    const stepNames = new Map(
        [...stepKeys].map((key) => [key, { label: stepLabels.get(key) }]),
    );
    for (const field of finalAnswer.fields) {
        if (!hasTextPaths(field)) {
            errors.push(
                "Each final answer field needs a path and the step's field as text, such as $.product.",
            );
            continue;
        }
        const name = field.path.trim() || "(empty)";
        const key = finalFieldKey(field.path);
        if (!key)
            errors.push(
                `Final answer field "${name}" needs a path such as $.product.`,
            );
        else if (paths.has(key))
            errors.push(`Final answer field "${name}" is set twice.`);
        if (key) paths.add(key);
        if (!stepKeys.has(field.stepKey))
            errors.push(`Final answer field "${name}" needs a step.`);
        const stepPath = field.stepPath.trim();
        if (stepPath !== "$" && !benchmarkPathSegments(stepPath))
            errors.push(
                `Final answer field "${name}" needs the step's field, such as $.product, or $ for its whole answer.`,
            );
        if (field.fallback !== undefined)
            errors.push(
                ...fallbackErrors(
                    field.fallback,
                    `The fallback of "${name}"`,
                    stepNames,
                ),
            );
        if (field.whenEmpty !== undefined)
            errors.push(
                ...fallbackErrors(
                    field.whenEmpty,
                    `The empty default of "${name}"`,
                    stepNames,
                ),
            );
        if (field.setWhen !== undefined)
            errors.push(...ruleErrors(field.setWhen, name, stepKeys));
        if (field.valueMap !== undefined)
            if (
                !Array.isArray(field.valueMap) ||
                field.valueMap.some(
                    (mapping) =>
                        typeof mapping !== "object" ||
                        mapping === null ||
                        !isScalar(mapping.from) ||
                        !isScalar(mapping.to),
                )
            )
                errors.push(
                    `Final answer field "${name}" can only replace text, numbers, true, false or null.`,
                );
    }
    return errors;
}

/** One item's final answer in a pipeline run. */
export interface IWorkflowRunAnswer {
    datasetItemId: string;
    /** Assembled from the steps that ran; absent while steps are pending. */
    answer?: Record<string, unknown>;
    /**
     * "complete": every step it reads ran or was skipped by a condition;
     * "failed": a step it reads failed, so the answer may lack its fields.
     * A failed scoring step (judge, metric) does not fail the answer.
     */
    status: "complete" | "failed";
    /** Where the answer does not match the chosen output schema. */
    schemaErrors?: Array<{ path: string; message: string }>;
    /**
     * Sum of the item's step costs (skipped steps cost nothing; scoring
     * steps are left out).
     */
    costUsd?: number;
    /** Sum of the item's step latencies, scoring steps left out. */
    latencyMs?: number;
    /**
     * On a run compared with an eval run: mean agreement across the tasks
     * scored (as an eval cell's benchmark score), when any was.
     */
    benchmarkScore?: number;
    /** Per-task results against the eval run's yardsticks. */
    benchmarkDetails?: IBenchmarkCellDetails;
    /** What the judge calls that scored this answer cost. */
    judgeCostUsd?: number;
}
