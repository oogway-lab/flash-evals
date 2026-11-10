import {
    completionCostFields,
    type ApiKeys,
    type ICostPricing,
    type EvalProviderTransport,
    type ReasoningEffort,
    type ICompletionDataPolicy,
} from "@flash-evals/llm-core";
import {
    candidateGoesFirst,
    judgeOrderSeed,
} from "@flash-evals/llm-core/judge-order";
import { getLimitedEvalProvider } from "../llm/providerConcurrency";
import {
    benchmarkTaskSource,
    canonicalizePair,
    valueAtBenchmarkPath,
    type BenchmarkSource,
    type BenchmarkVerdict,
    type IBenchmarkAgreementTask,
    type IBenchmarkCellDetails,
    type IBenchmarkTask,
    type IBenchmarkTaskResult,
    type ITaskMap,
} from "@flash-evals/api-contract";
import type { FieldRule, OutputJson } from "../db/jsonTypes";
import { errorMessage } from "../lib/errors";
import { scoreFieldDiff } from "./fieldDiff";
import { judgeRubric, scoreRubricTask, type RubricJudgeFn } from "./rubric";
import { scoreRulesTask } from "./rules";

/**
 * Thinking judges spend part of the budget before answering: Gemini 3 Flash
 * at medium effort ran out at the run's 4,096 on 127 of ~2,500 calls in the
 * 8 Nov 2026 production-sized run. Output is billed on tokens used, so a high cap costs
 * nothing extra (same reasoning as RUBRIC_MIN_OUTPUT_TOKENS).
 */
const HEAD_TO_HEAD_MIN_OUTPUT_TOKENS = 16000;

export const HEAD_TO_HEAD_RESPONSE_SCHEMA = {
    name: "benchmark_head_to_head",
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["reasoning", "better"],
        properties: {
            reasoning: {
                type: "string",
                description: "Compare the two answers against the task first.",
            },
            better: {
                type: "string",
                enum: ["A", "B", "tie"],
                description: "Which answer does the task better, or tie.",
            },
        },
    },
};

export interface IBenchmarkJudgeConfig {
    modelId: string;
    transport?: EvalProviderTransport;
    reasoningEffort?: ReasoningEffort;
    /** The run's data rules, applied to the judge call too. */
    dataPolicy?: ICompletionDataPolicy;
}

export interface IHeadToHeadInput {
    judge: IBenchmarkJudgeConfig;
    apiKeys: ApiKeys;
    taskName: string;
    /** What "better" means; falls back to a generic instruction. */
    criteria?: string;
    inputText?: string;
    candidate: unknown;
    benchmark: unknown;
    /** Stable seed (cell id + task key) that decides which answer is shown first. */
    orderSeed: string;
    maxTokens?: number;
    /** The judge model's prices, so the call's cost can be recorded. */
    pricing?: ICostPricing;
}

export type HeadToHeadOutcome = (
    | { ok: true; verdict: BenchmarkVerdict; rationale: string }
    | { ok: false; error: string }
) & { costUsd?: number };

export type HeadToHeadFn = (
    input: IHeadToHeadInput,
) => Promise<HeadToHeadOutcome>;

/**
 * Blind pairwise comparison. The judge sees "Answer A" and "Answer B" and
 * never learns which is the benchmark; the order comes from a stable hash so
 * re-scoring is reproducible and, across many items, each side goes first
 * about half the time (offsetting position bias).
 */
