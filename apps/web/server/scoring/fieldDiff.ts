import type {
    FieldRule,
    FieldResult,
    FieldDiffDetails,
    LabelJson,
    OutputJson,
} from "../db/jsonTypes";

export interface FieldDiffOutcome {
    score: number | undefined;
    details: FieldDiffDetails;
}

export function scoreFieldDiff(
    output: OutputJson,
    label: LabelJson,
    rules: FieldRule[],
): FieldDiffOutcome {
    const fields: FieldResult[] = rules.map((rule) => {
        const actual = valueAtPath(output, rule.field);
        const expected = valueAtPath(label, rule.field);
        return {
            field: rule.field,
            matcher: rule.matcher,
            expected,
            actual,
            score: scoreField(rule, actual, expected),
        };
    });

    const score =
        fields.length === 0
            ? undefined
            : fields.reduce((sum, f) => sum + f.score, 0) / fields.length;

    return { score, details: { fields } };
}

function valueAtPath(source: Record<string, unknown>, field: string): unknown {
    if (!field.startsWith("$.")) return source[field];
    return field
        .slice(2)
        .split(".")
        .reduce<unknown>((value, segment) => {
            if (!value || typeof value !== "object" || Array.isArray(value)) {
                return undefined;
            }
            return (value as Record<string, unknown>)[segment];
        }, source);
}

function scoreField(
    rule: FieldRule,
    actual: unknown,
    expected: unknown,
): number {
    switch (rule.matcher) {
        case "exact":
            return scalarEqual(actual, expected) ? 1 : 0;
        case "numeric_tolerance":
            return withinTolerance(
                actual,
                expected,
                rule.tolerance,
                rule.relative ?? false,
            )
                ? 1
                : 0;
        case "set_overlap":
            return setF1(toArray(actual), toArray(expected));
    }
}

function normalizeScalar(v: unknown): unknown {
    if (typeof v === "string") return v.trim().toLowerCase();
    if (Array.isArray(v)) return v.map(normalizeScalar);
    if (v && typeof v === "object") {
        return Object.fromEntries(
            Object.entries(v)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, value]) => [key, normalizeScalar(value)]),
        );
    }
    return v;
}

function scalarEqual(a: unknown, b: unknown): boolean {
    if (typeof a === "number" && typeof b === "number") return a === b;
    const na = normalizeScalar(a);
    const nb = normalizeScalar(b);
    if (typeof na === "string" || typeof nb === "string") return na === nb;
    return JSON.stringify(na) === JSON.stringify(nb);
}

function withinTolerance(
    actual: unknown,
    expected: unknown,
    tolerance: number,
    relative: boolean,
): boolean {
    const a = parseNumber(actual);
    const e = parseNumber(expected);
    if (Number.isNaN(a) || Number.isNaN(e)) return false;
    const diff = Math.abs(a - e);
    if (relative) {
        if (e === 0) return a === 0;
        return diff / Math.abs(e) <= tolerance;
    }
    return diff <= tolerance;
}

// "₹", "Rs.", "INR" or "$" before or after the number, any case.
const CURRENCY = /^(?:₹|rs\.?|inr|\$)\s*|\s*(?:₹|rs\.?|inr|\$)$/giu;
// Western (120,000) or Indian (1,20,000) digit grouping, nothing else:
// "12,5" stays unparsed rather than becoming 125.
const GROUPED =
    /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$|^\d{1,2}(?:,\d{2})*,\d{3}(?:\.\d+)?$/u;

/** Spaces used between digit groups: "1 000", "1\u00a0000", "1\u202f000". */
const GROUP_SPACE = /[ \u00a0\u202f]/gu;
/** Plain decimal digits only: no hex, binary, octal, exponent or Infinity. */
const PLAIN_NUMBER = /^(?:\d+(?:\.\d*)?|\.\d+)$/u;

/**
 * A number from a model answer: "1,20,000", "1 000", "₹50000",
 * "Rs. 1,500.50" and "-$20" parse. Commas or spaces count only between
 * valid digit groups ("12 5" and "12,5" stay unparsed rather than becoming
 * 125), and only plain decimals are numbers ("0x10", "1e3" and "Infinity"
 * are not). Words like "lakh" or "crore" are not understood.
 */
function parseNumber(value: unknown): number {
    if (typeof value !== "string") return Number(value);
    let text = value.trim();
    const sign = /^[+-]/u.test(text) ? text[0]! : "";
    text = text.slice(sign.length).trim().replace(CURRENCY, "");
    const signAfterCurrency =
        sign === "" && /^[+-]/u.test(text) ? text[0]! : "";
    text = text.slice(signAfterCurrency.length).trim();
    const spaced = text.replace(GROUP_SPACE, ",");
    if (spaced !== text && !text.includes(",")) text = spaced;
    if (GROUPED.test(text)) text = text.replace(/,/gu, "");
    if (!PLAIN_NUMBER.test(text)) return Number.NaN;
    return Number(`${sign}${signAfterCurrency}${text}`);
}

function toArray(v: unknown): unknown[] {
    if (Array.isArray(v)) return v;
    if (v === null || v === undefined) return [];
    return [v];
}

function setF1(actual: unknown[], expected: unknown[]): number {
    const a = new Set(actual.map((x) => JSON.stringify(normalizeScalar(x))));
    const e = new Set(expected.map((x) => JSON.stringify(normalizeScalar(x))));
    if (a.size === 0 && e.size === 0) return 1;
    let inter = 0;
    for (const x of a) if (e.has(x)) inter++;
    const precision = a.size === 0 ? 0 : inter / a.size;
    const recall = e.size === 0 ? 0 : inter / e.size;
    if (precision + recall === 0) return 0;
    return (2 * precision * recall) / (precision + recall);
}
