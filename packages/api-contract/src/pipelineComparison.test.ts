import { describe, expect, it } from "vitest";
import type { IBenchmarkCellDetails, ITaskMap } from "./benchmark.js";
import {
    combineDataPolicies,
    PIPELINE_COMPARISON_MODEL_ID,
    summarizePipelineComparison,
    type IPipelineAnswerScore,
    type IPipelineComparisonConfig,
    type IPipelineReferenceCell,
} from "./pipelineComparison.js";

// Made-up snack-sales extraction; not client data.
const TASK_MAP: ITaskMap = {
    tasks: [
        {
            key: "products",
            name: "Products",
            method: "agreement",
            fields: [{ path: "$.products", matcher: "set_overlap" }],
        },
    ],
};

const CONFIG: IPipelineComparisonConfig = {
    runId: "run-1",
    benchmark: { source: "model", taskMap: TASK_MAP },
    referenceRunModelId: "rm-ref",
    referenceModelId: "openai/big-model",
};

function agreed(agreement: number): IBenchmarkCellDetails {
    return {
        tasks: [{ key: "products", method: "agreement", agreement }],
    };
}

function answers(count: number, extra: Partial<IPipelineAnswerScore> = {}) {
    return Array.from({ length: count }, (_, index): IPipelineAnswerScore => ({
        datasetItemId: `item-${index}`,
        status: "complete",
        costUsd: 0.001,
        latencyMs: 400,
        scored: true,
        details: agreed(1),
        ...extra,
    }));
}

function referenceCells(count: number): IPipelineReferenceCell[] {
    return Array.from({ length: count }, (_, index) => ({
        datasetItemId: `item-${index}`,
        succeeded: true,
        costUsd: 0.004,
        latencyMs: 1000,
    }));
}

const itemIds = (count: number) =>
    Array.from({ length: count }, (_, index) => `item-${index}`);

describe("combineDataPolicies", () => {
    it("keeps either side alone", () => {
        expect(combineDataPolicies(undefined, undefined)).toBeUndefined();
        expect(
            combineDataPolicies({ onlyHosts: ["vertex"] }, undefined),
        ).toEqual({ onlyHosts: ["vertex"] });
        expect(
            combineDataPolicies(undefined, { zeroDataRetention: true }),
        ).toEqual({ zeroDataRetention: true });
    });

    it("allows only hosts both allow and applies every stricter rule", () => {
        expect(
            combineDataPolicies(
                { onlyHosts: ["vertex", "bedrock"], zeroDataRetention: true },
                {
                    onlyHosts: ["bedrock", "azure"],
                    disallowPromptTraining: true,
                },
            ),
        ).toEqual({
            onlyHosts: ["bedrock"],
            zeroDataRetention: true,
            disallowPromptTraining: true,
        });
    });

    it("takes the one host list when the other side has none", () => {
        expect(
            combineDataPolicies(
                { zeroDataRetention: true },
                { onlyHosts: ["vertex"] },
            ),
        ).toEqual({ onlyHosts: ["vertex"], zeroDataRetention: true });
    });

    it("returns an empty host list when the lists share no host", () => {
        expect(
            combineDataPolicies(
                { onlyHosts: ["vertex"] },
                { onlyHosts: ["azure"] },
            )?.onlyHosts,
        ).toEqual([]);
    });
});