export async function judgeHeadToHead(
    input: IHeadToHeadInput,
): Promise<HeadToHeadOutcome> {
    const candidateFirst = candidateGoesFirst(input.orderSeed);
    const [a, b] = candidateFirst
        ? [input.candidate, input.benchmark]
        : [input.benchmark, input.candidate];
    const sections = [
        `# Task\n${input.taskName}`,
        `# What counts as better\n${
            input.criteria?.trim() ||
            "Which answer more accurately and completely does this task for the input."
        }`,
        ...(input.inputText
            ? [`# Input\n<input>\n${input.inputText}\n</input>`]
            : []),
        `# Answer A\n<answer_a>\n${format(a)}\n</answer_a>`,
        `# Answer B\n<answer_b>\n${format(b)}\n</answer_b>`,
    ];
    try {
        const result = await getLimitedEvalProvider(
            input.apiKeys,
            input.judge.transport ? { transport: input.judge.transport } : {},
        ).complete({
            model: input.judge.modelId,
            system:
                "You compare two answers to the same task. Reason first, then say which is better or tie. " +
                "Judge only correctness and completeness for the task: do not reward length or style, " +
                "and treat answers that are equivalent in substance as a tie. Return JSON.",
            prompt: sections.join("\n\n"),
            responseSchema: HEAD_TO_HEAD_RESPONSE_SCHEMA,
            maxTokens: Math.max(
                input.maxTokens ?? 0,
                HEAD_TO_HEAD_MIN_OUTPUT_TOKENS,
            ),
            reasoningEffort: input.judge.reasoningEffort,
            ...(input.judge.dataPolicy
                ? { dataPolicy: input.judge.dataPolicy }
                : {}),
        });
        // A call that returns bad JSON was still paid for.
        const { costUsd } = completionCostFields(result, input.pricing);
        const cost = costUsd !== undefined ? { costUsd } : {};
        const parsed = result.parsed as
            { reasoning?: unknown; better?: unknown } | undefined;
        if (result.schemaViolation || !parsed)
            return {
                ok: false,
                error: "Judge returned unparseable or truncated output",
                ...cost,
            };
        if (
            parsed.better !== "A" &&
            parsed.better !== "B" &&
            parsed.better !== "tie"
        )
            return {
                ok: false,
                error: "Judge verdict was invalid or missing",
                ...cost,
            };
        const verdict: BenchmarkVerdict =
            parsed.better === "tie"
                ? "tie"
                : (parsed.better === "A") === candidateFirst
                  ? "win"
                  : "loss";
        return {
            ok: true,
            verdict,
            rationale:
                typeof parsed.reasoning === "string" ? parsed.reasoning : "",
            ...cost,
        };
    } catch (err) {
        return { ok: false, error: errorMessage(err) };
    }
}

export { candidateGoesFirst };

/**
 * Agreement of one task's fields with the benchmark output, 0 to 1. Text is
 * compared after normalization and the task's alias and fuzzy rules; the
 * details keep the original values.
 */
export function scoreAgreementTask(
    task: IBenchmarkAgreementTask,
    candidate: OutputJson,
    benchmark: OutputJson,
): IBenchmarkTaskResult {
    const fields = task.fields.map(({ path, ...spec }) => {
        const rawCandidate = valueAtBenchmarkPath(candidate, path);
        const rawBenchmark = valueAtBenchmarkPath(benchmark, path);
        // Numbers are parsed, not normalized as text: "12.5" must not become "125".
        const pair =
            spec.matcher === "numeric_tolerance"
                ? { candidate: rawCandidate, benchmark: rawBenchmark }
                : canonicalizePair(
                      rawCandidate,
                      rawBenchmark,
                      task.textMatching,
                  );
        const rule = { field: "$.value", ...spec } as FieldRule;
        const { score } = scoreFieldDiff(
            { value: pair.candidate },
            { value: pair.benchmark },
            [rule],
        );
        return {
            path,
            matcher: spec.matcher,
            score: score ?? 0,
            candidate: rawCandidate,
            benchmark: rawBenchmark,
        };
    });
    return {
        key: task.key,
        method: "agreement",
        agreement:
            fields.length === 0
                ? 0
                : fields.reduce((total, field) => total + field.score, 0) /
                  fields.length,
        fields,
    };
}

