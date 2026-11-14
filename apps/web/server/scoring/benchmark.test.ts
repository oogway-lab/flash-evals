import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
    CompletionRequest,
    CompletionResult,
} from "@flash-evals/llm-core";
import type * as LlmCore from "@flash-evals/llm-core";
import { getEvalProvider } from "@flash-evals/llm-core";
import type { ITaskMap } from "@flash-evals/api-contract";
import {
    benchmarkJudgeCostUsd,
    candidateGoesFirst,
    judgeHeadToHead,
    scoreAgainstBenchmark,
    scoreAgreementTask,
    type HeadToHeadFn,
    type IHeadToHeadInput,
} from "./benchmark";

vi.mock("@flash-evals/llm-core", async (importOriginal) => {
    const actual = await importOriginal<typeof LlmCore>();
    return { ...actual, getEvalProvider: vi.fn() };
});

function judgeReplies(parsed: unknown, extra: Partial<CompletionResult> = {}) {
    const complete = vi.fn(
        async (_req: CompletionRequest): Promise<CompletionResult> => ({
            text: JSON.stringify(parsed),
            parsed,
            usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
            latencyMs: 1,
            ...extra,
        }),
    );
    vi.mocked(getEvalProvider).mockReturnValue({ complete });
    return complete;
}

// Seeds chosen so each answer order is exercised.
const firstSeed = ["s0", "s1", "s2", "s3", "s4"].find(candidateGoesFirst)!;
const secondSeed = ["s0", "s1", "s2", "s3", "s4"].find(
    (s) => !candidateGoesFirst(s),
)!;

const baseInput: IHeadToHeadInput = {
    judge: { modelId: "judge-model", transport: "openrouter" },
    apiKeys: {},
    taskName: "Summary",
    inputText: "synthetic transcript",
    candidate: "summary from the cheap model",
    benchmark: "summary from the strong model",
    orderSeed: firstSeed,
};

describe("judgeHeadToHead", () => {
    beforeEach(() => vi.clearAllMocks());

    it("hides which answer is the benchmark and maps A/B back in both orders", async () => {
        const complete = judgeReplies({
            reasoning: "A is more complete",
            better: "A",
        });

        const first = await judgeHeadToHead(baseInput);
        const prompt = complete.mock.calls[0]![0].prompt;
        expect(prompt).toContain("<answer_a>\nsummary from the cheap model");
        expect(prompt).not.toMatch(/benchmark|candidate|reference/i);
        expect(first).toEqual({
            ok: true,
            verdict: "win",
            rationale: "A is more complete",
        });
        expect(getEvalProvider).toHaveBeenCalledWith(
            {},
            { transport: "openrouter" },
        );

        const second = await judgeHeadToHead({
            ...baseInput,
            orderSeed: secondSeed,
        });
        expect(complete.mock.calls[1]![0].prompt).toContain(
            "<answer_a>\nsummary from the strong model",
        );
        expect(second).toMatchObject({ verdict: "loss" });
    });

    it("returns ties and reports bad or failed judge replies as errors", async () => {
        judgeReplies({ reasoning: "same", better: "tie" });
        expect(await judgeHeadToHead(baseInput)).toMatchObject({
            verdict: "tie",
        });

        judgeReplies({ reasoning: "?", better: "C" });
        expect(await judgeHeadToHead(baseInput)).toEqual({
            ok: false,
            error: "Judge verdict was invalid or missing",
        });

        judgeReplies(undefined, { schemaViolation: true });
        expect(await judgeHeadToHead(baseInput)).toMatchObject({ ok: false });

        vi.mocked(getEvalProvider).mockReturnValue({
            complete: vi.fn().mockRejectedValue(new Error("rate limited")),
        });
        expect(await judgeHeadToHead(baseInput)).toEqual({
            ok: false,
            error: "rate limited",
        });
    });

    it("gives a thinking judge room beyond a small run output cap", async () => {
        const complete = judgeReplies({ reasoning: "r", better: "tie" });
        await judgeHeadToHead({ ...baseInput, maxTokens: 4096 });
        expect(complete.mock.calls[0]![0].maxTokens).toBe(16000);
        await judgeHeadToHead({ ...baseInput, maxTokens: 32000 });
        expect(complete.mock.calls[1]![0].maxTokens).toBe(32000);
    });

    it("prices the judge call, including replies that could not be used", async () => {
        const pricing = {
            promptPricePerToken: 0.001,
            completionPricePerToken: 0.002,
        };
        judgeReplies({ reasoning: "r", better: "tie" });
        expect(await judgeHeadToHead({ ...baseInput, pricing })).toMatchObject({
            ok: true,
            costUsd: 0.003,
        });

        judgeReplies(undefined, { schemaViolation: true });
        expect(await judgeHeadToHead({ ...baseInput, pricing })).toMatchObject({
            ok: false,
            costUsd: 0.003,
        });

        // Without prices the cost is unknown, not zero.
        judgeReplies({ reasoning: "r", better: "tie" });
        expect(await judgeHeadToHead(baseInput)).not.toHaveProperty("costUsd");
    });
});

