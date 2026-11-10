import { describe, expect, it } from "vitest";
import {
    benchmarkTaskSource,
    benchmarkUsesSource,
    pickClosestReplacement,
    proposeTaskMapFromSchema,
    rubricScoreToAgreement,
    summarizeBenchmarkComparison,
    taskMapNeedsJudge,
    RULE_PATTERN_MAX_LENGTH,
    validateTaskMap,
    valueAtBenchmarkPath,
    type IBenchmarkCellInput,
    type IBenchmarkModelSummary,
    type IBenchmarkTaskSummary,
    type ITaskMap,
} from "./benchmark.js";
import type {
    BenchmarkModelVerdict,
    BenchmarkTaskVerdict,
} from "./benchmarkVerdict.js";

// Synthetic sales-call extraction schema; not client data.
const SCHEMA = {
    type: "object",
    properties: {
        competitorMentions: {
            type: "array",
            items: { type: "string" },
            description: "Competitor brands named in the call.",
        },
        is_sales_call: { type: "boolean" },
        call_type: { type: "string", enum: ["sales", "service", "other"] },
        order_value: { type: ["number", "null"] },
        units: { type: "integer" },
        summary: { type: "string" },
        meta: { type: "object", properties: { region: { type: "string" } } },
    },
};

describe("proposeTaskMapFromSchema", () => {
    it("proposes one task per top-level field with a matcher by type", () => {
        const { tasks } = proposeTaskMapFromSchema(SCHEMA);
        expect(tasks.map((task) => [task.key, task.method])).toEqual([
            ["competitor_mentions", "agreement"],
            ["is_sales_call", "agreement"],
            ["call_type", "agreement"],
            ["order_value", "agreement"],
            ["units", "agreement"],
            ["summary", "head_to_head"],
            ["meta", "head_to_head"],
        ]);
        expect(tasks[0]).toMatchObject({
            name: "Competitor mentions",
            description: "Competitor brands named in the call.",
            fields: [{ path: "$.competitorMentions", matcher: "set_overlap" }],
        });
        expect(tasks[3]).toMatchObject({
            fields: [
                {
                    path: "$.order_value",
                    matcher: "numeric_tolerance",
                    tolerance: 0.05,
                    relative: true,
                },
            ],
        });
        expect(tasks[2]).toMatchObject({
            fields: [{ path: "$.call_type", matcher: "exact" }],
        });
        expect(validateTaskMap({ tasks }, SCHEMA)).toEqual([]);
    });

    it("returns no tasks for a schema without properties", () => {
        expect(proposeTaskMapFromSchema({ type: "object" })).toEqual({
            tasks: [],
        });
    });
});

describe("validateTaskMap", () => {
    it("rejects out-of-range fuzzy matching and empty aliases", () => {
        const task = (textMatching: object) => ({
            tasks: [
                {
                    key: "brands",
                    name: "Brands",
                    method: "agreement" as const,
                    fields: [
                        { path: "$.brands", matcher: "set_overlap" as const },
                    ],
                    textMatching,
                },
            ],
        });
        expect(
            validateTaskMap(
                task({ fuzzy: 0.85, aliases: { "Parle-G": ["parleji"] } }),
            ),
        ).toEqual([]);
        expect(validateTaskMap(task({ fuzzy: 0 }))).toEqual([
            "Brands: fuzzy matching must be above 0 and at most 1.",
        ]);
        expect(
            validateTaskMap(task({ aliases: { "Parle-G": [" "] } })),
        ).toEqual(["Brands: aliases cannot be empty."]);
    });

    it("reports every problem that makes the map unusable", () => {
        const errors = validateTaskMap(
            {
                tasks: [
                    {
                        key: "Bad Key",
                        name: "Mentions",
                        method: "agreement",
                        fields: [
                            {
                                path: "$.competitorMentions",
                                matcher: "set_overlap",
                            },
                        ],
                    },
                    {
                        key: "dup",
                        name: "Again",
                        method: "agreement",
                        fields: [
                            { path: "$.competitorMentions", matcher: "exact" },
                            {
                                path: "$.order_value",
                                matcher: "numeric_tolerance",
                                tolerance: -1,
                            },
                        ],
                    },
                    { key: "dup", name: "", method: "head_to_head", paths: [] },
                    {
                        key: "missing",
                        name: "Missing",
                        method: "head_to_head",
                        paths: ["$.nope", "$..x"],
                    },
                ],
            },
            SCHEMA,
        );
        expect(errors).toEqual([
            'Mentions: key must be lowercase letters, digits, "_" or "-".',
            'Again: "$.competitorMentions" already belongs to another task.',
            'Again: tolerance for "$.order_value" must be zero or more.',
            'dup: key "dup" is used twice.',
            'Task "dup" needs a name.',
            "dup: choose at least one output field.",
            'Missing: "$.nope" is not in the output schema.',
            'Missing: "$..x" is not a valid field path.',
        ]);
    });

    it("requires at least one task and accepts nested schema paths", () => {
        expect(validateTaskMap({ tasks: [] })).toEqual([
            "Add at least one task.",
        ]);
        expect(
            validateTaskMap(
                {
                    tasks: [
                        {
                            key: "region",
                            name: "Region",
                            method: "head_to_head",
                            paths: ["$.meta.region"],
                        },
                    ],
                },
                SCHEMA,
            ),
        ).toEqual([]);
    });
});

