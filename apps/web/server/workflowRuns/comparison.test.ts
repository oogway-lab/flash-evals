import { describe, expect, it, vi } from "vitest";
import type {
    IPipelineComparisonConfig,
    ITaskMap,
} from "@flash-evals/api-contract";

// The store is replaced below; the modules only need a client to load.
vi.mock("../db/client", () => ({ db: {} }));
vi.mock("../llm/pricing", () => ({
    pricingFor: vi.fn(() => undefined),
    resolvePricingFor: vi.fn(async () => ({
        inputPerMillion: 1,
        outputPerMillion: 2,
    })),
}));

import {
    priorAnswerBenchmarkToKeep,
    scorePipelineAnswers,
    type IAnswerToRejudge,
    type IPipelineComparisonStore,
} from "./comparison";
import { scoreAgainstBenchmark, type HeadToHeadFn } from "../scoring/benchmark";

// Made-up snack-sales extraction; not client data.
const TASK_MAP: ITaskMap = {
    tasks: [
        {
            key: "products",
            name: "Products",
            method: "agreement",
            fields: [{ path: "$.products", matcher: "set_overlap" }],
        },
        {
            key: "notes",
            name: "Meeting notes",
            method: "head_to_head",
            paths: ["$.notes"],
        },
        {
            key: "is_sales",
            name: "Sales call",
            method: "agreement",
            source: "labels",
            fields: [{ path: "$.is_sales", matcher: "exact" }],
        },
    ],
};

const COMPARISON: IPipelineComparisonConfig = {
    runId: "eval-run-1",
    benchmark: {
        source: "model",
        taskMap: TASK_MAP,
        judge: { modelId: "openai/judge-model", transport: "gateway" },
    },
    referenceRunModelId: "rm-ref",
    referenceModelId: "openai/big-model",
    judgeDataPolicy: { onlyHosts: ["vertex"], zeroDataRetention: true },
    maxTokens: 3000,
};

function fakeStore(
    overrides: Partial<IPipelineComparisonStore> = {},
): IPipelineComparisonStore & { saved: Array<[string, unknown]> } {
    const saved: Array<[string, unknown]> = [];
    return {
        saved,
        unscoredAnswers: vi.fn(async () => [
            {
                id: "answer-1",
                datasetItemId: "item-1",
                answer: {
                    products: ["Acme crisps"],
                    notes: "Discussed a reorder.",
                    is_sales: true,
                },
            },
            {
                id: "answer-2",
                datasetItemId: "item-2",
                answer: { products: ["Acme crisps"], is_sales: false },
            },
            // Not in the eval run: never scored.
            {
                id: "answer-9",
                datasetItemId: "item-9",
                answer: { products: [] },
            },
        ]),
        answersToRejudge: vi.fn(async () => []),
        referenceClaimedAt: vi.fn(async () => new Map()),
        evalItemIds: vi.fn(async () => new Set(["item-1", "item-2"])),
        referenceOutputs: vi.fn(
            async () =>
                new Map([
                    [
                        "item-1",
                        {
                            products: ["Acme crisps", "Acme dip"],
                            notes: "Discussed a reorder of crisps.",
                            is_sales: true,
                        },
                    ],
                ]),
        ),
        storedAnswers: vi.fn(
            async () =>
                new Map([
                    ["item-1", { is_sales: true }],
                    ["item-2", { is_sales: true }],
                ]),
        ),
        inputTexts: vi.fn(async () => new Map([["item-1", "Call transcript"]])),
        saveScore: vi.fn(async (id, result) => {
            saved.push([id, result]);
        }),
        ...overrides,
    };
}

const stopNever = { check: vi.fn(async () => undefined) };