describe("benchmarkJudgeCostUsd", () => {
    it("adds up the judge cost of every judged task in a cell", () => {
        expect(
            benchmarkJudgeCostUsd({
                tasks: [
                    { key: "a", method: "head_to_head", judgeCostUsd: 0.01 },
                    { key: "b", method: "agreement", agreement: 1 },
                    { key: "c", method: "rubric", judgeCostUsd: 0.02 },
                ],
            }),
        ).toBeCloseTo(0.03);
        expect(
            benchmarkJudgeCostUsd({
                tasks: [{ key: "a", method: "agreement", agreement: 1 }],
            }),
        ).toBeUndefined();
        expect(benchmarkJudgeCostUsd(undefined)).toBeUndefined();
    });
});

describe("scoreAgainstBenchmark", () => {
    const taskMap: ITaskMap = {
        tasks: [
            {
                key: "competitors",
                name: "Competitor mentions",
                description: "Competitor brands named in the call.",
                method: "agreement",
                fields: [{ path: "$.competitors", matcher: "set_overlap" }],
                judgeDisagreements: true,
            },
            {
                key: "sales",
                name: "Sales call",
                method: "agreement",
                fields: [{ path: "$.is_sales", matcher: "exact" }],
            },
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
                rubric: "Covers the order.",
            },
        ],
    };
    const benchmark = {
        competitors: ["BrandA", "BrandB"],
        is_sales: true,
        summary: "Ordered 10 units.",
    };

    it("scores agreement per task and sends disagreements and free text to the judge", async () => {
        const headToHead = vi.fn<HeadToHeadFn>(async () => ({
            ok: true,
            verdict: "win",
            rationale: "r",
        }));
        const result = await scoreAgainstBenchmark(
            {
                taskMap,
                candidate: {
                    competitors: ["branda"],
                    is_sales: false,
                    summary: "Ordered ten units.",
                },
                benchmark,
                cellId: "cell-1",
                inputText: "synthetic transcript",
                judge: { modelId: "judge-model" },
                apiKeys: {},
            },
            headToHead,
        );

        expect(result.details.tasks).toEqual([
            {
                key: "competitors",
                method: "agreement",
                agreement: 2 / 3,
                fields: [
                    {
                        path: "$.competitors",
                        matcher: "set_overlap",
                        score: 2 / 3,
                        candidate: ["branda"],
                        benchmark: ["BrandA", "BrandB"],
                    },
                ],
                verdict: "win",
                rationale: "r",
            },
            {
                key: "sales",
                method: "agreement",
                agreement: 0,
                fields: [
                    {
                        path: "$.is_sales",
                        matcher: "exact",
                        score: 0,
                        candidate: false,
                        benchmark: true,
                    },
                ],
            },
            {
                key: "summary",
                method: "head_to_head",
                verdict: "win",
                rationale: "r",
            },
        ]);
        expect(result.score).toBe(1 / 3);
        expect(headToHead).toHaveBeenCalledTimes(2);
        expect(headToHead.mock.calls[0]![0]).toMatchObject({
            taskName: "Competitor mentions",
            criteria: "Competitor brands named in the call.",
            candidate: ["branda"],
            benchmark: ["BrandA", "BrandB"],
            orderSeed: "cell-1:competitors",
        });
        expect(headToHead.mock.calls[1]![0]).toMatchObject({
            criteria: "Covers the order.",
            candidate: "Ordered ten units.",
            orderSeed: "cell-1:summary",
        });
    });

    it("judges again only the tasks whose judge failed, counting only the new cost", async () => {
        const headToHead = vi.fn<HeadToHeadFn>(async () => ({
            ok: true,
            verdict: "tie",
            rationale: "again",
            costUsd: 0.002,
        }));
        const keptCompetitors = {
            key: "competitors",
            method: "agreement" as const,
            agreement: 2 / 3,
            verdict: "win" as const,
            judgeCostUsd: 0.001,
        };
        const result = await scoreAgainstBenchmark(
            {
                taskMap,
                candidate: {
                    competitors: ["branda"],
                    is_sales: true,
                    summary: "Ordered ten units.",
                },
                benchmark,
                cellId: "cell-1",
                judge: { modelId: "judge-model" },
                apiKeys: {},
                previous: {
                    tasks: [
                        keptCompetitors,
                        {
                            key: "summary",
                            method: "head_to_head",
                            error: "402 budget exceeded",
                            judgeCostUsd: 0.0005,
                        },
                    ],
                },
            },
            headToHead,
        );

        expect(headToHead).toHaveBeenCalledTimes(1);
        expect(headToHead.mock.calls[0]![0]).toMatchObject({
            orderSeed: "cell-1:summary",
        });
        expect(result.details.tasks[0]).toBe(keptCompetitors);
        expect(result.details.tasks[2]).toMatchObject({
            key: "summary",
            verdict: "tie",
        });
        expect(result.details.tasks[2]).not.toHaveProperty("error");
        expect(result.judgeCostUsd).toBeCloseTo(0.002, 6);
        // The details keep the failed attempt's cost, so they add up to what
        // the cell was charged over both attempts.
        expect(result.details.tasks[2]!.judgeCostUsd).toBeCloseTo(0.0025, 6);
    });

    it("matches transliterated spellings through normalization and aliases", async () => {
        const result = await scoreAgainstBenchmark({
            taskMap: {
                tasks: [
                    {
                        key: "competitors",
                        name: "Competitor mentions",
                        method: "agreement",
                        fields: [
                            { path: "$.competitors", matcher: "set_overlap" },
                        ],
                        textMatching: { aliases: { "Parle-G": ["parleji"] } },
                    },
                ],
            },
            candidate: { competitors: ["Parleji", "sun feast"] },
            benchmark: { competitors: ["Parle G", "Sunfeast"] },
            cellId: "c",
            apiKeys: {},
        });
        expect(result.score).toBe(1);
        // Details keep the original spellings for review.
        expect(result.details.tasks[0]!.fields![0]).toMatchObject({
            candidate: ["Parleji", "sun feast"],
            benchmark: ["Parle G", "Sunfeast"],
        });
    });

    it("compares numbers written as text as numbers, not normalized text", async () => {
        const score = (candidate: string, benchmark: string) =>
            scoreAgreementTask(
                {
                    key: "amount",
                    name: "Amount",
                    method: "agreement",
                    fields: [
                        {
                            path: "$.amount",
                            matcher: "numeric_tolerance",
                            tolerance: 0.05,
                            relative: true,
                        },
                    ],
                },
                { amount: candidate },
                { amount: benchmark },
            ).agreement;
        expect(score("12.5", "120")).toBe(0);
        expect(score("-5", "5")).toBe(0);
        expect(score("12.5", "12.4")).toBe(1);
        // Indian and Western grouping, currency signs and spaces.
        expect(score("1,20,000", "120000")).toBe(1);
        expect(score("₹50000", "50,000")).toBe(1);
        expect(score("Rs. 1,500.50", "INR 1500.5")).toBe(1);
        expect(score("$ 2,000", "2000")).toBe(1);
        expect(score("-₹500", "-500")).toBe(1);
        expect(score("₹-500", "500")).toBe(0);
        // Not a grouping: left unparsed rather than read as 125.
        expect(score("12,5", "125")).toBe(0);
        expect(score("12 5", "125")).toBe(0);
        expect(score("1 000", "1000")).toBe(1);
        expect(score("₹ 1 20 000", "120000")).toBe(1);
        // Only plain decimals: no hex, exponent or Infinity.
        expect(score("0x10", "16")).toBe(0);
        expect(score("1e3", "1000")).toBe(0);
        expect(score("Infinity", "Infinity")).toBe(0);
        expect(score("", "0")).toBe(0);
    });

    it("calls identical answers a tie without spending a judge call", async () => {
        const headToHead = vi.fn<HeadToHeadFn>();
        const result = await scoreAgainstBenchmark(
            {
                taskMap,
                candidate: { ...benchmark },
                benchmark,
                cellId: "c",
                judge: { modelId: "j" },
                apiKeys: {},
            },
            headToHead,
        );
        expect(headToHead).not.toHaveBeenCalled();
        expect(result.score).toBe(1);
        expect(result.details.tasks.map((task) => task.verdict)).toEqual([
            "tie",
            undefined,
            "tie",
        ]);
    });

    it("keeps each judge call's cost on its task result", async () => {
        const headToHead = vi.fn<HeadToHeadFn>(async () => ({
            ok: false,
            error: "bad reply",
            costUsd: 0.004,
        }));
        const result = await scoreAgainstBenchmark(
            {
                taskMap,
                candidate: { ...benchmark, summary: "Ordered ten units." },
                benchmark,
                cellId: "c",
                judge: { modelId: "j" },
                apiKeys: {},
            },
            headToHead,
        );
        expect(result.details.tasks[2]).toEqual({
            key: "summary",
            method: "head_to_head",
            error: "bad reply",
            judgeCostUsd: 0.004,
        });
        expect(result.details.tasks[0]).not.toHaveProperty("judgeCostUsd");
    });

    it("scores each task against its own yardstick and skips missing ones", async () => {
        const tasks: ITaskMap = {
            tasks: [
                {
                    key: "competitors",
                    name: "Competitor mentions",
                    method: "agreement",
                    fields: [{ path: "$.competitors", matcher: "set_overlap" }],
                },
                {
                    key: "sales",
                    name: "Sales call",
                    method: "agreement",
                    fields: [{ path: "$.is_sales", matcher: "exact" }],
                    source: "labels",
                },
            ],
        };
        const candidate = { competitors: ["BrandA"], is_sales: true };
        const both = await scoreAgainstBenchmark({
            taskMap: tasks,
            candidate,
            benchmark: { competitors: ["BrandA"], is_sales: false },
            storedAnswer: { competitors: [], is_sales: true },
            cellId: "c",
            apiKeys: {},
        });
        expect(
            both.details.tasks.map((task) => [task.key, task.agreement]),
        ).toEqual([
            ["competitors", 1],
            ["sales", 1],
        ]);

        // The benchmark model's own cell: only the stored-answer task applies.
        const labelsOnly = await scoreAgainstBenchmark({
            taskMap: tasks,
            candidate,
            storedAnswer: { is_sales: false },
            cellId: "c",
            apiKeys: {},
        });
        expect(labelsOnly.details.tasks.map((task) => task.key)).toEqual([
            "sales",
        ]);
        expect(labelsOnly.score).toBe(0);

        // The run's source applies to tasks without their own.
        const none = await scoreAgainstBenchmark({
            taskMap: tasks,
            source: "labels",
            candidate,
            benchmark: { competitors: ["BrandA"] },
            cellId: "c",
            apiKeys: {},
        });
        expect(none).toEqual({ score: null, details: { tasks: [] } });
    });

    it("records an error when a judged task has no judge model", async () => {
        const result = await scoreAgainstBenchmark({
            taskMap,
            candidate: null,
            benchmark,
            cellId: "c",
            apiKeys: {},
        });
        expect(result.score).toBe(0);
        expect(result.details.tasks[0]).toMatchObject({
            agreement: 0,
            error: "No judge model is configured",
        });
        expect(result.details.tasks[2]).toEqual({
            key: "summary",
            method: "head_to_head",
            error: "No judge model is configured",
        });
    });
});
