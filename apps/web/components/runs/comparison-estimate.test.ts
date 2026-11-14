import { describe, expect, it } from "vitest";
import type { IRunSetupModelOption } from "@flash-evals/api-contract";
import {
    estimateComparison,
    estimateMinutes,
    fmtMinutes,
    fmtUsd,
} from "./comparison-estimate";

function model(
    id: string,
    input: number,
    output: number,
): IRunSetupModelOption {
    return {
        id,
        label: id,
        family: "x",
        provider: "x",
        providerLabel: "X",
        reasoning: false,
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
        costAvailable: true,
        available: true,
        transports: ["gateway"],
        providers: [
            {
                transport: "gateway",
                modelId: id,
                inputPerMillion: input,
                outputPerMillion: output,
                keySaved: true,
            },
        ],
    };
}

const MODELS = [
    model("sonnet", 2, 10),
    model("luna", 0.1, 0.5),
    model("judge", 1, 5),
];

describe("estimateComparison", () => {
    it("prices every model on every item, plus one judge call per judged task", () => {
        const estimate = estimateComparison({
            items: 100,
            promptChars: 15_000,
            avgInputChars: 15_000,
            maxTokens: 8_000,
            models: [
                { id: "sonnet", transport: "gateway" },
                { id: "luna", transport: "gateway" },
            ],
            referenceModelId: "sonnet",
            availableModels: MODELS,
            taskMap: {
                tasks: [
                    {
                        key: "domain",
                        name: "Domain",
                        method: "agreement",
                        fields: [{ path: "$.domain", matcher: "exact" }],
                    },
                    {
                        key: "notes",
                        name: "Notes",
                        method: "head_to_head",
                        paths: ["$.mom"],
                    },
                ],
            },
            judge: { modelId: "judge", transport: "gateway" },
        });
        // 30,000 characters ≈ 10,000 tokens in; 1,000 out.
        expect(estimate.inputTokens).toBe(10_000);
        expect(estimate.lines[0]!.perCall).toBeCloseTo(0.03);
        expect(estimate.lines[1]!.perCall).toBeCloseTo(0.0015);
        // One judged task × one candidate × 100 items.
        expect(estimate.judge!.calls).toBe(100);
        expect(estimate.total).toBeCloseTo(3 + 0.15 + estimate.judge!.total!);
        expect(estimate.incomplete).toBe(false);
    });

    it("prices a pipeline as every step on every item, and judges it as a candidate", () => {
        const estimate = estimateComparison({
            items: 10,
            promptChars: 15_000,
            avgInputChars: 15_000,
            maxTokens: 8_000,
            models: [{ id: "sonnet", transport: "gateway" }],
            referenceModelId: "sonnet",
            availableModels: MODELS,
            taskMap: {
                tasks: [
                    {
                        key: "notes",
                        name: "Notes",
                        method: "head_to_head",
                        paths: ["$.mom"],
                    },
                ],
            },
            judge: { modelId: "judge", transport: "gateway" },
            pipelines: [
                {
                    id: "chain",
                    label: "Chain",
                    steps: [
                        // A saved route: priced at the model's listed offer.
                        { modelId: "luna", promptChars: 3_000 },
                        {
                            modelId: "luna",
                            transport: "gateway",
                            promptChars: 0,
                        },
                    ],
                },
            ],
        });
        // (3,000 + 15,000) / 3 = 6,000 tokens in, then 5,000; 1,000 out each.
        const perItem =
            (6_000 * 0.1 + 1_000 * 0.5) / 1e6 +
            (5_000 * 0.1 + 1_000 * 0.5) / 1e6;
        expect(estimate.pipelineLines).toEqual([
            {
                modelId: "pipeline:chain",
                label: "Chain",
                perCall: expect.closeTo(perItem, 8),
                total: expect.closeTo(perItem * 10, 8),
            },
        ]);
        // The pipeline is the one candidate the judge compares.
        expect(estimate.judge!.calls).toBe(10);
        expect(estimate.minutes).toBeGreaterThan(0);
    });

    it("prices a Bifrost step saved under Bifrost's own id at that offer's price", () => {
        const glm: IRunSetupModelOption = {
            ...model("z-ai/glm-5.2", 9, 9),
            transports: ["bifrost"],
            providers: [
                {
                    transport: "bifrost",
                    modelId: "openrouter/z-ai/glm-5.2",
                    // Bifrost's list price (the registry gives none).
                    inputPerMillion: 0.6,
                    outputPerMillion: 2.2,
                    keySaved: true,
                },
            ],
        };
        const estimate = estimateComparison({
            items: 1,
            promptChars: 0,
            avgInputChars: 3_000,
            maxTokens: 8_000,
            models: [],
            referenceModelId: "z-ai/glm-5.2",
            availableModels: [glm],
            taskMap: { tasks: [] },
            pipelines: [
                {
                    id: "bifrost",
                    label: "Bifrost",
                    steps: [
                        {
                            modelId: "openrouter/z-ai/glm-5.2",
                            transport: "bifrost",
                        },
                    ],
                },
            ],
        });
        expect(estimate.pipelineLines[0]!.perCall).toBeCloseTo(
            (1_000 * 0.6 + 1_000 * 2.2) / 1e6,
            10,
        );
    });

    it("leaves a pipeline with an unpriced step out of the total and says so", () => {
        const estimate = estimateComparison({
            items: 10,
            promptChars: 1_000,
            avgInputChars: 1_000,
            maxTokens: 8_000,
            models: [{ id: "sonnet", transport: "gateway" }],
            referenceModelId: "sonnet",
            availableModels: MODELS,
            taskMap: { tasks: [] },
            pipelines: [
                {
                    id: "chain",
                    label: "Chain",
                    steps: [{ modelId: "unknown" }],
                },
            ],
        });
        expect(estimate.pipelineLines[0]!.total).toBeUndefined();
        expect(estimate.incomplete).toBe(true);
    });

    it("counts a rubric call for every model, today's included", () => {
        const estimate = estimateComparison({
            items: 10,
            promptChars: 300,
            avgInputChars: 300,
            maxTokens: 1_000,
            models: [
                { id: "sonnet", transport: "gateway" },
                { id: "luna", transport: "gateway" },
            ],
            referenceModelId: "sonnet",
            availableModels: MODELS,
            taskMap: {
                tasks: [
                    {
                        key: "notes",
                        name: "Notes",
                        method: "head_to_head",
                        paths: ["$.mom"],
                    },
                    {
                        key: "quality",
                        name: "Quality",
                        method: "rubric",
                        paths: ["$.mom"],
                        criteria: [{ key: "grounded", name: "Grounded" }],
                    },
                ],
            },
            judge: { modelId: "judge", transport: "gateway" },
        });
        // Head to head: 1 candidate × 10; rubric: 2 models × 10.
        expect(estimate.judge!.calls).toBe(30);
    });

    it("flags a model without a price as a floor", () => {
        const estimate = estimateComparison({
            items: 10,
            promptChars: 300,
            avgInputChars: 300,
            maxTokens: 500,
            models: [{ id: "unknown" }],
            referenceModelId: "unknown",
            availableModels: MODELS,
            taskMap: { tasks: [] },
        });
        expect(estimate.outputTokens).toBe(500);
        expect(estimate.incomplete).toBe(true);
        expect(estimate.total).toBe(0);
    });
});

describe("fmtUsd", () => {
    it("keeps small amounts readable", () => {
        expect(fmtUsd(0.00177)).toBe("$0.0018");
        expect(fmtUsd(1.254)).toBe("$1.25");
        expect(fmtUsd(1234.5)).toBe("$1,235");
        expect(fmtUsd(0)).toBe("$0");
    });
});

describe("estimateMinutes", () => {
    it("runs the eval run and the pipelines side by side, then the judge", () => {
        // Eval: 20 items × 2 models / 5 at once × 8 s = 64 s. Pipeline:
        // 3 steps × 20 / 4 × 8 s = 120 s. Judge: 20 / 5 × 8 s = 32 s.
        expect(
            estimateMinutes({
                items: 20,
                models: 2,
                pipelineSteps: [3],
                judgeCalls: 20,
            }),
        ).toBe(3);
        expect(
            estimateMinutes({
                items: 0,
                models: 2,
                pipelineSteps: [],
                judgeCalls: 0,
            }),
        ).toBe(0);
    });

    it("reads as a rough duration", () => {
        expect(fmtMinutes(1)).toBe("about 1 minute");
        expect(fmtMinutes(25)).toBe("about 25 minutes");
        expect(fmtMinutes(150)).toBe("about 3 hours");
    });
});