describe("scorePipelineAnswers", () => {
    it("scores each final answer against the eval run's yardsticks with its judge", async () => {
        const store = fakeStore();
        const headToHead = vi.fn<HeadToHeadFn>(async () => ({
            ok: true,
            verdict: "tie",
            rationale: "Same substance.",
            costUsd: 0.002,
        }));

        await scorePipelineAnswers(
            {
                workflowRunId: "wf-run-1",
                comparison: COMPARISON,
                apiKeys: {},
                stop: stopNever,
            },
            {
                store,
                score: (args) => scoreAgainstBenchmark(args, headToHead),
            },
        );

        expect(store.referenceOutputs).toHaveBeenCalledWith(
            "eval-run-1",
            "rm-ref",
            ["item-1", "item-2"],
        );
        expect(store.saved.map(([id]) => id).sort()).toEqual([
            "answer-1",
            "answer-2",
        ]);
        // The judge sees the item and uses the eval run's judge with the
        // combined data rules.
        expect(headToHead).toHaveBeenCalledTimes(1);
        expect(headToHead.mock.calls[0]![0]).toMatchObject({
            judge: {
                modelId: "openai/judge-model",
                transport: "gateway",
                dataPolicy: { onlyHosts: ["vertex"], zeroDataRetention: true },
            },
            inputText: "Call transcript",
            maxTokens: 3000,
        });
        const first = store.saved.find(([id]) => id === "answer-1")![1] as {
            score: number;
            details: { tasks: Array<{ key: string; agreement?: number }> };
            judgeCostUsd: number;
        };
        expect(first.details.tasks.map((task) => task.key)).toEqual([
            "products",
            "notes",
            "is_sales",
        ]);
        expect(first.judgeCostUsd).toBe(0.002);
        const products = first.details.tasks[0]!.agreement!;
        expect(products).toBeGreaterThan(0);
        expect(products).toBeLessThan(1);
        // Mean agreement over the agreement tasks (products, is_sales).
        expect(first.score).toBeCloseTo((products + 1) / 2);
        // item-2: the reference failed it, so only the stored answer applies.
        const second = store.saved.find(([id]) => id === "answer-2")![1] as {
            score: number;
            details: { tasks: Array<{ key: string; agreement?: number }> };
        };
        expect(second.details.tasks).toEqual([
            expect.objectContaining({ key: "is_sales", agreement: 0 }),
        ]);
        expect(second.score).toBe(0);
    });

    it("marks an answer scored with no tasks when there is nothing to compare with", async () => {
        const store = fakeStore({
            storedAnswers: vi.fn(async () => new Map()),
            referenceOutputs: vi.fn(async () => new Map()),
        });
        const score = vi.fn();

        await scorePipelineAnswers(
            {
                workflowRunId: "wf-run-1",
                comparison: COMPARISON,
                apiKeys: {},
                stop: stopNever,
            },
            { store, score },
        );

        expect(score).not.toHaveBeenCalled();
        expect(store.saved).toEqual([
            ["answer-1", { score: null }],
            ["answer-2", { score: null }],
        ]);
    });

    it("stops scoring when the run is cancelled or reaches its spend limit", async () => {
        const store = fakeStore();
        const score = vi.fn();

        await scorePipelineAnswers(
            {
                workflowRunId: "wf-run-1",
                comparison: COMPARISON,
                apiKeys: {},
                stop: { check: vi.fn(async () => "spend_cap" as const) },
            },
            { store, score },
        );

        expect(score).not.toHaveBeenCalled();
        expect(store.saved).toEqual([]);
    });

    it("leaves an answer unscored when scoring throws, so a resume retries it", async () => {
        const store = fakeStore();
        const score = vi.fn(async () => {
            throw new Error("judge down");
        });
        const stderr = vi
            .spyOn(console, "error")
            .mockImplementation(() => undefined);

        try {
            await scorePipelineAnswers(
                {
                    workflowRunId: "wf-run-1",
                    comparison: COMPARISON,
                    apiKeys: {},
                    stop: stopNever,
                },
                { store, score },
            );
        } finally {
            stderr.mockRestore();
        }

        expect(store.saved).toEqual([]);
    });

    describe("on a resume", () => {
        const scoredAt = new Date("2026-11-08T10:00:00Z");
        const keptProducts = {
            key: "products",
            method: "agreement" as const,
            agreement: 0.5,
            judgeCostUsd: 0.001,
        };
        const keptIsSales = {
            key: "is_sales",
            method: "agreement" as const,
            agreement: 1,
        };
        const failed: IAnswerToRejudge = {
            id: "answer-1",
            datasetItemId: "item-1",
            answer: {
                products: ["Acme crisps"],
                notes: "Discussed a reorder.",
                is_sales: true,
            },
            previous: {
                tasks: [
                    keptProducts,
                    {
                        key: "notes",
                        method: "head_to_head",
                        error: "402 budget exceeded",
                    },
                    keptIsSales,
                ],
            },
            scoredAt,
        };
        const run = (store: IPipelineComparisonStore, score: unknown) =>
            scorePipelineAnswers(
                {
                    workflowRunId: "wf-run-1",
                    comparison: COMPARISON,
                    apiKeys: {},
                    stop: stopNever,
                },
                { store, score: score as typeof scoreAgainstBenchmark },
            );

        it("judges again only the failed tasks, keeping the rest and counting only the new cost", async () => {
            const store = fakeStore({
                unscoredAnswers: vi.fn(async () => []),
                answersToRejudge: vi.fn(async () => [failed]),
            });
            const headToHead = vi.fn<HeadToHeadFn>(async () => ({
                ok: true,
                verdict: "tie",
                rationale: "again",
                costUsd: 0.002,
            }));

            await run(
                store,
                (args: Parameters<typeof scoreAgainstBenchmark>[0]) =>
                    scoreAgainstBenchmark(args, headToHead),
            );

            expect(headToHead).toHaveBeenCalledTimes(1);
            expect(store.referenceClaimedAt).toHaveBeenCalledWith(
                "eval-run-1",
                "rm-ref",
                ["item-1"],
            );
            expect(store.saved).toHaveLength(1);
            const [id, saved] = store.saved[0]! as [
                string,
                {
                    score: number;
                    details: { tasks: Array<Record<string, unknown>> };
                    judgeCostUsd: number;
                },
            ];
            expect(id).toBe("answer-1");
            expect(saved.details.tasks[0]).toBe(keptProducts);
            expect(saved.details.tasks[1]).toMatchObject({
                key: "notes",
                verdict: "tie",
            });
            expect(saved.details.tasks[1]).not.toHaveProperty("error");
            expect(saved.details.tasks[2]).toBe(keptIsSales);
            // Kept tasks were paid for on the earlier pass.
            expect(saved.judgeCostUsd).toBe(0.002);
            expect(saved.score).toBeCloseTo(0.75);
        });

        it("leaves fully judged answers alone", async () => {
            const store = fakeStore({ unscoredAnswers: vi.fn(async () => []) });
            const score = vi.fn();

            await run(store, score);

            expect(score).not.toHaveBeenCalled();
            expect(store.saved).toEqual([]);
        });

        it("scores from scratch when the reference answer was generated again after scoring", async () => {
            const store = fakeStore({
                unscoredAnswers: vi.fn(async () => []),
                answersToRejudge: vi.fn(async () => [failed]),
                referenceClaimedAt: vi.fn(
                    async () =>
                        new Map([["item-1", new Date("2026-11-08T11:00:00Z")]]),
                ),
            });
            const score = vi.fn(
                async (_args: Parameters<typeof scoreAgainstBenchmark>[0]) => ({
                    score: 1,
                    details: { tasks: [] },
                    judgeCostUsd: 0.003,
                }),
            );

            await run(store, score);

            expect(score).toHaveBeenCalledTimes(1);
            expect(score.mock.calls[0]![0]).not.toHaveProperty("previous");
        });
    });
});

