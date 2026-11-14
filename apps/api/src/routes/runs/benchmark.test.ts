import { describe, expect, it } from "vitest";
import type {
    IJsonSchemaObject,
    IMatrixCellScore,
    IRunBenchmarkConfig,
    IRunDetailCell,
} from "@flash-evals/api-contract";
import {
    benchmarkComparisonForRun,
    validateRunBenchmark,
} from "./benchmark.js";

const agreementOnly: IRunBenchmarkConfig = {
    taskMap: {
        tasks: [
            {
                key: "sales",
                name: "Sales call",
                method: "agreement",
                fields: [{ path: "$.is_sales", matcher: "exact" }],
            },
        ],
    },
};

const withSummary: IRunBenchmarkConfig = {
    taskMap: {
        tasks: [
            ...agreementOnly.taskMap.tasks,
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
        ],
    },
};

const schema: IJsonSchemaObject = {
    type: "object",
    properties: {
        is_sales: { type: "boolean" },
        summary: { type: "string" },
    },
};

const models = [
    {
        modelId: "anthropic/claude-opus-4.8",
        promptVersionId: null,
        isReference: true,
    },
    {
        modelId: "openai/gpt-5.5-mini",
        promptVersionId: null,
        isReference: false,
    },
];

function rejects(
    input: Parameters<typeof validateRunBenchmark>[0],
    message: string,
    outputSchema?: IJsonSchemaObject,
) {
    expect(() => validateRunBenchmark(input, outputSchema)).toThrow(message);
}

