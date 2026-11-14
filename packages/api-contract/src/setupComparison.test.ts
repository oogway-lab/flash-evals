import { describe, expect, it } from "vitest";
import type { IRunBenchmarkConfig } from "./benchmark.js";
import {
    markNotBeaten,
    pipelineSetupLabel,
    pipelineStepOrder,
    setupAccuracy,
    setupComparisonStatus,
    summarizeSetupComparison,
} from "./setupComparison.js";

describe("setupComparisonStatus", () => {
    it.each([
        [[], "pending", undefined],
        [["pending", "pending"], "pending", undefined],
        [["completed", "pending"], "running", undefined],
        [["running", "completed"], "running", undefined],
        [["completed", "completed"], "completed", undefined],
        [["completed", "partial"], "partial", undefined],
        [["completed", "failed"], "partial", undefined],
        [["failed", "failed"], "failed", undefined],
    ] as const)("%j is %s", (statuses, status, stopReason) => {
        expect(
            setupComparisonStatus(statuses.map((s) => ({ status: s }))),
        ).toEqual({ status, ...(stopReason ? { stopReason } : {}) });
    });

    it("is cancelled when a member stopped, at the spend limit when one did", () => {
        expect(
            setupComparisonStatus([
                { status: "completed" },
                { status: "cancelled", stopReason: "cancelled" },
            ]),
        ).toEqual({ status: "cancelled", stopReason: "cancelled" });
        expect(
            setupComparisonStatus([
                { status: "cancelled", stopReason: "cancelled" },
                { status: "cancelled", stopReason: "spend_cap" },
            ]),
        ).toEqual({ status: "cancelled", stopReason: "spend_cap" });
    });

    it("stays running while one member still runs, even after another stopped", () => {
        expect(
            setupComparisonStatus([
                { status: "cancelled", stopReason: "spend_cap" },
                { status: "running" },
            ]),
        ).toEqual({ status: "running" });
    });
});

describe("pipelineStepOrder", () => {
    it("orders steps after the steps they read from", () => {
        const nodes = [
            { id: "notes", label: "Notes" },
            { id: "extract", label: "Extract" },
            { id: "points", label: "Points" },
        ];
        const edges = [
            { fromNodeId: "extract", toNodeId: "points" },
            { fromNodeId: "points", toNodeId: "notes" },
        ];
        expect(pipelineStepOrder(nodes, edges).map((n) => n.label)).toEqual([
            "Extract",
            "Points",
            "Notes",
        ]);
    });

    it("keeps nodes in a cycle, last", () => {
        const nodes = [
            { id: "a", label: "A" },
            { id: "b", label: "B" },
            { id: "c", label: "C" },
        ];
        const edges = [
            { fromNodeId: "a", toNodeId: "b" },
            { fromNodeId: "b", toNodeId: "a" },
        ];
        expect(pipelineStepOrder(nodes, edges).map((n) => n.id)).toEqual([
            "c",
            "a",
            "b",
        ]);
    });
});

describe("pipelineSetupLabel", () => {
    it("names a pipeline with its steps' models", () => {
        expect(pipelineSetupLabel("Chain", ["model-a", "model-b"])).toBe(
            "Chain (model-a → model-b)",
        );
        expect(pipelineSetupLabel("Chain", [])).toBe("Chain");
    });
});

// Made-up snack-sales extraction; not client data.
const BENCHMARK: IRunBenchmarkConfig = {
    source: "model",
    taskMap: {
        tasks: [
            {
                key: "products",
                name: "Products",
                method: "agreement",
                fields: [{ path: "$.products", matcher: "set_overlap" }],
            },
        ],
    },
};

const agreed = (agreement: number) => ({
    tasks: [{ key: "products", method: "agreement" as const, agreement }],
});

