import type { FieldMatcher, IPipelineFieldConfig } from "@/server/db/jsonTypes";

export type MatcherValue = FieldMatcher | "none";

const MATCHER_VALUES: ReadonlySet<string> = new Set<MatcherValue>([
    "none",
    "exact",
    "numeric_tolerance",
    "set_overlap",
]);

export function isMatcherValue(value: string): value is MatcherValue {
    return MATCHER_VALUES.has(value);
}

export function updateFieldMatcher(
    configs: IPipelineFieldConfig[],
    index: number,
    matcher: MatcherValue,
): IPipelineFieldConfig[] {
    const config = configs[index];
    if (!config || config.kind !== "factual") return configs;

    const next = [...configs];
    if (matcher === "none") {
        next[index] = { field: config.field, kind: "factual" };
    } else if (matcher === "numeric_tolerance") {
        next[index] = {
            field: config.field,
            kind: "factual",
            spec: {
                matcher: "numeric_tolerance",
                tolerance: 0.1,
                relative: true,
            },
        };
    } else if (matcher === "set_overlap") {
        next[index] = {
            field: config.field,
            kind: "factual",
            spec: { matcher: "set_overlap" },
        };
    } else {
        next[index] = {
            field: config.field,
            kind: "factual",
            spec: { matcher: "exact" },
        };
    }
    return next;
}

export function updateNumericTolerance(
    configs: IPipelineFieldConfig[],
    index: number,
    tolerance: number,
): IPipelineFieldConfig[] {
    const config = configs[index];
    if (
        !config ||
        config.kind !== "factual" ||
        config.spec?.matcher !== "numeric_tolerance"
    ) {
        return configs;
    }
    const next = [...configs];
    next[index] = {
        ...config,
        spec: { ...config.spec, tolerance },
    };
    return next;
}

export function updateGenerativeField(
    configs: IPipelineFieldConfig[],
    index: number,
    patch: Partial<
        Pick<
            Extract<IPipelineFieldConfig, { kind: "generative" }>,
            "rubric" | "modelId"
        >
    >,
): IPipelineFieldConfig[] {
    const config = configs[index];
    if (!config || config.kind !== "generative") return configs;
    const next = [...configs];
    next[index] = { ...config, ...patch };
    return next;
}