describe("validateRunBenchmark", () => {
    it("accepts runs without benchmark settings and valid benchmark runs", () => {
        expect(() => validateRunBenchmark({ models })).not.toThrow();
        expect(() =>
            validateRunBenchmark({ models, benchmark: agreementOnly }, schema),
        ).not.toThrow();
        expect(() =>
            validateRunBenchmark(
                {
                    models,
                    benchmark: {
                        ...withSummary,
                        judge: { modelId: "anthropic/claude-opus-4.8" },
                    },
                },
                schema,
            ),
        ).not.toThrow();
    });

    it("rejects a malformed benchmark with a clear message", () => {
        rejects(
            {
                models,
                benchmark: {
                    taskMap: {
                        tasks: [{ key: "x", name: "X", method: "vibes" }],
                    },
                } as never,
            },
            "benchmark: taskMap.tasks.0.method",
        );
        rejects(
            { models, benchmark: { taskMap: "everything" } as never },
            "benchmark: taskMap",
        );
    });

    it("needs a reference model and something to compare with it", () => {
        rejects(
            {
                models: models.map((model) => ({
                    ...model,
                    isReference: false,
                })),
                benchmark: agreementOnly,
            },
            "Choose a reference model",
        );
        rejects(
            { models: [models[0]!], benchmark: agreementOnly },
            "Add at least one model",
        );
        rejects(
            { models, benchmark: agreementOnly, audioRunMode: "stt_metrics" },
            "cannot be compared with a benchmark",
        );
    });

    it("lets a setup comparison's eval run hold only the reference", () => {
        expect(() =>
            validateRunBenchmark(
                { models: [models[0]!], benchmark: agreementOnly },
                schema,
                { allowReferenceOnly: true },
            ),
        ).not.toThrow();
    });

    it("rejects an invalid task map, including paths missing from the schema", () => {
        rejects(
            { models, benchmark: { taskMap: { tasks: [] } } },
            "benchmark: Add at least one task.",
        );
        rejects(
            {
                models,
                benchmark: {
                    taskMap: {
                        tasks: [
                            {
                                key: "brands",
                                name: "Brands",
                                method: "agreement",
                                fields: [
                                    {
                                        path: "$.brands",
                                        matcher: "set_overlap",
                                    },
                                ],
                            },
                        ],
                    },
                },
            },
            '"$.brands" is not in the output schema',
            schema,
        );
    });

    it("rejects a rule pattern the linear-time engine can't compile", () => {
        const withPattern = (pattern: string): IRunBenchmarkConfig => ({
            taskMap: {
                tasks: [
                    {
                        key: "checks",
                        name: "Checks",
                        method: "rules",
                        rules: [
                            {
                                key: "labels",
                                name: "Labels",
                                kind: "pattern_absent",
                                paths: ["$.summary"],
                                patterns: [pattern],
                            },
                        ],
                    },
                ],
            },
        });
        rejects(
            { models, benchmark: withPattern("x{1001}") },
            'benchmark: Checks / Labels: "x{1001}" can\'t be run by the rule checker (invalid repeat count: `{1001}`); simplify it.',
            schema,
        );
        expect(() =>
            validateRunBenchmark(
                { models, benchmark: withPattern("\\w*\\w*\\w*\\w*!") },
                schema,
            ),
        ).not.toThrow();
    });

    it("uses stored answers with or without a reference model", () => {
        const labels = { ...agreementOnly, source: "labels" as const };
        const candidate = { ...models[1]!, isReference: false };
        expect(() =>
            validateRunBenchmark({ models: [candidate], benchmark: labels }),
        ).not.toThrow();
        expect(() =>
            validateRunBenchmark({ models, benchmark: labels }),
        ).not.toThrow();
    });

    it("needs a reference model only when a task uses the benchmark model", () => {
        const sales = agreementOnly.taskMap.tasks[0]!;
        const summary = withSummary.taskMap.tasks[1]!;
        const candidate = { ...models[1]!, isReference: false };
        // Every task uses stored answers: no reference model needed.
        const labelsOnly: IRunBenchmarkConfig = {
            taskMap: { tasks: [{ ...sales, source: "labels" }] },
        };
        expect(() =>
            validateRunBenchmark(
                { models: [candidate], benchmark: labelsOnly },
                schema,
            ),
        ).not.toThrow();
        // A labels run with one task on the benchmark model needs one.
        const mixed: IRunBenchmarkConfig = {
            source: "labels",
            taskMap: {
                tasks: [sales, { ...summary, source: "model" }],
            },
            judge: { modelId: "anthropic/claude-opus-4.8" },
        };
        expect(() =>
            validateRunBenchmark({ models, benchmark: mixed }, schema),
        ).not.toThrow();
        rejects(
            { models: [candidate], benchmark: mixed },
            "Choose a reference model",
        );
    });

    it("rejects an unknown task source", () => {
        rejects(
            {
                models,
                benchmark: {
                    taskMap: {
                        tasks: [
                            {
                                ...agreementOnly.taskMap.tasks[0]!,
                                source: "truth",
                            },
                        ],
                    },
                } as never,
            },
            "benchmark: taskMap.tasks.0.source",
        );
    });

    it("needs a usable judge when a task is judged", () => {
        rejects({ models, benchmark: withSummary }, "Choose a judge model");
        rejects(
            {
                models,
                benchmark: {
                    ...withSummary,
                    // No structured output on Vercel AI Gateway.
                    judge: { modelId: "zai/glm-5.2" },
                },
            },
            "GLM 5.2 cannot be used as a judge model",
        );
        rejects(
            {
                models,
                benchmark: {
                    ...withSummary,
                    judge: {
                        modelId: "openrouter/z-ai/glm-5.2",
                        transport: "openai",
                    },
                },
            },
            'benchmark: Model "openrouter/z-ai/glm-5.2" can\'t be sent through OpenAI',
        );
        // A judge the app doesn't know can't be mapped to any provider.
        rejects(
            {
                models,
                benchmark: {
                    ...withSummary,
                    judge: {
                        modelId: "unknown-vendor/judge-x",
                        transport: "gateway",
                    },
                },
            },
            'benchmark: Model "unknown-vendor/judge-x" can\'t be sent through Vercel AI Gateway',
        );
    });
});

