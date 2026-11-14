import {
    completionCostFields,
    type ApiKeys,
    type ICostPricing,
} from "@flash-evals/llm-core";
import { getLimitedEvalProvider } from "../llm/providerConcurrency";
import {
    RUBRIC_MAX_SCORE,
    RUBRIC_MIN_SCORE,
    rubricScoreToAgreement,
    valueAtBenchmarkPath,
    type IBenchmarkCriterionScore,
    type IBenchmarkRubricTask,
    type IBenchmarkTaskResult,
} from "@flash-evals/api-contract";
import type { OutputJson } from "../db/jsonTypes";
import { errorMessage } from "../lib/errors";
import type { IBenchmarkJudgeConfig } from "./benchmark";

/**
 * A reason per criterion makes the reply long, and thinking models spend
 * part of the budget before writing it: Gemini 3 Flash used ~2,000 thinking
 * tokens on a 14-criterion rubric and was cut off at 4,000 on a third of
 * calls. Output is billed on tokens used, so a high cap costs nothing extra.
 */
const RUBRIC_MIN_OUTPUT_TOKENS = 16000;

export interface IRubricJudgeInput {
    judge: IBenchmarkJudgeConfig;
    apiKeys: ApiKeys;
    task: IBenchmarkRubricTask;
    inputText?: string;
    /** The answer's fields at the task's paths. */
    answer: unknown;
    maxTokens?: number;
    pricing?: ICostPricing;
}

export type RubricJudgeOutcome = (
    | { ok: true; criteria: IBenchmarkCriterionScore[] }
    | { ok: false; error: string }
) & { costUsd?: number };

export type RubricJudgeFn = (
    input: IRubricJudgeInput,
) => Promise<RubricJudgeOutcome>;

/** One object per criterion, in the task's order, keyed so none is skipped. */
export function rubricResponseSchema(task: IBenchmarkRubricTask) {
    return {
        name: "benchmark_rubric",
        schema: {
            type: "object",
            additionalProperties: false,
            required: ["criteria"],
            properties: {
                criteria: {
                    type: "array",
                    description:
                        "One entry per criterion, in the order given, each scored on its own.",
                    items: {
                        type: "object",
                        additionalProperties: false,
                        required: ["key", "reasoning", "score"],
                        properties: {
                            key: {
                                type: "string",
                                enum: task.criteria.map((c) => c.key),
                            },
                            reasoning: {
                                type: "string",
                                description:
                                    "Evidence from the input and answer, before the score.",
                            },
                            score: {
                                type: "integer",
                                description: `${RUBRIC_MIN_SCORE} (poor) to ${RUBRIC_MAX_SCORE} (excellent).`,
                            },
                        },
                    },
                },
            },
        },
    };
}

export function rubricPrompt(
    input: Pick<IRubricJudgeInput, "task" | "inputText" | "answer">,
): { system: string; prompt: string } {
    const { task } = input;
    const criteria = task.criteria
        .map(
            (c) =>
                `- ${c.key} (${c.name})${c.description?.trim() ? `: ${c.description.trim()}` : ""}`,
        )
        .join("\n");
    const sections = [
        `# Task\n${task.name}${task.description?.trim() ? `\n${task.description.trim()}` : ""}`,
        `# Criteria\n${criteria}`,
        ...(task.instructions?.trim()
            ? [`# Notes for scoring\n${task.instructions.trim()}`]
            : []),
        ...(input.inputText
            ? [`# Input\n<input>\n${input.inputText}\n</input>`]
            : []),
        `# Answer\n<answer>\n${format(input.answer)}\n</answer>`,
    ];
    return {
        system:
            `You score one answer against a rubric. For each criterion, reason from the input first, ` +
            `then give a whole-number score from ${RUBRIC_MIN_SCORE} (poor) to ${RUBRIC_MAX_SCORE} (excellent). ` +
            `Score each criterion on its own. Do not reward length or style, and do not guess which model wrote the answer. Return JSON.`,
        prompt: sections.join("\n\n"),
    };
}

/**
 * The judge's scores, keyed by criterion. A reply that misses a criterion,
 * repeats one or gives anything but a whole number from 1 to 5 is an error,
 * since a partial set would make the mean incomparable across answers.
 */