describe("summarizeSetupComparison", () => {
    const items = ["item-1", "item-2", "item-3"];
    const ranking = summarizeSetupComparison({
        benchmark: BENCHMARK,
        evalRunId: "eval-run-1",
        runModels: [
            { id: "rm-ref", modelId: "openai/big-model", isReference: true },
            {
                id: "rm-small",
                modelId: "openai/small-model",
                isReference: false,
            },
        ],
        cells: [
            ...items.map((datasetItemId) => ({
                runModelId: "rm-ref",
                datasetItemId,
                status: "succeeded",
                costUsd: 0.01,
                latencyMs: 2000,
            })),
            ...items.map((datasetItemId, i) => ({
                runModelId: "rm-small",
                datasetItemId,
                status: i === 2 ? "running" : "succeeded",
                costUsd: i === 2 ? null : 0.001,
                latencyMs: i === 2 ? null : 500,
                ...(i === 2 ? {} : { details: agreed(0.5) }),
            })),
        ],
        pipelines: [
            {
                workflowRunId: "wf-run-1",
                workflowId: "wf-1",
                name: "Three steps",
                stepModels: ["model-a", "model-b", "model-c"],
                itemCount: 3,
                answers: [
                    {
                        datasetItemId: "item-1",
                        status: "complete",
                        scored: true,
                        costUsd: 0.002,
                        latencyMs: 900,
                        details: agreed(1),
                    },
                    {
                        datasetItemId: "item-2",
                        status: "failed",
                        scored: false,
                        costUsd: 0.001,
                    },
                    // Recorded but not scored yet: left out, like a running cell.
                    {
                        datasetItemId: "item-3",
                        status: "complete",
                        scored: false,
                        costUsd: 0.002,
                    },
                ],
            },
        ],
    });
    const row = (id: string) => ranking.rows.find((r) => r.id === id)!;

    it("ranks the reference, single models and pipelines with one summary", () => {
        expect(ranking.referenceRowId).toBe("rm-ref");
        expect(ranking.summary.map((s) => s.runModelId)).toEqual([
            "rm-ref",
            "rm-small",
            "pipeline:wf-run-1",
        ]);
        expect(row("rm-ref")).toMatchObject({
            kind: "reference",
            runId: "eval-run-1",
            scoredItems: 3,
            waitingItems: 0,
            failedItems: 0,
            accuracy: 1,
        });
        expect(row("rm-small")).toMatchObject({
            kind: "model",
            scoredItems: 2,
            waitingItems: 1,
            failedItems: 0,
            costPerCall: 0.001,
            accuracy: 0.5,
        });
        expect(row("pipeline:wf-run-1")).toMatchObject({
            kind: "pipeline",
            name: "Three steps",
            runId: "wf-run-1",
            workflowId: "wf-1",
            stepModels: ["model-a", "model-b", "model-c"],
            scoredItems: 1,
            waitingItems: 1,
            failedItems: 1,
        });
        // The failed answer counts as a miss: (1 + 0) / 2.
        expect(row("pipeline:wf-run-1").accuracy).toBeCloseTo(0.5);
        expect(row("pipeline:wf-run-1").summary?.failedItems).toBe(1);
        expect(
            row("pipeline:wf-run-1").summary?.assessment?.verdict,
        ).toBeDefined();
    });

    it("marks the setups no other setup beats on accuracy and cost", () => {
        // The reference is the most accurate; the small model is the
        // cheapest; the pipeline is as accurate as the small model and
        // costs more, so it is beaten.
        expect(row("rm-ref").notBeaten).toBe(true);
        expect(row("rm-small").notBeaten).toBe(true);
        expect(row("pipeline:wf-run-1").notBeaten).toBe(false);
    });

    it("compares accuracy and cost only on the items every setup has finished", () => {
        // The small model finished items 1 and 2 (agreeing fully on item 1
        // only); the pipeline finished only item 1 so far. Ranked on their
        // own items the pipeline would look twice as accurate.
        const partial = summarizeSetupComparison({
            benchmark: BENCHMARK,
            evalRunId: "eval-run-1",
            runModels: [
                {
                    id: "rm-ref",
                    modelId: "openai/big-model",
                    isReference: true,
                },
                {
                    id: "rm-small",
                    modelId: "openai/small-model",
                    isReference: false,
                },
            ],
            cells: [
                ...items.map((datasetItemId) => ({
                    runModelId: "rm-ref",
                    datasetItemId,
                    status: "succeeded",
                    costUsd: 0.01,
                    latencyMs: 2000,
                })),
                ...items.map((datasetItemId, i) => ({
                    runModelId: "rm-small",
                    datasetItemId,
                    status: i === 2 ? "running" : "succeeded",
                    costUsd: [0.001, 0.009, null][i]!,
                    latencyMs: i === 2 ? null : 500,
                    ...(i === 2 ? {} : { details: agreed(i === 0 ? 1 : 0) }),
                })),
            ],
            pipelines: [
                {
                    workflowRunId: "wf-run-1",
                    workflowId: "wf-1",
                    name: "Three steps",
                    stepModels: ["model-a"],
                    itemCount: 3,
                    answers: [
                        {
                            datasetItemId: "item-1",
                            status: "complete",
                            scored: true,
                            costUsd: 0.002,
                            latencyMs: 900,
                            details: agreed(1),
                        },
                    ],
                },
            ],
        });
        const partialRow = (id: string) =>
            partial.rows.find((r) => r.id === id)!;
        expect(partial.comparedItems).toBe(1);
        expect(partialRow("rm-small")).toMatchObject({
            accuracy: 1,
            costPerCall: 0.001,
            scoredItems: 2,
        });
        expect(partialRow("pipeline:wf-run-1")).toMatchObject({
            accuracy: 1,
            costPerCall: 0.002,
        });
        expect(partialRow("rm-ref").costPerCall).toBeCloseTo(0.01);
        // Counts on the compared item next to the totals.
        expect(partialRow("rm-small")).toMatchObject({
            comparedScoredItems: 1,
            comparedFailedItems: 0,
        });
        // Everyone is still running or has finished all: nothing to note.
        expect(partial.finishedFewer).toBeUndefined();
    });

    it("counts failures on the compared items and names a setup that finished fewer", () => {
        const stopped = summarizeSetupComparison({
            benchmark: BENCHMARK,
            evalRunId: "eval-run-1",
            runModels: [
                {
                    id: "rm-ref",
                    modelId: "openai/big-model",
                    isReference: true,
                },
                {
                    id: "rm-small",
                    modelId: "openai/small-model",
                    isReference: false,
                },
            ],
            cells: [
                ...items.map((datasetItemId) => ({
                    runModelId: "rm-ref",
                    datasetItemId,
                    status: "succeeded",
                    costUsd: 0.01,
                    latencyMs: 2000,
                })),
                // Failed on item 3, which the pipeline never reached.
                ...items.map((datasetItemId, i) => ({
                    runModelId: "rm-small",
                    datasetItemId,
                    status: i === 2 ? "failed" : "succeeded",
                    costUsd: 0.001,
                    latencyMs: 500,
                    ...(i === 2 ? {} : { details: agreed(1) }),
                })),
            ],
            pipelines: [
                {
                    workflowRunId: "wf-run-1",
                    workflowId: "wf-1",
                    name: "Stopped early",
                    stepModels: ["model-a"],
                    // The pipeline run stopped after two items.
                    itemCount: 2,
                    answers: ["item-1", "item-2"].map((datasetItemId) => ({
                        datasetItemId,
                        status: "complete" as const,
                        scored: true,
                        costUsd: 0.002,
                        latencyMs: 900,
                        details: agreed(1),
                    })),
                },
            ],
        });
        const stoppedRow = (id: string) =>
            stopped.rows.find((r) => r.id === id)!;
        expect(stopped.comparedItems).toBe(2);
        expect(stoppedRow("rm-small")).toMatchObject({
            failedItems: 1,
            comparedFailedItems: 0,
            comparedScoredItems: 2,
            accuracy: 1,
        });
        expect(stopped.finishedFewer).toEqual(["pipeline:wf-run-1"]);
    });
});

describe("markNotBeaten", () => {
    it("leaves setups without both numbers unmarked, and keeps ties", () => {
        expect(
            markNotBeaten([
                { accuracy: 0.9, costPerCall: 1 },
                { accuracy: 0.9, costPerCall: 1 },
                { accuracy: 0.8, costPerCall: 1 },
                { costPerCall: 0.1 },
            ]).map((row) => row.notBeaten),
        ).toEqual([true, true, false, false]);
    });
});

describe("setupAccuracy", () => {
    it("is the mean of the task results, the reference at 100% on its own answers", () => {
        const candidate = {
            runModelId: "rm-small",
            modelId: "small",
            isBenchmark: false,
            comparableItems: 3,
            failedItems: 0,
            tasks: [
                {
                    key: "products",
                    assessment: { value: 0.75 },
                },
            ],
        } as never;
        expect(setupAccuracy(candidate, BENCHMARK)).toBe(0.75);
        expect(
            setupAccuracy(
                {
                    runModelId: "rm-ref",
                    modelId: "big",
                    isBenchmark: true,
                    comparableItems: 3,
                    failedItems: 0,
                    tasks: [],
                },
                BENCHMARK,
            ),
        ).toBe(1);
    });
});