describe("validateRunBenchmark policy", () => {
    it("accepts a valid policy and rejects out-of-range or unknown entries", () => {
        expect(() =>
            validateRunBenchmark({
                models,
                benchmark: {
                    ...agreementOnly,
                    policy: {
                        minAgreement: 0.95,
                        maxRelativeCost: 0.4,
                        tasks: { sales: { minAgreement: 0.99 } },
                    },
                },
            }),
        ).not.toThrow();
        rejects(
            {
                models,
                benchmark: { ...agreementOnly, policy: { minAgreement: 1.5 } },
            },
            "policy.minAgreement must be between 0 and 1",
        );
        rejects(
            {
                models,
                benchmark: {
                    ...agreementOnly,
                    policy: { maxDropBelowReference: -0.02 },
                },
            },
            "policy.maxDropBelowReference must be between 0 and 1",
        );
        rejects(
            {
                models,
                benchmark: {
                    ...agreementOnly,
                    policy: { tasks: { brands: { minAgreement: 0.9 } } },
                },
            },
            'policy.tasks has "brands", which is not a task',
        );
        rejects(
            {
                models,
                benchmark: { ...agreementOnly, policy: { maxRelativeCost: 0 } },
            },
            "policy.maxRelativeCost must be above 0",
        );
    });
});

