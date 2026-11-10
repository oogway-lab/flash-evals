import { useState } from "react";
import {
    DEFAULT_BENCHMARK_POLICY,
    benchmarkUsesSource,
    taskMapNeedsJudge,
    taskPaths,
    validateTaskMap,
    type FieldMatcherSpec,
    type IBenchmarkAgreementField,
    type IBenchmarkPolicy,
    type IBenchmarkTask,
    type BenchmarkSource,
    type IBenchmarkTextMatching,
    type IJsonSchemaObject,
    type IRunBenchmarkConfig,
    type IRunConfigSnapshot,
    type IRunSetupModelOption,
    type IRunSetupVersionOption,
    type ITaskMap,
    type ProviderTransport,
} from "@flash-evals/api-contract";
import { emptyRule, trimRule } from "./rule-checks";
import { emptyCriterion, trimCriterion } from "./rubric-criteria";

/**
 * New run's benchmark settings, as the form holds them. Policy limits are
 * percentages typed by the user; an empty max cost means no cost limit.
 */
/** Default allowed drop below the reference, in points. */
export const DEFAULT_MAX_DROP_POINTS = 2;

export interface IBenchmarkFormState {
    enabled: boolean;
    /**
     * Default benchmark answers: the reference model's, or the dataset's
     * stored ones. A task's own `source` overrides it.
     */
    source: BenchmarkSource;
    taskMap: ITaskMap;
    judgeModelId: string;
    /** Provider for the judge; the judge model's default when unset or keyless. */
    judgeTransport?: ProviderTransport;
    minAgreementPct: string;
    /**
     * Most a stored-answer task may fall below the reference model, in
     * points; empty uses the fixed minimum agreement instead.
     */
    maxDropPts: string;
    minWinOrTiePct: string;
    maxCostPct: string;
    /** Per-task targets from a rerun's settings; kept, not edited here. */
    taskTargets?: IBenchmarkPolicy["tasks"];
}

/**
 * Off with the default policy, or, when rerunning a benchmark run, on with
 * that run's Task Map, judge and targets.
 */
export function initialBenchmarkState(
    judgeModelId: string,
    previous?: IRunBenchmarkConfig,
): IBenchmarkFormState {
    const policy = previous?.policy;
    return {
        enabled: previous !== undefined,
        source: previous?.source ?? "model",
        taskMap: previous?.taskMap ?? { tasks: [] },
        judgeModelId: previous?.judge?.modelId ?? judgeModelId,
        ...previousJudgeTransport(previous),
        minAgreementPct: toPct(
            policy?.minAgreement ?? DEFAULT_BENCHMARK_POLICY.minAgreement,
        ),
        maxDropPts: initialMaxDrop(previous),
        minWinOrTiePct: toPct(
            policy?.minWinOrTieRate ?? DEFAULT_BENCHMARK_POLICY.minWinOrTieRate,
        ),
        maxCostPct:
            policy?.maxRelativeCost !== undefined
                ? toPct(policy.maxRelativeCost)
                : "",
        ...(policy?.tasks ? { taskTargets: policy.tasks } : {}),
    };
}

/**
 * Points a candidate may fall below the reference on stored-answer tasks:
 * a rerun keeps its own setting, a new comparison starts at 2.
 */
function initialMaxDrop(previous: IRunBenchmarkConfig | undefined): string {
    if (!previous) return String(DEFAULT_MAX_DROP_POINTS);
    const drop = previous.policy?.maxDropBelowReference;
    return drop === undefined ? "" : toPct(drop);
}

/** A rerun keeps its judge's provider; the form drops it if it has no key. */
function previousJudgeTransport(
    previous: IRunBenchmarkConfig | undefined,
): Pick<IBenchmarkFormState, "judgeTransport"> {
    const transport = previous?.judge?.transport;
    return transport ? { judgeTransport: transport } : {};
}

function toPct(rate: number): string {
    return String(Math.round(rate * 1000) / 10);
}

type MatcherKind = FieldMatcherSpec["matcher"];

export const MATCHER_LABELS: Record<MatcherKind, string> = {
    exact: "Exact match",
    numeric_tolerance: "Numeric tolerance",
    set_overlap: "Set overlap",
};

export function isMatcherKind(value: string): value is MatcherKind {
    return value in MATCHER_LABELS;
}

export function fieldWithMatcher(
    path: string,
    matcher: MatcherKind,
): IBenchmarkAgreementField {
    return matcher === "numeric_tolerance"
        ? { path, matcher, tolerance: 0.05, relative: true }
        : { path, matcher };
}

/** The output paths a task owns, whatever its method. */
export function pathsOf(task: IBenchmarkTask): string[] {
    return taskPaths(task);
}