export interface IScoreAgainstBenchmarkArgs {
    taskMap: ITaskMap;
    /** The run's `benchmark.source`; tasks without their own source use it. */
    source?: BenchmarkSource;
    candidate: OutputJson | null;
    /**
     * The benchmark model's answer, for tasks that use it. Undefined when
     * there is none to compare with; null for an empty answer.
     */
    benchmark?: OutputJson | null;
    /** The item's stored answer, for tasks that use it; undefined when it has none. */
    storedAnswer?: OutputJson | null;
    /** Seeds the blind answer order; use the candidate cell id. */
    cellId: string;
    inputText?: string;
    judge?: IBenchmarkJudgeConfig;
    /** The judge model's prices, for recording what judging cost. */
    judgePricing?: ICostPricing;
    apiKeys: ApiKeys;
    maxTokens?: number;
    /**
     * This cell's earlier benchmark details, when it is scored again because
     * a judge call failed. Tasks scored without an error are kept as they
     * are, so only the failed ones are judged (and paid for) again.
     */
    previous?: IBenchmarkCellDetails;
}

/**
 * Score one candidate cell against the yardsticks for the same item: each
 * task against the benchmark model's answer or the stored answer, as its
 * source says. Tasks whose yardstick is missing are left out. Agreement
 * tasks compare fields; with `judgeDisagreements` a partial match goes to
 * the judge and a full match is a tie. Head-to-head tasks skip the judge
 * when both answers are identical. Rule checks and rubrics need no
 * yardstick: they look at the candidate alone. The cell score is the mean
 * agreement across the agreement, rule-check and rubric tasks scored.
 * `judgeCostUsd` is what this call's judging cost, without kept tasks; a
 * task judged again carries its failed attempts' cost in the details too.
 */
export async function scoreAgainstBenchmark(
    args: IScoreAgainstBenchmarkArgs,
    headToHead: HeadToHeadFn = judgeHeadToHead,
    rubric: RubricJudgeFn = judgeRubric,
): Promise<{
    score: number | null;
    details: IBenchmarkCellDetails;
    judgeCostUsd: number | undefined;
}> {
    const candidate = args.candidate ?? {};
    const kept = new Map(
        (args.previous?.tasks ?? [])
            .filter((task) => task.error === undefined)
            .map((task) => [task.key, task]),
    );
    const yardsticks: Record<BenchmarkSource, OutputJson | null | undefined> = {
        model: args.benchmark,
        labels: args.storedAnswer,
    };
    const tasks = await Promise.all(
        args.taskMap.tasks.flatMap((task) => {
            const keptTask = kept.get(task.key);
            if (keptTask) return [Promise.resolve(keptTask)];
            if (task.method === "rules")
                return [Promise.resolve(scoreRulesTask(task, candidate))];
            if (task.method === "rubric")
                return [
                    scoreRubricTask(
                        task,
                        candidate,
                        {
                            apiKeys: args.apiKeys,
                            ...(args.judge ? { judge: args.judge } : {}),
                            ...(args.inputText !== undefined
                                ? { inputText: args.inputText }
                                : {}),
                            ...(args.maxTokens !== undefined
                                ? { maxTokens: args.maxTokens }
                                : {}),
                            ...(args.judgePricing
                                ? { pricing: args.judgePricing }
                                : {}),
                        },
                        rubric,
                    ),
                ];
            const benchmark =
                yardsticks[benchmarkTaskSource(task, { source: args.source })];
            if (benchmark === undefined) return [];
            return [
                scoreTask(task, candidate, benchmark ?? {}, args, headToHead),
            ];
        }),
    );
    // This call's judge spend, before earlier failed attempts are added in.
    const judgeCostUsd = benchmarkJudgeCostUsd({
        tasks: tasks.filter((task) => kept.get(task.key) !== task),
    });
    // A task judged again keeps what its failed attempts cost, so the
    // details add up to what the cell was charged.
    const earlierCost = new Map(
        (args.previous?.tasks ?? []).flatMap((task) =>
            task.error !== undefined && task.judgeCostUsd !== undefined
                ? [[task.key, task.judgeCostUsd] as const]
                : [],
        ),
    );
    const scored = tasks.map((task) => {
        const earlier = earlierCost.get(task.key);
        return earlier === undefined || kept.get(task.key) === task
            ? task
            : { ...task, judgeCostUsd: (task.judgeCostUsd ?? 0) + earlier };
    });
    const agreements = scored
        .map((task) => task.agreement)
        .filter((value): value is number => value !== undefined);
    return {
        score:
            agreements.length === 0
                ? null
                : agreements.reduce((total, value) => total + value, 0) /
                  agreements.length,
        details: { tasks: scored },
        judgeCostUsd,
    };
}