export function parseRubricReply(
    task: IBenchmarkRubricTask,
    parsed: unknown,
): IBenchmarkCriterionScore[] | string {
    const entries = (parsed as { criteria?: unknown } | undefined)?.criteria;
    if (!Array.isArray(entries)) return "Judge returned no criteria";
    const byKey = new Map<string, IBenchmarkCriterionScore>();
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue;
        const { key, score, reasoning } = entry as Record<string, unknown>;
        if (typeof key !== "string" || byKey.has(key)) continue;
        // Only a whole number counts: true, "4" or 2.5 is a bad reply, not
        // a score to round.
        if (
            typeof score !== "number" ||
            !Number.isInteger(score) ||
            score < RUBRIC_MIN_SCORE ||
            score > RUBRIC_MAX_SCORE
        )
            return `Judge gave "${key}" ${
                typeof score === "number" && Number.isFinite(score)
                    ? `${score}`
                    : "no number"
            }, not a whole-number score from ${RUBRIC_MIN_SCORE} to ${RUBRIC_MAX_SCORE}`;
        byKey.set(key, {
            key,
            score,
            ...(typeof reasoning === "string" && reasoning
                ? { reasoning }
                : {}),
        });
    }
    const missing = task.criteria.filter((c) => !byKey.has(c.key));
    if (missing.length > 0)
        return `Judge skipped ${missing.map((c) => c.key).join(", ")}`;
    return task.criteria.map((c) => byKey.get(c.key)!);
}

export async function judgeRubric(
    input: IRubricJudgeInput,
): Promise<RubricJudgeOutcome> {
    try {
        const result = await getLimitedEvalProvider(
            input.apiKeys,
            input.judge.transport ? { transport: input.judge.transport } : {},
        ).complete({
            model: input.judge.modelId,
            ...rubricPrompt(input),
            responseSchema: rubricResponseSchema(input.task),
            maxTokens: Math.max(input.maxTokens ?? 0, RUBRIC_MIN_OUTPUT_TOKENS),
            reasoningEffort: input.judge.reasoningEffort,
            ...(input.judge.dataPolicy
                ? { dataPolicy: input.judge.dataPolicy }
                : {}),
        });
        // A call that returns bad JSON was still paid for.
        const { costUsd } = completionCostFields(result, input.pricing);
        const cost = costUsd !== undefined ? { costUsd } : {};
        if (result.schemaViolation || result.parsed === undefined)
            return {
                ok: false,
                error: "Judge returned unparseable or truncated output",
                ...cost,
            };
        const criteria = parseRubricReply(input.task, result.parsed);
        return typeof criteria === "string"
            ? { ok: false, error: criteria, ...cost }
            : { ok: true, criteria, ...cost };
    } catch (err) {
        return { ok: false, error: errorMessage(err) };
    }
}

/**
 * Score one model's own answer on a rubric task. Agreement is the mean
 * criterion score scaled to 0 to 1; a judge error leaves it unset, so the
 * answer is left out of the mean rather than counted as zero.
 */
export async function scoreRubricTask(
    task: IBenchmarkRubricTask,
    output: OutputJson,
    args: Omit<IRubricJudgeInput, "task" | "answer" | "judge"> & {
        judge?: IBenchmarkJudgeConfig;
    },
    judge: RubricJudgeFn = judgeRubric,
): Promise<IBenchmarkTaskResult> {
    const result: IBenchmarkTaskResult = { key: task.key, method: "rubric" };
    if (!args.judge)
        return { ...result, error: "No judge model is configured" };
    const outcome = await judge({
        ...args,
        judge: args.judge,
        task,
        answer: Object.fromEntries(
            task.paths.map((path) => [
                path,
                valueAtBenchmarkPath(output, path) ?? null,
            ]),
        ),
    });
    const cost =
        outcome.costUsd !== undefined ? { judgeCostUsd: outcome.costUsd } : {};
    if (!outcome.ok) return { ...result, error: outcome.error, ...cost };
    const total = outcome.criteria.reduce(
        (sum, c) => sum + rubricScoreToAgreement(c.score),
        0,
    );
    return {
        ...result,
        agreement: total / outcome.criteria.length,
        criteria: outcome.criteria,
        ...cost,
    };
}

function format(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
