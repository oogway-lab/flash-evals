import { benchmarkPathSegments, valueAtBenchmarkPath } from "./benchmark.js";

/**
 * Templates with `{{…}}` placeholders, shared by step input templates and
 * final-answer fallbacks. A placeholder is a source and optional filters:
 *
 * - `{{input}}`: the dataset item's whole input.
 * - `{{input.<name>}}`: the content of the item's `<name>…</name>` section;
 *   `{{input.<name>.<field>}}` reads a field of the JSON inside that section
 *   (`input.user_persona.name`); when the item is a JSON object, its field
 *   (`input.customer.name`).
 * - `{{Step.$.path}}` / `{{Step.$}}`: a field of a step's answer (the step
 *   named by its canvas label or key).
 * - `| pick:a,b`: keep only those fields of an object.
 * - `| default:"text"`: used when the value is missing or empty.
 */

export const TEMPLATE_PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;

export interface ITemplateFilter {
    name: string;
    arg?: string;
}

export interface ITemplatePlaceholder {
    /** The placeholder as written, braces included. */
    text: string;
    /** `input` for the dataset item; otherwise a step reference. */
    source?: "input" | "step";
    /** `input.<name>`: the section, field in a section, or JSON field read. */
    inputName?: string;
    step?: string;
    path?: string;
    filters: ITemplateFilter[];
    /** Why the placeholder can't be read, when it can't. */
    problem?: string;
}

/** Splits `a | b:"x|y" | c` on bars outside quotes. */
function splitOnBars(inner: string): string[] {
    const parts: string[] = [];
    let current = "";
    let quoted = false;
    for (const char of inner) {
        if (char === '"') quoted = !quoted;
        if (char === "|" && !quoted) {
            parts.push(current.trim());
            current = "";
        } else current += char;
    }
    parts.push(current.trim());
    return parts;
}

function parseFilter(text: string): ITemplateFilter {
    const colon = text.indexOf(":");
    if (colon === -1) return { name: text.trim() };
    const name = text.slice(0, colon).trim();
    let arg = text.slice(colon + 1).trim();
    const quoted = /^"(.*)"$/s.exec(arg);
    if (quoted) arg = quoted[1]!;
    return { name, arg };
}

const KNOWN_FILTERS = new Set(["pick", "default"]);

/** A step reference such as `Extract.$.title` split into step and path. */
export function stepReferenceParts(
    head: string,
): { step: string; path: string } | undefined {
    const at = head.indexOf(".$");
    const whole = head.endsWith(".$") ? head.length - 2 : -1;
    if (at <= 0 && whole <= 0) return undefined;
    const split = at > 0 ? at : whole;
    return {
        step: head.slice(0, split).trim(),
        path: head.slice(split + 1).trim(),
    };
}

/** One placeholder's parts (without its braces). */
export function parsePlaceholder(
    inner: string,
    text = `{{${inner}}}`,
): ITemplatePlaceholder {
    const [head = "", ...filterTexts] = splitOnBars(inner);
    const filters = filterTexts.map(parseFilter);
    const unknown = filters.find((filter) => !KNOWN_FILTERS.has(filter.name));
    const problem = unknown
        ? `${text} uses an unknown filter "${unknown.name}"; use pick or default.`
        : filters.some((filter) => filter.name === "pick" && !filter.arg)
          ? `${text} needs the fields to pick, such as | pick:title,product.`
          : filters.some(
                  (filter) =>
                      filter.name === "default" && filter.arg === undefined,
              )
            ? `${text} needs the text to use, such as | default:"Not discussed".`
            : undefined;
    const input = /^input(?:\.([A-Za-z0-9_.-]+))?$/.exec(head);
    if (input)
        return {
            text,
            source: "input",
            ...(input[1] ? { inputName: input[1] } : {}),
            filters,
            ...(problem ? { problem } : {}),
        };
    const reference = stepReferenceParts(head);
    if (!reference)
        return {
            text,
            filters,
            problem:
                problem ??
                `${text} isn't a placeholder; write {{input}}, {{input.<name>}}, {{input.<name>.<field>}} or a step and a field, such as {{Extract.$.title}}.`,
        };
    const badPath =
        reference.path !== "$" && !benchmarkPathSegments(reference.path);
    return {
        text,
        source: "step",
        step: reference.step,
        path: reference.path,
        filters,
        ...(problem || badPath
            ? {
                  problem:
                      problem ??
                      `${text}'s field isn't a path such as $.title.`,
              }
            : {}),
    };
}

/** The placeholders of a template, in order. */
export function templatePlaceholderList(
    template: string,
): ITemplatePlaceholder[] {
    return [...template.matchAll(TEMPLATE_PLACEHOLDER)].map((match) =>
        parsePlaceholder(match[1] ?? "", match[0]),
    );
}

/**
 * Missing, null, blank text, an empty list or an object with no fields
 * (what `pick` leaves when none of its fields is there).
 */
function isEmptyValue(value: unknown): boolean {
    return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "object" &&
            !Array.isArray(value) &&
            Object.keys(value).length === 0)
    );
}

/** A value after its filters: `pick` keeps fields, `default` fills empties. */
export function applyTemplateFilters(
    value: unknown,
    filters: readonly ITemplateFilter[],
): unknown {
    let current = value;
    for (const filter of filters) {
        if (filter.name === "pick") {
            if (
                typeof current !== "object" ||
                current === null ||
                Array.isArray(current)
            ) {
                current = undefined;
                continue;
            }
            const source = current as Record<string, unknown>;
            const picked: Record<string, unknown> = {};
            for (const field of (filter.arg ?? "").split(",")) {
                const key = field.trim();
                if (key && source[key] !== undefined) picked[key] = source[key];
            }
            current = picked;
        } else if (filter.name === "default" && isEmptyValue(current))
            current = filter.arg ?? "";
    }
    return current;
}