/** Switch a task's method, keeping its key, name, description, source and paths. */
export function withMethod(
    task: IBenchmarkTask,
    method: IBenchmarkTask["method"],
): IBenchmarkTask {
    if (task.method === method) return task;
    const base = {
        key: task.key,
        name: task.name,
        ...(task.description ? { description: task.description } : {}),
        ...(task.source ? { source: task.source } : {}),
    };
    const paths = pathsOf(task);
    if (method === "rules")
        return { ...base, method, rules: [emptyRule(paths)] };
    if (method === "rubric") {
        const { source: _unused, ...rest } = base;
        return { ...rest, method, paths, criteria: [emptyCriterion()] };
    }
    return method === "agreement"
        ? {
              ...base,
              method,
              fields: paths.map((path) => fieldWithMatcher(path, "exact")),
          }
        : { ...base, method, paths };
}

/** Point the task's `index`-th output field at `path`, keeping its matcher. */
export function setPathAt(
    task: IBenchmarkTask,
    index: number,
    path: string,
): IBenchmarkTask {
    if (task.method === "rules") return task;
    if (task.method === "head_to_head" || task.method === "rubric")
        return { ...task, paths: replaceAt(task.paths, index, path) };
    const field = task.fields[index];
    if (!field) return task;
    return {
        ...task,
        fields: replaceAt(task.fields, index, { ...field, path }),
    };
}

/** Add an empty output field (an exact match for agreement tasks). */
export function addPath(task: IBenchmarkTask): IBenchmarkTask {
    if (task.method === "rules") return task;
    return task.method === "head_to_head" || task.method === "rubric"
        ? { ...task, paths: [...task.paths, ""] }
        : { ...task, fields: [...task.fields, fieldWithMatcher("", "exact")] };
}

export function removePathAt(
    task: IBenchmarkTask,
    index: number,
): IBenchmarkTask {
    if (task.method === "rules") return task;
    return task.method === "head_to_head" || task.method === "rubric"
        ? { ...task, paths: task.paths.filter((_, i) => i !== index) }
        : { ...task, fields: task.fields.filter((_, i) => i !== index) };
}

/** Change how an agreement task's `index`-th field is compared. */
export function setFieldMatcherAt(
    task: IBenchmarkTask,
    index: number,
    patch:
        | { matcher: MatcherKind }
        | { tolerance: number }
        | { relative: boolean },
): IBenchmarkTask {
    if (task.method !== "agreement") return task;
    const field = task.fields[index];
    if (!field) return task;
    let next: IBenchmarkAgreementField;
    if ("matcher" in patch) next = fieldWithMatcher(field.path, patch.matcher);
    else if (field.matcher !== "numeric_tolerance") return task;
    else next = { ...field, ...patch };
    return { ...task, fields: replaceAt(task.fields, index, next) };
}

function replaceAt<T>(items: T[], index: number, value: T): T[] {
    return items.map((item, i) => (i === index ? value : item));
}

/** Set a task's own yardstick; undefined follows the run's. */
export function withTaskSource(
    task: IBenchmarkTask,
    source: BenchmarkSource | undefined,
): IBenchmarkTask {
    const { source: _previous, ...rest } = task;
    return source ? { ...rest, source } : rest;
}

/** A new, empty agreement task with a key not used yet. */
export function newTask(existing: IBenchmarkTask[]): IBenchmarkTask {
    let n = existing.length + 1;
    while (existing.some((task) => task.key === `task_${n}`)) n++;
    return {
        key: `task_${n}`,
        name: `Task ${n}`,
        method: "agreement",
        fields: [],
    };
}