describe("summarizePipelineComparison", () => {
    it("scores the pipeline as one candidate against the reference", () => {
        // 40 items: agreeing on all of 25 would not yet clear 90% at 95%.
        const result = summarizePipelineComparison({
            config: CONFIG,
            pipelineName: "Acme chain",
            evalItemIds: itemIds(40),
            referenceCells: referenceCells(40),
            answers: answers(40),
        });
        const pipeline = result.summary.find(
            (row) => row.runModelId === PIPELINE_COMPARISON_MODEL_ID,
        )!;
        const reference = result.summary.find((row) => row.isBenchmark)!;
        expect(reference).toMatchObject({
            runModelId: "rm-ref",
            modelId: "openai/big-model",
            isReference: true,
        });
        expect(pipeline).toMatchObject({
            modelId: "Acme chain",
            comparableItems: 40,
            failedItems: 0,
            agreement: 1,
            relativeCost: 0.25,
            relativeLatency: 0.4,
        });
        expect(pipeline.assessment?.verdict).toBe("pass");
        expect(result).toMatchObject({
            comparedItems: 40,
            failedItems: 0,
            unscoredItems: 0,
            pipelineLatencyMs: 400,
            referenceLatencyMs: 1000,
        });
        expect(result.pipelineCostPerItem).toBeCloseTo(0.001);
        expect(result.referenceCostPerItem).toBeCloseTo(0.004);
    });

    it("compares only items both runs have, and counts failed answers as failures", () => {
        const result = summarizePipelineComparison({
            config: CONFIG,
            pipelineName: "Acme chain",
            // item-3 is not in the eval run.
            evalItemIds: itemIds(3),
            referenceCells: referenceCells(4),
            answers: [
                ...answers(2),
                {
                    datasetItemId: "item-2",
                    status: "failed",
                    costUsd: 0.0005,
                    scored: false,
                },
                ...answers(4).slice(3),
            ],
        });
        const pipeline = result.summary.find(
            (row) => row.runModelId === PIPELINE_COMPARISON_MODEL_ID,
        )!;
        expect(result.comparedItems).toBe(3);
        expect(result.failedItems).toBe(1);
        expect(pipeline.comparableItems).toBe(3);
        expect(pipeline.failedItems).toBe(1);
        // The failed item counts as zero agreement.
        expect(pipeline.agreement).toBeCloseTo(2 / 3);
    });

    it("averages cost and latency over the same items on both sides, failed ones included", () => {
        const result = summarizePipelineComparison({
            config: CONFIG,
            pipelineName: "Acme chain",
            evalItemIds: itemIds(2),
            referenceCells: [
                {
                    datasetItemId: "item-0",
                    succeeded: true,
                    costUsd: 0.004,
                    latencyMs: 1000,
                },
                {
                    datasetItemId: "item-1",
                    succeeded: false,
                    costUsd: 0.002,
                    latencyMs: 3000,
                },
            ],
            answers: [
                ...answers(1),
                {
                    datasetItemId: "item-1",
                    status: "failed",
                    costUsd: 0.0005,
                    latencyMs: 400,
                    scored: false,
                },
            ],
        });
        expect(result.referenceCostPerItem).toBeCloseTo(0.003);
        expect(result.referenceLatencyMs).toBeCloseTo(2000);
        expect(result.comparedItems).toBe(2);
    });

    it("leaves out answers still waiting to be scored", () => {
        const result = summarizePipelineComparison({
            config: CONFIG,
            pipelineName: "Acme chain",
            evalItemIds: itemIds(3),
            referenceCells: referenceCells(3),
            answers: [
                ...answers(2),
                {
                    datasetItemId: "item-2",
                    status: "complete",
                    scored: false,
                },
            ],
        });
        expect(result.comparedItems).toBe(2);
        expect(result.unscoredItems).toBe(1);
        const pipeline = result.summary.find(
            (row) => row.runModelId === PIPELINE_COMPARISON_MODEL_ID,
        )!;
        expect(pipeline.comparableItems).toBe(2);
    });

    it("scores the reference on stored answers from its stored details", () => {
        const result = summarizePipelineComparison({
            config: {
                ...CONFIG,
                benchmark: { source: "labels", taskMap: TASK_MAP },
            },
            pipelineName: "Acme chain",
            evalItemIds: itemIds(2),
            labeledItemIds: ["item-0", "item-1", "item-9"],
            referenceCells: referenceCells(2).map((cell) => ({
                ...cell,
                details: agreed(0.5),
            })),
            answers: answers(2),
        });
        const reference = result.summary.find(
            (row) => row.runModelId === "rm-ref",
        )!;
        const pipeline = result.summary.find(
            (row) => row.runModelId === PIPELINE_COMPARISON_MODEL_ID,
        )!;
        expect(reference.isReference).toBe(true);
        expect(reference.assessment).toBeUndefined();
        expect(reference.agreement).toBe(0.5);
        expect(pipeline.agreement).toBe(1);
        expect(pipeline.comparableItems).toBe(2);
    });

    it("works without a reference model when every task uses stored answers", () => {
        const result = summarizePipelineComparison({
            config: {
                runId: "run-1",
                benchmark: { source: "labels", taskMap: TASK_MAP },
            },
            pipelineName: "Acme chain",
            evalItemIds: itemIds(2),
            labeledItemIds: itemIds(2),
            referenceCells: [],
            answers: answers(2),
        });
        expect(result.summary).toHaveLength(1);
        expect(result.summary[0]).toMatchObject({
            runModelId: PIPELINE_COMPARISON_MODEL_ID,
            agreement: 1,
        });
        expect(result.referenceRunModelId).toBeUndefined();
    });
});