/** A value written into text: text as is, anything else as JSON. */
export function templateText(value: unknown): string {
    if (value === undefined || value === null) return "";
    return typeof value === "string" ? value : JSON.stringify(value);
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The trimmed content of the item's `<name>…</name>` section, if any. */
function sectionContent(input: string, name: string): string | undefined {
    const tag = new RegExp(
        `<${escapeRegExp(name)}(?:\\s[^>]*)?>([\\s\\S]*?)</${escapeRegExp(name)}>`,
        "i",
    ).exec(input);
    return tag ? tag[1]!.trim() : undefined;
}

/** A field of a JSON object written as text; undefined when it isn't one. */
function jsonField(text: string, path: string): unknown {
    try {
        const parsed = JSON.parse(text) as unknown;
        if (typeof parsed === "object" && parsed !== null)
            return valueAtBenchmarkPath(parsed, `$.${path}`);
    } catch {
        // Not JSON: the part is missing.
    }
    return undefined;
}

/**
 * A part of a dataset item's input: the content of its `<name>…</name>`
 * section; else, for a dotted name such as `user_persona.name`, a field of
 * the JSON inside the longest leading section (`<user_persona>`); else (for
 * an item that is a JSON object) its field `name`.
 */
export function inputPart(input: string, name: string | undefined): unknown {
    if (!name) return input;
    const exact = sectionContent(input, name);
    if (exact !== undefined) return exact;
    const parts = name.split(".");
    for (let cut = parts.length - 1; cut > 0; cut--) {
        const section = sectionContent(input, parts.slice(0, cut).join("."));
        if (section !== undefined)
            return jsonField(section, parts.slice(cut).join("."));
    }
    return jsonField(input, name);
}

/** A step a template can read, by key. */
export interface ITemplateStep {
    label?: string;
    status: "succeeded" | "skipped" | "failed" | "pending";
    answer?: unknown;
}

/** The step a template names: by key, then label, then label ignoring case. */
export function templateStepNamed<T extends { label?: string }>(
    steps: ReadonlyMap<string, T>,
    name: string,
): T | undefined {
    const byKey = steps.get(name);
    if (byKey) return byKey;
    const entries = [...steps.values()];
    return (
        entries.find((step) => step.label === name) ??
        entries.find((step) => step.label?.toLowerCase() === name.toLowerCase())
    );
}

/** The key of the step a template names, as `templateStepNamed` finds it. */
export function templateStepKey(
    steps: ReadonlyMap<string, { label?: string }>,
    name: string,
): string | undefined {
    if (steps.has(name)) return name;
    for (const [key, step] of steps) if (step.label === name) return key;
    for (const [key, step] of steps)
        if (step.label?.toLowerCase() === name.toLowerCase()) return key;
    return undefined;
}

/** One placeholder's value (before it is written as text). */
export function placeholderValue(
    placeholder: ITemplatePlaceholder,
    context: { input?: string; steps: ReadonlyMap<string, ITemplateStep> },
): unknown {
    let value: unknown;
    if (placeholder.source === "input")
        value =
            context.input === undefined
                ? undefined
                : inputPart(context.input, placeholder.inputName);
    else if (placeholder.source === "step" && placeholder.step) {
        const step = templateStepNamed(context.steps, placeholder.step);
        if (step?.status === "succeeded") {
            const path = placeholder.path?.trim() ?? "$";
            value =
                path === "$" || path === ""
                    ? step.answer
                    : valueAtBenchmarkPath(step.answer, path);
        }
    }
    return applyTemplateFilters(value, placeholder.filters);
}

/** A template written out with every placeholder's value. */
export function renderTemplate(
    template: string,
    context: { input?: string; steps: ReadonlyMap<string, ITemplateStep> },
): string {
    return template.replace(TEMPLATE_PLACEHOLDER, (text, inner: string) =>
        templateText(placeholderValue(parsePlaceholder(inner, text), context)),
    );
}

/**
 * Problems with a step's input template, in plain words; empty when valid.
 * `stepLabels` maps every step's key to its label; `upstreamKeys` are the
 * steps that run before this one.
 */
export function inputTemplateErrors(
    template: string,
    label: string,
    stepLabels: ReadonlyMap<string, string>,
    upstreamKeys: ReadonlySet<string>,
): string[] {
    if (typeof template !== "string")
        return [`Step "${label}" needs its input template as text.`];
    if (!template.trim())
        return [`Step "${label}" has an empty input template.`];
    const steps = new Map(
        [...stepLabels].map(([key, stepLabel]) => [key, { label: stepLabel }]),
    );
    return templatePlaceholderList(template).flatMap((placeholder) => {
        if (placeholder.problem)
            return [`The input template of "${label}": ${placeholder.problem}`];
        if (placeholder.source !== "step" || !placeholder.step) return [];
        const key = templateStepKey(steps, placeholder.step);
        if (!key)
            return [
                `The input template of "${label}" names "${placeholder.step}", which is not a step.`,
            ];
        if (!upstreamKeys.has(key))
            return [
                `The input template of "${label}" reads "${stepLabels.get(key) ?? key}", which doesn't run before it. Connect it upstream of "${label}" (an order-only connection is enough).`,
            ];
        return [];
    });
}