/** Every property path in the schema, nested objects included. */
export function schemaPaths(schema: IJsonSchemaObject | undefined): string[] {
    const paths: string[] = [];
    const walk = (node: unknown, prefix: string) => {
        if (!isRecord(node) || !isRecord(node.properties)) return;
        for (const [name, child] of Object.entries(node.properties)) {
            const path = `${prefix}.${name}`;
            paths.push(path);
            walk(child, path);
        }
    };
    walk(schema, "$");
    return paths;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePct(
    raw: string,
    label: string,
    errors: string[],
    { max }: { max?: number } = {},
): number | undefined {
    const text = raw.trim();
    if (!text) return undefined;
    const value = Number(text);
    if (
        !Number.isFinite(value) ||
        value < 0 ||
        (max !== undefined && value > max)
    ) {
        errors.push(
            max === undefined
                ? `${label} must be a number above 0.`
                : `${label} must be between 0 and ${max}.`,
        );
        return undefined;
    }
    return value / 100;
}

/** The policy the form describes, or the reasons it cannot be used. */
export function benchmarkPolicy(state: IBenchmarkFormState): {
    policy?: IBenchmarkPolicy;
    errors: string[];
} {
    const errors: string[] = [];
    const minAgreement = parsePct(
        state.minAgreementPct,
        "Minimum agreement",
        errors,
        { max: 100 },
    );
    const minWinOrTieRate = parsePct(
        state.minWinOrTiePct,
        "Minimum won or tied",
        errors,
        { max: 100 },
    );
    const maxDropBelowReference = parsePct(
        state.maxDropPts,
        "Allowed drop below the reference",
        errors,
        { max: 100 },
    );
    const maxRelativeCost = parsePct(state.maxCostPct, "Maximum cost", errors);
    if (maxRelativeCost === 0)
        errors.push("Maximum cost must be above 0, or left empty.");
    const policy: IBenchmarkPolicy = {
        ...(minAgreement !== undefined ? { minAgreement } : {}),
        ...(minWinOrTieRate !== undefined ? { minWinOrTieRate } : {}),
        ...(maxDropBelowReference !== undefined
            ? { maxDropBelowReference }
            : {}),
        ...(maxRelativeCost ? { maxRelativeCost } : {}),
    };
    return {
        ...(Object.keys(policy).length > 0 ? { policy } : {}),
        errors,
    };
}

/** Everything that stops the benchmark settings from being submitted. */
export function benchmarkErrors(input: {
    state: IBenchmarkFormState;
    schema: IJsonSchemaObject | undefined;
    modelCount: number;
    storedAnswersAvailable?: boolean;
}): string[] {
    const { state } = input;
    if (!state.enabled) return [];
    const errors: string[] = [];
    if (benchmarkUsesSource(state, "labels") && !input.storedAnswersAvailable)
        errors.push(
            "This dataset has no stored answers. Compare against the benchmark model's answers instead.",
        );
    if (benchmarkUsesSource(state, "model")) {
        if (input.modelCount < 2)
            errors.push(
                "Select at least two models: the benchmark and one to compare with it.",
            );
    } else if (input.modelCount < 1)
        errors.push(
            "Select at least one model to compare with the stored answers.",
        );
    errors.push(...validateTaskMap(state.taskMap, input.schema));
    if (taskMapNeedsJudge(state.taskMap) && !state.judgeModelId)
        errors.push("Choose a judge model for the judged tasks.");
    errors.push(...benchmarkPolicy(state).errors);
    return errors;
}

/**
 * The create request's `benchmark` field, or undefined when the section is
 * off. The judge is sent only when a task needs one.
 */
export function serializeBenchmark(
    state: IBenchmarkFormState,
    judgeTransport?: ProviderTransport,
): IRunBenchmarkConfig | undefined {
    if (!state.enabled) return undefined;
    const taskMap: ITaskMap = {
        tasks: state.taskMap.tasks.map(trimTask),
    };
    const { policy: limits } = benchmarkPolicy(state);
    // Per-task targets survive only for tasks that still exist.
    const taskTargets = Object.fromEntries(
        Object.entries(state.taskTargets ?? {}).filter(([key]) =>
            taskMap.tasks.some((task) => task.key === key),
        ),
    );
    const policy =
        Object.keys(taskTargets).length > 0
            ? { ...limits, tasks: taskTargets }
            : limits;
    return {
        ...(state.source === "labels" ? { source: "labels" as const } : {}),
        taskMap,
        ...(taskMapNeedsJudge(taskMap) && state.judgeModelId
            ? {
                  judge: {
                      modelId: state.judgeModelId,
                      ...(judgeTransport ? { transport: judgeTransport } : {}),
                  },
              }
            : {}),
        ...(policy ? { policy } : {}),
    };
}

function trimTask(task: IBenchmarkTask): IBenchmarkTask {
    const description = task.description?.trim();
    const base = {
        key: task.key.trim(),
        name: task.name.trim(),
        ...(description ? { description } : {}),
        ...(task.source ? { source: task.source } : {}),
    };
    if (task.method === "rules") {
        const { source: _unused, ...rest } = base;
        return { ...rest, method: "rules", rules: task.rules.map(trimRule) };
    }
    if (task.method === "agreement") {
        return {
            ...base,
            method: "agreement",
            fields: task.fields.map((field) => ({
                ...field,
                path: field.path.trim(),
            })),
            ...(task.judgeDisagreements ? { judgeDisagreements: true } : {}),
            ...trimTextMatching(task.textMatching),
        };
    }
    if (task.method === "rubric") {
        const { source: _unused, ...rest } = base;
        const instructions = task.instructions?.trim();
        return {
            ...rest,
            method: "rubric",
            paths: task.paths.map((path) => path.trim()),
            criteria: task.criteria.map(trimCriterion),
            ...(instructions ? { instructions } : {}),
        };
    }
    const rubric = task.rubric?.trim();
    return {
        ...base,
        method: "head_to_head",
        paths: task.paths.map((path) => path.trim()),
        ...(rubric ? { rubric } : {}),
    };
}

function trimTextMatching(matching: IBenchmarkTextMatching | undefined): {
    textMatching?: IBenchmarkTextMatching;
} {
    const aliases = Object.fromEntries(
        Object.entries(matching?.aliases ?? {})
            .map(([name, spellings]) => [
                name.trim(),
                spellings.map((spelling) => spelling.trim()).filter(Boolean),
            ])
            .filter(([name, spellings]) => name && spellings.length > 0),
    ) as Record<string, string[]>;
    const result: IBenchmarkTextMatching = {
        ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
        ...(matching?.fuzzy !== undefined ? { fuzzy: matching.fuzzy } : {}),
    };
    return Object.keys(result).length > 0 ? { textMatching: result } : {};
}

/** One line per name: "Parle-G: parleji, parle glucose". */
export function aliasesToText(matching: IBenchmarkTextMatching | undefined) {
    return Object.entries(matching?.aliases ?? {})
        .map(([name, spellings]) => `${name}: ${spellings.join(", ")}`)
        .join("\n");
}

/** Parses aliasesToText's format; lines without a colon are ignored. */
export function aliasesFromText(text: string): Record<string, string[]> {
    const aliases: Record<string, string[]> = {};
    for (const line of text.split("\n")) {
        const colon = line.indexOf(":");
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim();
        const spellings = line
            .slice(colon + 1)
            .split(",")
            .map((spelling) => spelling.trim())
            .filter(Boolean);
        if (name && spellings.length > 0)
            aliases[name] = [...(aliases[name] ?? []), ...spellings];
    }
    return aliases;
}

/** Set an agreement task's aliases or fuzzy threshold; empty values clear them. */
export function withTextMatching(
    task: IBenchmarkTask,
    patch: { aliases?: Record<string, string[]>; fuzzy?: number | null },
): IBenchmarkTask {
    if (task.method !== "agreement") return task;
    const current = task.textMatching ?? {};
    const aliases = patch.aliases ?? current.aliases;
    const fuzzy =
        patch.fuzzy === null ? undefined : (patch.fuzzy ?? current.fuzzy);
    const next: IBenchmarkTextMatching = {
        ...(aliases && Object.keys(aliases).length > 0 ? { aliases } : {}),
        ...(fuzzy !== undefined ? { fuzzy } : {}),
    };
    const { textMatching: _previous, ...rest } = task;
    return Object.keys(next).length > 0
        ? { ...rest, textMatching: next }
        : rest;
}

/**
 * New run's benchmark state and what follows from it: the selected prompt's
 * output schema, the problems that block submit, and the request field.
 * Nothing is checked or sent while the section is hidden.
 */
export function useBenchmarkForm(input: {
    show: boolean;
    storedAnswersAvailable?: boolean;
    versionOptions: IRunSetupVersionOption[];
    promptVersionId: string;
    modelCount: number;
    availableModels: IRunSetupModelOption[];
    defaultJudgeModelId: string;
    /** The settings of the run being rerun; its benchmark, if any, is restored. */
    rerunConfig?: IRunConfigSnapshot;
}) {
    const [state, setState] = useState(() =>
        initialBenchmarkState(
            input.defaultJudgeModelId,
            input.rerunConfig?.benchmark,
        ),
    );
    const outputSchema = input.versionOptions.find(
        (version) => version.id === input.promptVersionId,
    )?.outputSchema;
    if (!input.show) return { state, setState, outputSchema, problems: [] };
    const judgeTransport = benchmarkJudgeTransport(
        input.availableModels,
        state,
    );
    return {
        state,
        setState,
        outputSchema,
        problems: benchmarkErrors({
            state,
            schema: outputSchema,
            modelCount: input.modelCount,
            storedAnswersAvailable: input.storedAnswersAvailable,
        }),
        request: serializeBenchmark(state, judgeTransport),
    };
}

/**
 * The judge's provider: the one chosen in the form while it still has a key,
 * otherwise the judge model's default (the preferred provider first).
 */
export function benchmarkJudgeTransport(
    availableModels: IRunSetupModelOption[],
    state: Pick<IBenchmarkFormState, "judgeModelId" | "judgeTransport">,
): ProviderTransport | undefined {
    const transports =
        availableModels.find((model) => model.id === state.judgeModelId)
            ?.transports ?? [];
    return state.judgeTransport && transports.includes(state.judgeTransport)
        ? state.judgeTransport
        : transports[0];
}
