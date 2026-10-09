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

function scoreField(rule: FieldRule, actual: unknown, expected: unknown): number {
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
    return typeof v === "string" ? v.trim().toLowerCase() : v;
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
    const a = Number(actual);
    const e = Number(expected);
    if (Number.isNaN(a) || Number.isNaN(e)) return false;
    const diff = Math.abs(a - e);
    if (relative) {
        if (e === 0) return a === 0;
        return diff / Math.abs(e) <= tolerance;
    }
    return diff <= tolerance;
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