describe("priorAnswerBenchmarkToKeep", () => {
    const previous = {
        tasks: [
            { key: "notes", method: "head_to_head" as const, error: "402" },
        ],
    };
    const answer: IAnswerToRejudge = {
        id: "answer-1",
        datasetItemId: "item-1",
        answer: {},
        previous,
        scoredAt: new Date("2026-11-08T10:00:00Z"),
    };

    it("keeps earlier details for an answer judged again only because a judge failed", () => {
        expect(priorAnswerBenchmarkToKeep(answer, new Map())).toBe(previous);
        expect(
            priorAnswerBenchmarkToKeep(
                answer,
                new Map([["item-1", new Date("2026-11-08T09:00:00Z")]]),
            ),
        ).toBe(previous);
    });

    it("keeps nothing for an answer never scored (or changed since)", () => {
        expect(
            priorAnswerBenchmarkToKeep(
                { id: "answer-2", datasetItemId: "item-2", answer: {} },
                new Map(),
            ),
        ).toBeUndefined();
    });

    it("keeps nothing when the item's reference answer is newer than the score", () => {
        expect(
            priorAnswerBenchmarkToKeep(
                answer,
                new Map([["item-1", new Date("2026-11-08T11:00:00Z")]]),
            ),
        ).toBeUndefined();
    });
});