describe("valueAtBenchmarkPath", () => {
    it("reads nested and bare paths", () => {
        const output = { a: { b: [1, 2] }, c: "x" };
        expect(valueAtBenchmarkPath(output, "$.a.b")).toEqual([1, 2]);
        expect(valueAtBenchmarkPath(output, "c")).toBe("x");
        expect(valueAtBenchmarkPath(output, "$.c.d")).toBeUndefined();
        expect(valueAtBenchmarkPath(output, "$.")).toBeUndefined();
    });
});

describe("summarizeBenchmarkComparison", () => {
    const taskMap: ITaskMap = {
        tasks: [
            {
                key: "mentions",
                name: "Mentions",
                method: "agreement",
                fields: [{ path: "$.mentions", matcher: "set_overlap" }],
                judgeDisagreements: true,
            },
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
        ],
    };
    const models = [
        { id: "rm-bench", modelId: "sonnet", isBenchmark: true },
        { id: "rm-cand", modelId: "cheap", isBenchmark: false },
    ];
    const bench = (
        item: string,
        cost: number | null,
        ok = true,
    ): IBenchmarkCellInput => ({
        runModelId: "rm-bench",
        datasetItemId: item,
        succeeded: ok,
        costUsd: cost,
        latencyMs: 1000,
    });

    it("scores per task, counts failures as losses, and skips items the benchmark failed", () => {
        const cells: IBenchmarkCellInput[] = [
            bench("i1", 0.04),
            bench("i2", 0.04),
            bench("i3", 0.02),
            bench("i4", 0.04, false),
            {
                runModelId: "rm-cand",
                datasetItemId: "i1",
                succeeded: true,
                costUsd: 0.01,
                latencyMs: 500,
                details: {
                    tasks: [
                        {
                            key: "mentions",
                            method: "agreement",
                            agreement: 1,
                            verdict: "tie",
                        },
                        {
                            key: "summary",
                            method: "head_to_head",
                            verdict: "win",
                        },
                    ],
                },
            },
            {
                runModelId: "rm-cand",
                datasetItemId: "i2",
                succeeded: true,
                costUsd: 0.01,
                latencyMs: 700,
                details: {
                    tasks: [
                        {
                            key: "mentions",
                            method: "agreement",
                            agreement: 0.5,
                            verdict: "loss",
                        },
                        {
                            key: "summary",
                            method: "head_to_head",
                            error: "judge timed out",
                        },
                    ],
                },
            },
            {
                runModelId: "rm-cand",
                datasetItemId: "i3",
                succeeded: false,
                costUsd: null,
                latencyMs: null,
            },
            // The benchmark failed i4, so this result is ignored.
            {
                runModelId: "rm-cand",
                datasetItemId: "i4",
                succeeded: true,
                costUsd: 0.01,
                latencyMs: 500,
                details: {
                    tasks: [
                        {
                            key: "summary",
                            method: "head_to_head",
                            verdict: "win",
                        },
                    ],
                },
            },
        ];

        const [benchmark, candidate] = summarizeBenchmarkComparison({
            taskMap,
            models,
            cells,
        });

        expect(benchmark).toMatchObject({
            isBenchmark: true,
            comparableItems: 3,
            relativeCost: 1,
            relativeLatency: 1,
        });
        expect(candidate).toMatchObject({
            modelId: "cheap",
            comparableItems: 3,
            failedItems: 1,
            agreement: 0.5,
            relativeCost: 0.25,
            relativeLatency: 0.6,
        });
        expect(candidate!.tasks).toMatchObject([
            {
                key: "mentions",
                name: "Mentions",
                method: "agreement",
                n: 3,
                agreement: 0.5,
                wins: 0,
                ties: 1,
                losses: 2,
                errors: 0,
                winOrTieRate: 1 / 3,
            },
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                n: 3,
                wins: 1,
                ties: 0,
                losses: 1,
                errors: 1,
                winOrTieRate: 0.5,
            },
        ]);
        expect(candidate!.winOrTieRate).toBe(2 / 5);
        // Three items is too few to draw a verdict on either task.
        expect(candidate!.tasks.map((task) => task.assessment)).toMatchObject([
            { metric: "winOrTieRate", verdict: "insufficient" },
            { metric: "winOrTieRate", verdict: "insufficient" },
        ]);
        expect(candidate!.assessment?.verdict).toBe("inconclusive");
        expect(benchmark!.assessment).toBeUndefined();
    });

    it("adds up what judging each model's answers cost", () => {
        const judgedCell = (
            item: string,
            costs: Array<number | undefined>,
        ): IBenchmarkCellInput => ({
            runModelId: "rm-cand",
            datasetItemId: item,
            succeeded: true,
            costUsd: 0.01,
            latencyMs: 10,
            details: {
                tasks: costs.map((judgeCostUsd) => ({
                    key: "summary",
                    method: "head_to_head",
                    verdict: "tie",
                    ...(judgeCostUsd !== undefined ? { judgeCostUsd } : {}),
                })),
            },
        });
        const [benchmark, candidate] = summarizeBenchmarkComparison({
            taskMap,
            models,
            cells: [
                bench("i1", 0.04),
                bench("i2", 0.04),
                judgedCell("i1", [0.002, undefined]),
                judgedCell("i2", [0.003]),
            ],
        });
        expect(candidate!.judgeCostUsd).toBeCloseTo(0.005);
        expect(candidate!.judgeCostCovers).toBe("comparison");
        expect(benchmark!.judgeCostUsd).toBeUndefined();
        // A cell scored again from scratch keeps what earlier passes paid:
        // the cell's own total (all judging) wins over its latest details.
        const [, rescored] = summarizeBenchmarkComparison({
            taskMap,
            models,
            cells: [
                bench("i1", 0.04),
                bench("i2", 0.04),
                { ...judgedCell("i1", [0.002]), judgeCostUsd: 0.007 },
                { ...judgedCell("i2", [0.003]), judgeCostUsd: 0.004 },
            ],
        });
        expect(rescored!.judgeCostUsd).toBeCloseTo(0.011, 6);
        expect(rescored!.judgeCostCovers).toBe("all");
        // A cell without a total still adds its comparison costs, and the
        // label says the total is mixed.
        const [, mixed] = summarizeBenchmarkComparison({
            taskMap,
            models,
            cells: [
                bench("i1", 0.04),
                bench("i2", 0.04),
                { ...judgedCell("i1", [0.002]), judgeCostUsd: 0.007 },
                judgedCell("i2", [0.003, undefined]),
            ],
        });
        expect(mixed!.judgeCostUsd).toBeCloseTo(0.01, 6);
        expect(mixed!.judgeCostCovers).toBe("mixed");
        // A cell with no cost at all doesn't make the label mixed.
        const [, quiet] = summarizeBenchmarkComparison({
            taskMap,
            models,
            cells: [
                bench("i1", 0.04),
                bench("i2", 0.04),
                { ...judgedCell("i1", [0.002]), judgeCostUsd: 0.007 },
                judgedCell("i2", [undefined]),
            ],
        });
        expect(quiet!.judgeCostUsd).toBeCloseTo(0.007, 6);
        expect(quiet!.judgeCostCovers).toBe("all");
    });

    it("leaves ratios undefined when the benchmark has no cost", () => {
        const [, candidate] = summarizeBenchmarkComparison({
            taskMap,
            models,
            cells: [
                bench("i1", null),
                {
                    runModelId: "rm-cand",
                    datasetItemId: "i1",
                    succeeded: true,
                    costUsd: 0.01,
                    latencyMs: 10,
                },
            ],
        });
        expect(candidate!.relativeCost).toBeUndefined();
        expect(candidate!.relativeLatency).toBe(0.01);
    });

    it("uses stored answers as the benchmark when given labeled items", () => {
        const summaries = summarizeBenchmarkComparison({
            taskMap,
            models,
            labeledItemIds: ["i1", "i2"],
            cells: [
                {
                    runModelId: "rm-bench",
                    datasetItemId: "i1",
                    succeeded: true,
                    costUsd: 0.04,
                    latencyMs: 100,
                    details: {
                        tasks: [
                            {
                                key: "mentions",
                                method: "agreement",
                                agreement: 1,
                            },
                        ],
                    },
                },
                {
                    runModelId: "rm-cand",
                    datasetItemId: "i1",
                    succeeded: true,
                    costUsd: 0.01,
                    latencyMs: 60,
                    details: {
                        tasks: [
                            {
                                key: "mentions",
                                method: "agreement",
                                agreement: 0.5,
                            },
                        ],
                    },
                },
                // Not labeled, so not comparable.
                {
                    runModelId: "rm-cand",
                    datasetItemId: "i3",
                    succeeded: false,
                    costUsd: null,
                    latencyMs: null,
                },
            ],
        });
        // Every model is a candidate; cost is still compared with the
        // run's reference model.
        expect(summaries.map((s) => [s.modelId, s.isBenchmark])).toEqual([
            ["sonnet", false],
            ["cheap", false],
        ]);
        expect(summaries[0]).toMatchObject({
            comparableItems: 2,
            failedItems: 0,
            relativeCost: 1,
            relativeLatency: 1,
        });
        expect(summaries[1]!.relativeCost).toBeCloseTo(0.25);
        expect(summaries[1]!.relativeLatency).toBeCloseTo(0.6);
        expect(summaries[0]!.tasks[0]).toMatchObject({ n: 1, agreement: 1 });
        expect(summaries[1]!.tasks[0]).toMatchObject({ n: 1, agreement: 0.5 });
    });

    it("applies the cost limit on stored answers, but not to the reference model", () => {
        const cell = (runModelId: string, itemId: string, costUsd: number) => ({
            runModelId,
            datasetItemId: itemId,
            succeeded: true,
            costUsd,
            latencyMs: 10,
            details: {
                tasks: [
                    {
                        key: "mentions",
                        method: "agreement" as const,
                        agreement: 1,
                    },
                ],
            },
        });
        const ids = ["i1", "i2", "i3", "i4", "i5"];
        const [reference, candidate] = summarizeBenchmarkComparison({
            taskMap,
            models,
            labeledItemIds: ids,
            policy: { maxRelativeCost: 0.5 },
            cells: [
                ...ids.map((id) => cell("rm-bench", id, 0.04)),
                ...ids.map((id) => cell("rm-cand", id, 0.03)),
            ],
        });
        // The reference is shown, never judged: no verdict to hold it to.
        expect(reference).toMatchObject({ isReference: true });
        expect(reference!.assessment).toBeUndefined();
        expect(reference!.tasks[0]!.assessment.verdict).toBe("reference");
        expect(candidate!.isReference).toBeUndefined();
        expect(candidate!.relativeCost).toBeCloseTo(0.75);
        expect(candidate!.assessment).toMatchObject({ verdict: "fail" });
        expect(candidate!.assessment!.reasons[0]).toMatch(
            /above the 50% limit/,
        );
    });

    it("compares each task with its own yardstick in one run", () => {
        // Sales label checked against hand-checked stored answers; mentions
        // against the benchmark model's fresh answers.
        const mixed: ITaskMap = {
            tasks: [
                {
                    key: "mentions",
                    name: "Mentions",
                    method: "agreement",
                    fields: [{ path: "$.mentions", matcher: "set_overlap" }],
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
        const agreed = (
            runModelId: string,
            item: string,
            results: Record<string, number>,
            cost = 0.01,
        ): IBenchmarkCellInput => ({
            runModelId,
            datasetItemId: item,
            succeeded: true,
            costUsd: cost,
            latencyMs: 100,
            details: {
                tasks: Object.entries(results).map(([key, agreement]) => ({
                    key,
                    method: "agreement",
                    agreement,
                })),
            },
        });
        const [benchmark, candidate] = summarizeBenchmarkComparison({
            taskMap: mixed,
            models,
            source: "model",
            // i3 has a stored answer but the benchmark failed it.
            labeledItemIds: ["i1", "i3"],
            cells: [
                agreed("rm-bench", "i1", { sales: 1 }, 0.04),
                agreed("rm-bench", "i2", {}, 0.04),
                bench("i3", 0.04, false),
                agreed("rm-cand", "i1", { mentions: 0.5, sales: 1 }),
                agreed("rm-cand", "i2", { mentions: 1 }),
                agreed("rm-cand", "i3", { sales: 0 }),
            ],
        });

        // The benchmark stays the yardstick and is scored only on the
        // stored-answer task, where its failure on i3 counts as zero.
        expect(benchmark).toMatchObject({
            isBenchmark: true,
            comparableItems: 2,
            failedItems: 1,
            relativeCost: 1,
        });
        // Its own agreement covers only those tasks.
        expect(benchmark!.agreement).toBe(0.5);
        expect(benchmark!.winOrTieRate).toBeUndefined();
        expect(benchmark!.tasks).toMatchObject([
            { key: "sales", source: "labels", n: 2, agreement: 0.5 },
        ]);
        // Shown with a neutral status, not judged against the minimums.
        expect(benchmark!.isReference).toBe(true);
        expect(benchmark!.assessment).toBeUndefined();
        expect(benchmark!.tasks[0]!.assessment.verdict).toBe("reference");

        expect(candidate).toMatchObject({
            isBenchmark: false,
            comparableItems: 3,
            failedItems: 0,
            agreement: 0.625,
        });
        expect(candidate!.tasks).toMatchObject([
            { key: "mentions", source: "model", n: 2, agreement: 0.75 },
            { key: "sales", source: "labels", n: 2, agreement: 0.5 },
        ]);
        // Cost pairs only with items the benchmark answered.
        expect(candidate!.relativeCost).toBeCloseTo(0.25);
    });

    it("judges stored-answer tasks against the reference model when a drop is allowed", () => {
        const sales: ITaskMap = {
            tasks: [
                {
                    key: "sales",
                    name: "Sales call",
                    method: "agreement",
                    fields: [{ path: "$.is_sales", matcher: "exact" }],
                },
            ],
        };
        const items = Array.from({ length: 40 }, (_, index) => `i${index}`);
        const scored = (
            runModelId: string,
            score: (index: number) => number,
        ): IBenchmarkCellInput[] =>
            items.map((item, index) => ({
                runModelId,
                datasetItemId: item,
                succeeded: true,
                costUsd: 0.01,
                latencyMs: 100,
                details: {
                    tasks: [
                        {
                            key: "sales",
                            method: "agreement",
                            agreement: score(index),
                        },
                    ],
                },
            }));
        const three = [
            { id: "rm-bench", modelId: "sonnet", isBenchmark: true },
            { id: "rm-same", modelId: "same", isBenchmark: false },
            { id: "rm-worse", modelId: "worse", isBenchmark: false },
        ];
        // Sonnet misses 4 of 40 (90%). "same" misses the same 4; "worse"
        // also misses 8 that Sonnet got right (70%).
        const summaries = summarizeBenchmarkComparison({
            taskMap: sales,
            models: three,
            source: "labels",
            labeledItemIds: items,
            policy: { maxDropBelowReference: 0.02 },
            cells: [
                ...scored("rm-bench", (i) => (i < 4 ? 0 : 1)),
                ...scored("rm-same", (i) => (i < 4 ? 0 : 1)),
                ...scored("rm-worse", (i) => (i < 12 ? 0 : 1)),
            ],
        });
        const same = summaries.find((row) => row.modelId === "same")!;
        const worse = summaries.find((row) => row.modelId === "worse")!;
        // Matching the reference on 40 items still cannot rule out a
        // 2-point drop on unseen items, so it is not a pass yet.
        expect(same.tasks[0]!.assessment).toMatchObject({
            verdict: "uncertain",
            reference: { value: 0.9, difference: 0, items: 40, maxDrop: 0.02 },
        });
        expect(same.tasks[0]!.assessment.reference!.interval!.low).toBeLessThan(
            -0.02,
        );
        expect(same.tasks[0]!.assessment.threshold).toBeCloseTo(0.88);
        expect(worse.tasks[0]!.assessment.verdict).toBe("fail");
        expect(worse.tasks[0]!.assessment.reference!.difference).toBeCloseTo(
            -0.2,
        );
        expect(worse.assessment!.reasons[0]).toMatch(
            /Sales call: -20.0 points against the reference's 90%/,
        );
        // Without an allowed drop, the fixed 90% target applies as before.
        const fixed = summarizeBenchmarkComparison({
            taskMap: sales,
            models: three,
            source: "labels",
            labeledItemIds: items,
            cells: scored("rm-same", (i) => (i < 4 ? 0 : 1)).concat(
                scored("rm-bench", () => 1),
            ),
        }).find((row) => row.modelId === "same")!;
        expect(fixed.tasks[0]!.assessment.reference).toBeUndefined();
        expect(fixed.tasks[0]!.assessment.threshold).toBe(0.9);
    });

    it("counts the reference's failed answers as 0 in the paired comparison, as in its own row", () => {
        const sales: ITaskMap = {
            tasks: [
                {
                    key: "sales",
                    name: "Sales call",
                    method: "agreement",
                    fields: [{ path: "$.is_sales", matcher: "exact" }],
                },
            ],
        };
        const items = Array.from({ length: 10 }, (_, index) => `i${index}`);
        const cell = (
            runModelId: string,
            item: string,
            succeeded: boolean,
        ): IBenchmarkCellInput => ({
            runModelId,
            datasetItemId: item,
            succeeded,
            costUsd: 0.01,
            latencyMs: 100,
            ...(succeeded
                ? {
                      details: {
                          tasks: [
                              {
                                  key: "sales",
                                  method: "agreement" as const,
                                  agreement: 1,
                              },
                          ],
                      },
                  }
                : {}),
        });
        const summaries = summarizeBenchmarkComparison({
            taskMap: sales,
            models: [
                { id: "rm-bench", modelId: "sonnet", isBenchmark: true },
                { id: "rm-cand", modelId: "cheap", isBenchmark: false },
            ],
            source: "labels",
            labeledItemIds: items,
            policy: { maxDropBelowReference: 0.02 },
            cells: items.flatMap((item, index) => [
                // The reference failed on the first two items.
                cell("rm-bench", item, index >= 2),
                cell("rm-cand", item, true),
            ]),
        });
        const reference = summaries.find((row) => row.isReference)!;
        const candidate = summaries.find((row) => !row.isReference)!;
        expect(reference.tasks[0]!.agreement).toBeCloseTo(0.8);
        expect(candidate.assessment!.reasons[0]).toMatch(
            /reference's 80% \(allowed drop 2 points, failed answers count as 0,/,
        );
        expect(candidate.tasks[0]!.assessment.reference).toMatchObject({
            items: 10,
            difference: 0.2,
        });
        expect(candidate.tasks[0]!.assessment.reference!.value).toBeCloseTo(
            0.8,
        );
    });

    it("keeps a benchmark row without stored-answer tasks unchanged", () => {
        const [benchmark] = summarizeBenchmarkComparison({
            taskMap,
            models,
            source: "model",
            labeledItemIds: ["i1"],
            cells: [bench("i1", 0.04)],
        });
        expect(benchmark).toEqual({
            runModelId: "rm-bench",
            modelId: "sonnet",
            isBenchmark: true,
            isReference: true,
            comparableItems: 1,
            failedItems: 0,
            tasks: [],
            relativeCost: 1,
            relativeLatency: 1,
        });
    });

    it("needs a benchmark model only when a task uses it", () => {
        const labelsOnly: ITaskMap = {
            tasks: taskMap.tasks.map((task) => ({
                ...task,
                source: "labels" as const,
            })),
        };
        const summaries = summarizeBenchmarkComparison({
            taskMap: labelsOnly,
            models: [{ id: "a", modelId: "a", isBenchmark: false }],
            source: "model",
            labeledItemIds: ["i1"],
            cells: [],
        });
        expect(summaries).toMatchObject([
            { modelId: "a", isBenchmark: false, comparableItems: 1 },
        ]);
    });

    it("returns nothing without a benchmark model", () => {
        expect(
            summarizeBenchmarkComparison({
                taskMap,
                models: [{ id: "a", modelId: "a", isBenchmark: false }],
                cells: [],
            }),
        ).toEqual([]);
    });
});

describe("benchmarkTaskSource", () => {
    const task = { source: undefined };

    it("uses the task's own source, then the run's, then the model", () => {
        expect(benchmarkTaskSource({ source: "labels" }, undefined)).toBe(
            "labels",
        );
        expect(
            benchmarkTaskSource({ source: "model" }, { source: "labels" }),
        ).toBe("model");
        expect(benchmarkTaskSource(task, { source: "labels" })).toBe("labels");
        expect(benchmarkTaskSource(task, {})).toBe("model");
    });

    it("says whether any task uses a source, falling back to the run's", () => {
        const sales = {
            key: "sales",
            name: "Sales",
            method: "agreement" as const,
            fields: [{ path: "$.is_sales", matcher: "exact" as const }],
        };
        const mixed = {
            taskMap: {
                tasks: [
                    sales,
                    { ...sales, key: "b", source: "labels" as const },
                ],
            },
        };
        expect(benchmarkUsesSource(mixed, "model")).toBe(true);
        expect(benchmarkUsesSource(mixed, "labels")).toBe(true);
        expect(
            benchmarkUsesSource({ ...mixed, source: "labels" }, "model"),
        ).toBe(false);
        const empty = { taskMap: { tasks: [] } };
        expect(benchmarkUsesSource(empty, "model")).toBe(true);
        expect(
            benchmarkUsesSource({ ...empty, source: "labels" }, "labels"),
        ).toBe(true);
    });
});

describe("pickClosestReplacement", () => {
    const task = (verdict: BenchmarkTaskVerdict): IBenchmarkTaskSummary => ({
        key: verdict,
        name: verdict,
        method: "agreement",
        n: 20,
        wins: 0,
        ties: 0,
        losses: 0,
        errors: 0,
        assessment: {
            metric: "agreement",
            threshold: 0.9,
            sampleSize: "sufficient",
            verdict,
        },
    });
    const summary = (
        id: string,
        verdict: BenchmarkModelVerdict | undefined,
        extra: Partial<IBenchmarkModelSummary> = {},
    ): IBenchmarkModelSummary => ({
        runModelId: id,
        modelId: id,
        isBenchmark: false,
        comparableItems: 20,
        failedItems: 0,
        tasks: [],
        ...(verdict ? { assessment: { verdict, reasons: [] } } : {}),
        ...extra,
    });

    it("prefers the best verdict over a cheaper model", () => {
        const picked = pickClosestReplacement([
            summary("cheap-fail", "fail", { relativeCost: 0.01 }),
            summary("pricier-unsure", "conditional", { relativeCost: 0.05 }),
        ]);
        expect(picked?.runModelId).toBe("pricier-unsure");
    });

    it("breaks ties by fewer tasks below target, then by cost", () => {
        const picked = pickClosestReplacement([
            summary("two-fails", "fail", {
                relativeCost: 0.01,
                tasks: [task("fail"), task("fail")],
            }),
            summary("one-fail-dear", "fail", {
                relativeCost: 0.2,
                tasks: [task("fail"), task("pass")],
            }),
            summary("one-fail-cheap", "fail", {
                relativeCost: 0.1,
                tasks: [task("fail"), task("uncertain")],
            }),
        ]);
        expect(picked?.runModelId).toBe("one-fail-cheap");
    });

    it("never picks the reference model or the benchmark row", () => {
        const models = [
            summary("bench", undefined, { isBenchmark: true }),
            summary("reference", "pass", { relativeCost: 1 }),
            summary("candidate", "fail", { relativeCost: 0.1 }),
        ];
        expect(pickClosestReplacement(models, "reference")?.runModelId).toBe(
            "candidate",
        );
        expect(pickClosestReplacement([models[0]!])).toBeUndefined();
    });
});

describe("rule-check tasks", () => {
    const rules: ITaskMap = {
        tasks: [
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
            {
                key: "checks",
                name: "Rule checks",
                method: "rules",
                rules: [
                    {
                        key: "labels",
                        name: "No speaker labels",
                        kind: "pattern_absent",
                        paths: ["$.summary"],
                        patterns: ["speaker \\d"],
                    },
                ],
            },
        ],
    };

    it("validates checks and lets them share fields with other tasks", () => {
        expect(validateTaskMap(rules, SCHEMA)).toEqual([]);
        const broken: ITaskMap = {
            tasks: [
                {
                    key: "checks",
                    name: "Checks",
                    method: "rules",
                    rules: [
                        {
                            key: "a",
                            name: "A",
                            kind: "pattern_absent",
                            paths: ["$.summary"],
                            patterns: ["("],
                        },
                        {
                            key: "a",
                            name: "B",
                            kind: "in_list",
                            paths: [],
                            allowed: [],
                        },
                    ],
                },
            ],
        };
        const errors = validateTaskMap(broken, SCHEMA);
        expect(errors).toContain('Checks / A: "(" is not a valid pattern.');
        expect(errors).toContain('Checks: check key "a" is used twice.');
        expect(errors).toContain(
            "Checks / B: choose at least one output field.",
        );
        expect(errors).toContain("Checks / B: add at least one allowed value.");
    });

    it("refuses empty, empty-matching, overlong, lookaround and backreference patterns", () => {
        const errorsFor = (patterns: string[]) =>
            validateTaskMap(
                {
                    tasks: [
                        {
                            key: "checks",
                            name: "Checks",
                            method: "rules",
                            rules: [
                                {
                                    key: "a",
                                    name: "A",
                                    kind: "pattern_absent",
                                    paths: ["$.summary"],
                                    patterns,
                                },
                            ],
                        },
                    ],
                },
                SCHEMA,
            );
        expect(errorsFor(["speaker", ""])).toEqual([
            "Checks / A: a pattern is empty.",
        ]);
        expect(errorsFor(["x*"])).toEqual([
            'Checks / A: "x*" matches empty text, so every answer would break it.',
        ]);
        expect(errorsFor(["a".repeat(RULE_PATTERN_MAX_LENGTH + 1)])[0]).toMatch(
            /longer than 200 characters/,
        );
        for (const unsupported of [
            "(?=x)a",
            "a(?!b)",
            "(?<=x)a",
            "(?<!x)a",
            "(a)\\1",
            "(?<word>a)\\k<word>",
        ])
            expect(errorsFor([unsupported])[0]).toMatch(
                /uses a (lookahead or lookbehind|backreference), which rule checks can't run/,
            );
        // Repeats are fine now: the worker runs patterns in linear time.
        for (const fine of [
            "(speaker)?\\d+",
            "\\bspeaker[ _]?\\d+\\b",
            "(a+)+",
            "(a|aa)+",
            "\\w*\\w*\\w*\\w*!",
            ".*.*.*.*x",
            "\\d+(?:\\.\\d+)?%",
            "(https?://)?www\\.",
            "(?:\\d{1,3},)*\\d{3}",
            "[(?=]x",
            "\\(?=x\\)",
            "\\\\1",
            "\\p{L}{2}(\\d{2})+",
        ])
            expect(errorsFor([fine])).toEqual([]);
    });

    it("needs no yardstick of its own", () => {
        const onlyRules = { taskMap: { tasks: [rules.tasks[1]!] } };
        expect(benchmarkUsesSource(onlyRules, "model")).toBe(true);
        expect(
            benchmarkUsesSource({ ...onlyRules, source: "labels" }, "model"),
        ).toBe(false);
        expect(
            benchmarkUsesSource({ source: "labels", taskMap: rules }, "labels"),
        ).toBe(true);
    });

    it("scores today's model too and compares candidates with it item by item", () => {
        const checks = (passed: boolean) => ({
            tasks: [
                {
                    key: "checks",
                    method: "rules" as const,
                    agreement: passed ? 1 : 0,
                },
            ],
        });
        const cell = (
            runModelId: string,
            item: string,
            passed: boolean,
        ): IBenchmarkCellInput => ({
            runModelId,
            datasetItemId: item,
            succeeded: true,
            costUsd: 0.01,
            latencyMs: 100,
            details: checks(passed),
        });
        const summary = summarizeBenchmarkComparison({
            models: [
                { id: "ref", modelId: "sonnet", isBenchmark: true },
                { id: "cand", modelId: "cheap", isBenchmark: false },
            ],
            taskMap: { tasks: [rules.tasks[1]!] },
            policy: { maxDropBelowReference: 0.02 },
            cells: [
                cell("ref", "i1", true),
                cell("ref", "i2", false),
                cell("cand", "i1", true),
                cell("cand", "i2", true),
            ],
        });
        const reference = summary.find((m) => m.isBenchmark)!;
        const candidate = summary.find((m) => !m.isBenchmark)!;
        expect(reference.tasks[0]!.agreement).toBe(0.5);
        expect(candidate.tasks[0]!.agreement).toBe(1);
        expect(candidate.tasks[0]!.source).toBeUndefined();
        expect(candidate.tasks[0]!.assessment.reference).toBeDefined();
    });
});

describe("rubric tasks", () => {
    const rubric: ITaskMap = {
        tasks: [
            {
                key: "summary",
                name: "Summary",
                method: "head_to_head",
                paths: ["$.summary"],
            },
            {
                key: "quality",
                name: "Quality",
                method: "rubric",
                paths: ["$.summary"],
                criteria: [
                    { key: "grounded", name: "Grounded" },
                    { key: "numbers", name: "Numbers right" },
                ],
            },
        ],
    };

    it("validates criteria, shares fields and needs a judge", () => {
        expect(validateTaskMap(rubric, SCHEMA)).toEqual([]);
        expect(taskMapNeedsJudge({ tasks: [rubric.tasks[1]!] })).toBe(true);
        const errors = validateTaskMap(
            {
                tasks: [
                    {
                        key: "quality",
                        name: "Quality",
                        method: "rubric",
                        paths: ["$.summary"],
                        criteria: [
                            { key: "a", name: "A" },
                            { key: "a", name: "" },
                            { key: "Bad key", name: "C" },
                        ],
                    },
                    {
                        key: "empty",
                        name: "Empty",
                        method: "rubric",
                        paths: [],
                        criteria: [],
                    },
                ],
            },
            SCHEMA,
        );
        expect(errors).toContain('Quality: criterion key "a" is used twice.');
        expect(errors).toContain(
            'Quality / C: key must be lowercase letters, digits, "_" or "-".',
        );
        expect(errors).toContain("Empty: add at least one criterion.");
        expect(errors).toContain("Empty: choose at least one output field.");
    });

    it("maps 1 to 0 and 5 to 1", () => {
        expect(rubricScoreToAgreement(1)).toBe(0);
        expect(rubricScoreToAgreement(3)).toBe(0.5);
        expect(rubricScoreToAgreement(5)).toBe(1);
    });

    it("needs no yardstick of its own", () => {
        const onlyRubric = { taskMap: { tasks: [rubric.tasks[1]!] } };
        expect(
            benchmarkUsesSource({ ...onlyRubric, source: "labels" }, "model"),
        ).toBe(false);
    });

    it("compares each criterion with today's model on the same transcripts", () => {
        const cell = (
            runModelId: string,
            item: string,
            grounded: number,
            numbers: number,
            succeeded = true,
        ): IBenchmarkCellInput => ({
            runModelId,
            datasetItemId: item,
            succeeded,
            costUsd: 0.01,
            latencyMs: 100,
            details: succeeded
                ? {
                      tasks: [
                          {
                              key: "quality",
                              method: "rubric",
                              agreement:
                                  (rubricScoreToAgreement(grounded) +
                                      rubricScoreToAgreement(numbers)) /
                                  2,
                              criteria: [
                                  { key: "grounded", score: grounded },
                                  { key: "numbers", score: numbers },
                              ],
                          },
                      ],
                  }
                : undefined,
        });
        const summary = summarizeBenchmarkComparison({
            models: [
                { id: "ref", modelId: "sonnet", isBenchmark: true },
                { id: "cand", modelId: "cheap", isBenchmark: false },
            ],
            taskMap: { tasks: [rubric.tasks[1]!] },
            policy: { maxDropBelowReference: 0.05 },
            cells: [
                cell("ref", "i1", 5, 4),
                cell("ref", "i2", 4, 4),
                cell("ref", "i3", 5, 5),
                cell("cand", "i1", 4, 4),
                cell("cand", "i2", 4, 2),
                // The candidate failed i3: a zero for the task, no criteria.
                cell("cand", "i3", 0, 0, false),
            ],
        });
        const reference = summary.find((m) => m.isBenchmark)!;
        const candidate = summary.find((m) => !m.isBenchmark)!;
        expect(reference.tasks[0]!.criteria?.[0]).toMatchObject({
            key: "grounded",
            n: 3,
        });
        expect(reference.tasks[0]!.criteria?.[0]!.mean).toBeCloseTo(14 / 3);
        expect(
            reference.tasks[0]!.criteria?.[0]!.referenceMean,
        ).toBeUndefined();
        const [grounded, numbers] = candidate.tasks[0]!.criteria!;
        expect(grounded).toMatchObject({
            n: 2,
            mean: 4,
            referenceMean: 4.5,
            difference: -0.5,
            pairs: 2,
        });
        expect(numbers).toMatchObject({
            mean: 3,
            referenceMean: 4,
            difference: -1,
        });
        expect(candidate.tasks[0]!.source).toBeUndefined();
        expect(candidate.tasks[0]!.n).toBe(3);
        expect(candidate.tasks[0]!.assessment.reference).toBeDefined();
    });
});