async function scoreTask(
    task: IBenchmarkTask,
    candidate: OutputJson,
    benchmark: OutputJson,
    args: IScoreAgainstBenchmarkArgs,
    headToHead: HeadToHeadFn,
): Promise<IBenchmarkTaskResult> {
    if (task.method === "rules") return scoreRulesTask(task, candidate);
    if (task.method === "rubric")
        throw new Error("Rubric tasks are scored without a yardstick");
    if (task.method === "agreement") {
        const result = scoreAgreementTask(task, candidate, benchmark);
        if (!task.judgeDisagreements) return result;
        if (result.agreement === 1) return { ...result, verdict: "tie" };
        return {
            ...result,
            ...(await judged(
                task,
                task.fields.map((f) => f.path),
                candidate,
                benchmark,
                args,
                headToHead,
            )),
        };
    }
    const result: IBenchmarkTaskResult = {
        key: task.key,
        method: "head_to_head",
    };
    const a = pick(candidate, task.paths);
    const b = pick(benchmark, task.paths);
    if (JSON.stringify(a) === JSON.stringify(b))
        return { ...result, verdict: "tie" };
    return {
        ...result,
        ...(await judged(
            task,
            task.paths,
            candidate,
            benchmark,
            args,
            headToHead,
        )),
    };
}

async function judged(
    task: IBenchmarkTask,
    paths: string[],
    candidate: OutputJson,
    benchmark: OutputJson,
    args: IScoreAgainstBenchmarkArgs,
    headToHead: HeadToHeadFn,
): Promise<
    Pick<
        IBenchmarkTaskResult,
        "verdict" | "rationale" | "error" | "judgeCostUsd"
    >
> {
    if (!args.judge) return { error: "No judge model is configured" };
    const outcome = await headToHead({
        judge: args.judge,
        apiKeys: args.apiKeys,
        taskName: task.name,
        criteria:
            task.method === "head_to_head"
                ? (task.rubric ?? task.description)
                : task.description,
        inputText: args.inputText,
        candidate: pick(candidate, paths),
        benchmark: pick(benchmark, paths),
        orderSeed: judgeOrderSeed(args.cellId, task.key),
        maxTokens: args.maxTokens,
        pricing: args.judgePricing,
    });
    const cost =
        outcome.costUsd !== undefined ? { judgeCostUsd: outcome.costUsd } : {};
    return outcome.ok
        ? { verdict: outcome.verdict, rationale: outcome.rationale, ...cost }
        : { error: outcome.error, ...cost };
}

/** What the judge calls behind one cell's benchmark scores cost. */
export function benchmarkJudgeCostUsd(
    details: IBenchmarkCellDetails | undefined,
): number | undefined {
    const costs = (details?.tasks ?? []).flatMap((task) =>
        task.judgeCostUsd === undefined ? [] : [task.judgeCostUsd],
    );
    return costs.length > 0
        ? costs.reduce((total, cost) => total + cost, 0)
        : undefined;
}

/** One path → its value; several → an object keyed by path. */
function pick(output: OutputJson, paths: string[]): unknown {
    if (paths.length === 1)
        return valueAtBenchmarkPath(output, paths[0]!) ?? null;
    return Object.fromEntries(
        paths.map((path) => [path, valueAtBenchmarkPath(output, path) ?? null]),
    );
}

function format(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