describe("benchmarkComparisonForRun", () => {
    const runModels = [
        {
            id: "rm-bench",
            modelId: "bench",
            promptVersionId: null,
            isReference: true,
        },
        {
            id: "rm-cheap",
            modelId: "cheap",
            promptVersionId: null,
            isReference: false,
        },
    ];

    function cell(
        id: string,
        runModelId: string,
        datasetItemId: string,
        status: IRunDetailCell["status"],
        costUsd: number,
    ): IRunDetailCell {
        return {
            id,
            runModelId,
            datasetItemId,
            status,
            outputJson: null,
            latencyMs: 100,
            costUsd,
            promptTokens: null,
            completionTokens: null,
            error: null,
        };
    }

    function benchmarkScore(agreement: number): IMatrixCellScore[] {
        return [
            {
                scorerType: "field_diff",
                score: 1,
                rationale: null,
                detailsJson: {},
            },
            {
                scorerType: "benchmark",
                score: agreement,
                rationale: null,
                detailsJson: {
                    tasks: [{ key: "sales", method: "agreement", agreement }],
                },
            },
        ];
    }

    it("reports per-label results for a classification task", () => {
        const labelled = (truth: boolean, answer: boolean) => [
            {
                scorerType: "benchmark" as const,
                score: truth === answer ? 1 : 0,
                rationale: null,
                detailsJson: {
                    tasks: [
                        {
                            key: "sales",
                            method: "agreement",
                            agreement: truth === answer ? 1 : 0,
                            fields: [
                                {
                                    path: "$.is_sales",
                                    matcher: "exact",
                                    score: truth === answer ? 1 : 0,
                                    candidate: answer,
                                    benchmark: truth,
                                },
                            ],
                        },
                    ],
                },
            },
        ];
        const [, cheap] = benchmarkComparisonForRun({
            benchmark: { ...agreementOnly, source: "labels" },
            labeledItemIds: ["i1", "i2", "i3"],
            models: runModels,
            cells: [
                cell("c1", "rm-cheap", "i1", "succeeded", 0.02),
                cell("c2", "rm-cheap", "i2", "succeeded", 0.02),
                cell("c3", "rm-cheap", "i3", "succeeded", 0.02),
            ],
            scoresByCell: {
                c1: labelled(true, true),
                c2: labelled(true, false),
                c3: labelled(false, false),
            },
        })!;
        expect(cheap!.tasks[0]!.classes).toMatchObject([
            {
                label: "true",
                total: 2,
                correct: 1,
                missed: 1,
                confusions: [{ predicted: "false", count: 1 }],
            },
            { label: "false", total: 1, correct: 1, missed: 0 },
        ]);
    });

    it("is absent on runs without benchmark settings", () => {
        expect(
            benchmarkComparisonForRun({
                benchmark: undefined,
                models: runModels,
                cells: [],
                scoresByCell: {},
            }),
        ).toBeUndefined();
    });

    it("compares stored-answer tasks on labeled items in a benchmark-model run", () => {
        const sales = agreementOnly.taskMap.tasks[0]!;
        const [bench, cheap] = benchmarkComparisonForRun({
            benchmark: {
                taskMap: {
                    tasks: [
                        { ...sales, key: "mentions", name: "Mentions" },
                        { ...sales, source: "labels" },
                    ],
                },
            },
            labeledItemIds: ["i1"],
            models: runModels,
            cells: [
                cell("b1", "rm-bench", "i1", "succeeded", 0.1),
                cell("c1", "rm-cheap", "i1", "succeeded", 0.02),
            ],
            scoresByCell: {
                b1: benchmarkScore(1),
                c1: benchmarkScore(0),
            },
        })!;
        expect(bench).toMatchObject({ isBenchmark: true });
        expect(bench!.tasks).toMatchObject([
            { key: "sales", source: "labels", n: 1, agreement: 1 },
        ]);
        expect(cheap!.tasks).toMatchObject([
            { key: "mentions", source: "model" },
            { key: "sales", source: "labels", n: 1, agreement: 0 },
        ]);
    });

    it("summarizes stored benchmark scores and leaves unfinished cells out", () => {
        const [bench, cheap] = benchmarkComparisonForRun({
            benchmark: agreementOnly,
            models: runModels,
            cells: [
                cell("b1", "rm-bench", "i1", "succeeded", 0.1),
                cell("c1", "rm-cheap", "i1", "succeeded", 0.02),
                cell("b2", "rm-bench", "i2", "succeeded", 0.1),
                cell("c2", "rm-cheap", "i2", "cached", 0.02),
                cell("b3", "rm-bench", "i3", "succeeded", 0.1),
                cell("c3", "rm-cheap", "i3", "running", 0),
            ],
            scoresByCell: {
                c1: benchmarkScore(1),
                c2: benchmarkScore(0),
            },
        })!;
        expect(bench).toMatchObject({ isBenchmark: true, comparableItems: 3 });
        expect(cheap).toMatchObject({
            modelId: "cheap",
            failedItems: 0,
            agreement: 0.5,
            relativeLatency: 1,
        });
        expect(cheap!.relativeCost).toBeCloseTo(0.2);
        expect(cheap!.tasks[0]).toMatchObject({ key: "sales", n: 2 });
    });

    it("totals judge cost from what each cell was charged", () => {
        // c1 was scored again from scratch: its details hold only the latest
        // pass's 0.002, the cell every pass's 0.005 (all judging). c2 has no
        // cell total (older data), so its comparison-only 0.001 is added and
        // the total is labelled mixed.
        const judged = (cost: number): IMatrixCellScore[] => [
            {
                scorerType: "benchmark",
                score: 1,
                rationale: null,
                detailsJson: {
                    tasks: [
                        {
                            key: "sales",
                            method: "agreement",
                            agreement: 1,
                            judgeCostUsd: cost,
                        },
                    ],
                },
            },
        ];
        const [, cheap] = benchmarkComparisonForRun({
            benchmark: agreementOnly,
            models: runModels,
            cells: [
                cell("b1", "rm-bench", "i1", "succeeded", 0.1),
                {
                    ...cell("c1", "rm-cheap", "i1", "succeeded", 0.02),
                    judgeCostUsd: 0.005,
                },
                cell("b2", "rm-bench", "i2", "succeeded", 0.1),
                cell("c2", "rm-cheap", "i2", "succeeded", 0.02),
            ],
            scoresByCell: { c1: judged(0.002), c2: judged(0.001) },
        })!;
        // c1's own total, plus c2's comparison judging: nothing left out.
        expect(cheap!.judgeCostUsd).toBeCloseTo(0.006, 6);
        expect(cheap!.judgeCostCovers).toBe("mixed");
    });
});
