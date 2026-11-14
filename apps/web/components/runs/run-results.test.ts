import { describe, expect, it } from "vitest";
import {
    summarizePipelineComparison,
    type IBenchmarkModelSummary,
    type ILeaderboardRow,
    type IPipelineComparison,
    type IRunConfigSnapshot,
} from "@flash-evals/api-contract";
import {
    buildModelResults,
    buildPipelineComparisonResults,
    describeRunAnswer,
    modelDisplayName,
    monthlySaving,
    runHeading,
    servedByModel,
    describeModelThinking,
    temperatureByModel,
    thinkingByModel,
} from "./run-results";

function row(overrides: Partial<ILeaderboardRow>): ILeaderboardRow {
    return {
        runModelId: "rm",
        modelId: "model",
        isReference: false,
        n: 20,
        failedCells: 0,
        avgFieldScore: undefined,
        avgJudgeScore: undefined,
        avgTranscriptScore: undefined,
        avgTranscriptJudgeScore: undefined,
        avgWer: undefined,
        avgCer: undefined,
        avgCpWer: undefined,
        avgSttLatencyMs: undefined,
        p95SttLatencyMs: undefined,
        totalSttCostUsd: undefined,
        p95LatencyMs: undefined,
        transcriptFailureCount: 0,
        avgLatencyMs: 1000,
        avgPromptTokens: undefined,
        avgCompletionTokens: undefined,
        avgTotalTokens: undefined,
        totalCostUsd: undefined,
        projectedCostPer1k: undefined,
        costAvailable: true,
        tokenUsageAvailable: false,
        ...overrides,
    };
}

function summary(
    runModelId: string,
    overrides: Partial<IBenchmarkModelSummary> = {},
): IBenchmarkModelSummary {
    return {
        runModelId,
        modelId: runModelId,
        isBenchmark: false,
        comparableItems: 30,
        failedItems: 0,
        tasks: [],
        ...overrides,
    };
}

const SNAPSHOT = {} as IRunConfigSnapshot;
const INFO = {
    "big-model": {
        label: "Big Model",
        inputPerMillion: 3,
        outputPerMillion: 15,
    },
    "small-model": { label: "Small Model" },
};

// Costs per call: big 0.04, small 0.002, crashy 0.001.
const LEADERBOARD = [
    row({
        runModelId: "rm-big",
        modelId: "big-model",
        isReference: true,
        avgFieldScore: 0.8,
        projectedCostPer1k: 40,
    }),
    row({
        runModelId: "rm-crashy",
        modelId: "crashy-model",
        avgFieldScore: 0.5,
        failedCells: 7,
        projectedCostPer1k: 1,
    }),
    row({
        runModelId: "rm-small",
        modelId: "small-model",
        avgFieldScore: 0.7,
        projectedCostPer1k: 2,
    }),
];

const results = (comparison?: IBenchmarkModelSummary[]) =>
    buildModelResults({
        leaderboard: LEADERBOARD,
        comparison,
        snapshot: SNAPSHOT,
        modelInfo: INFO,
    });

describe("buildModelResults", () => {
    it("sorts by cost per call and names models from the registry", () => {
        const rows = results();
        expect(rows.map((r) => r.name)).toEqual([
            "crashy-model",
            "Small Model",
            "Big Model",
        ]);
        expect(rows[2]).toMatchObject({ isReference: true, costPerCall: 0.04 });
        expect(rows[1]!.relativeCost).toBeCloseTo(0.05);
        expect(rows[2]!.relativeCost).toBeUndefined();
        expect(rows[0]).toMatchObject({ failedCells: 7, cells: 20 });
    });

    it("uses the comparison's paired cost when there is one", () => {
        const rows = results([summary("rm-small", { relativeCost: 0.06 })]);
        const small = rows.find((r) => r.runModelId === "rm-small")!;
        expect(small.relativeCost).toBe(0.06);
        expect(small.comparison?.runModelId).toBe("rm-small");
    });

    it("has no reference model in a single-model run", () => {
        const rows = buildModelResults({
            leaderboard: [LEADERBOARD[0]!],
            snapshot: SNAPSHOT,
            modelInfo: INFO,
        });
        expect(rows[0]!.isReference).toBe(false);
    });
});

describe("modelDisplayName", () => {
    it("falls back to the raw ID", () => {
        expect(modelDisplayName("x/unknown", SNAPSHOT, INFO)).toBe("x/unknown");
        expect(modelDisplayName("big-model", SNAPSHOT, INFO)).toBe("Big Model");
    });
});

describe("runHeading", () => {
    it("asks the question a run with a reference model answers", () => {
        expect(runHeading({ runId: "abcdef1234", results: results() })).toBe(
            "Cheaper than Big Model?",
        );
    });

    it("names the prompt and dataset otherwise, then the short ID", () => {
        const single = buildModelResults({
            leaderboard: [LEADERBOARD[0]!],
            snapshot: SNAPSHOT,
            modelInfo: INFO,
        });
        expect(
            runHeading({
                runId: "abcdef1234",
                results: single,
                context: {
                    datasetName: "Support tickets",
                    prompts: [{ promptId: "p", name: "Triage", version: 2 }],
                },
            }),
        ).toBe("Triage on Support tickets");
        expect(runHeading({ runId: "abcdef1234", results: single })).toBe(
            "Run abcdef12",
        );
    });
});

describe("describeRunAnswer without a comparison", () => {
    it("names the best exact-match score and its cost against today's model", () => {
        const answer = describeRunAnswer({
            results: results(),
            leaderboard: LEADERBOARD,
            active: false,
            fieldScoreName: "exact-match score",
        });
        expect(answer.sentence).toBe(
            "Big Model has the highest exact-match score (0.80). The cheapest model, crashy-model, scores 0.50 at 2.5% of the cost.",
        );
        expect(answer.pick?.name).toBe("Big Model");
        expect(answer.pickLabel).toBe("Best model");
        expect(answer.pickDetail).toBe("Exact-match score 0.80");
        expect(answer.reasons).toContain(
            "crashy-model failed 7 of 20 items; failed items count as zero.",
        );
    });

    it("gives the cost against today's model when a cheaper model wins", () => {
        const leaderboard = LEADERBOARD.map((r) =>
            r.runModelId === "rm-small" ? { ...r, avgFieldScore: 0.9 } : r,
        );
        const answer = describeRunAnswer({
            results: buildModelResults({
                leaderboard,
                snapshot: SNAPSHOT,
                modelInfo: INFO,
            }),
            leaderboard,
            active: true,
        });
        expect(answer.sentence).toBe(
            "Small Model has the highest stored-answer match score (0.90), at 5% of Big Model's cost.",
        );
        expect(answer.pickLabel).toBe("Leading model");
        expect(answer.reasons[0]).toMatch(/still in progress/);
    });

    it("names the cheapest of tied models", () => {
        const leaderboard = LEADERBOARD.map((r) => ({
            ...r,
            avgFieldScore: 0.8,
        }));
        const answer = describeRunAnswer({
            results: buildModelResults({
                leaderboard,
                snapshot: SNAPSHOT,
                modelInfo: INFO,
            }),
            leaderboard,
            active: false,
        });
        expect(answer.sentence).toBe(
            "3 models tie on stored-answer match score (0.80). crashy-model is the cheapest of them, at 2.5% of Big Model's cost.",
        );
    });

    it("says so when nothing was scored", () => {
        const leaderboard = LEADERBOARD.map((r) => ({
            ...r,
            avgFieldScore: undefined,
        }));
        const answer = describeRunAnswer({
            results: buildModelResults({
                leaderboard,
                snapshot: SNAPSHOT,
                modelInfo: INFO,
            }),
            leaderboard,
            active: false,
        });
        expect(answer.sentence).toBe(
            "No scores were recorded for this run. crashy-model costs least, at $0.0010 per call.",
        );
        expect(answer.pick).toBeUndefined();
    });
});

describe("describeRunAnswer with a comparison", () => {
    const task = (
        key: string,
        name: string,
        value: number,
        verdict: "pass" | "uncertain" | "fail",
    ) => ({
        key,
        name,
        method: "agreement" as const,
        n: 20,
        wins: 0,
        ties: 0,
        losses: 0,
        errors: 0,
        assessment: {
            metric: "agreement" as const,
            value,
            threshold: 0.9,
            sampleSize: "uncertain" as const,
            verdict,
        },
    });

    it("explains the closest model's tasks in plain sentences", () => {
        const closest = summary("rm-small", {
            relativeCost: 0.05,
            tasks: [
                task("label", "Sales label", 0.95, "uncertain"),
                task("notes", "Summary", 0.8, "uncertain"),
            ],
            assessment: {
                verdict: "conditional",
                reasons: ["Summary: could be either side of target 90%."],
            },
        });
        const weak = (id: string) =>
            summary(id, {
                relativeCost: 0.03,
                tasks: [
                    task("label", "Sales label", 0.95, "uncertain"),
                    task("notes", "Summary", 0.1, "fail"),
                ],
                assessment: { verdict: "fail", reasons: ["Summary: below."] },
            });
        const comparison = [closest, weak("rm-crashy"), weak("rm-other")];
        const answer = describeRunAnswer({
            results: results(comparison),
            leaderboard: LEADERBOARD,
            comparison,
            active: false,
        });
        expect(answer.reasons).toEqual([
            "Small Model isn't clearly below target on any task, but every task could still go either way.",
            "Strongest: Sales label (95%).",
            "Summary is the weak spot: 2 of 3 models are below target.",
            "2 of 3 models miss at least one target.",
        ]);
    });

    it("names the tasks the closest model is below target on", () => {
        const closest = summary("rm-small", {
            relativeCost: 0.05,
            failedItems: 2,
            tasks: [
                task("label", "Sales label", 0.95, "pass"),
                task("notes", "Summary", 0.4, "fail"),
                task("type", "Customer type", 0.5, "fail"),
            ],
            assessment: { verdict: "fail", reasons: [] },
        });
        const answer = describeRunAnswer({
            results: results([closest]),
            leaderboard: LEADERBOARD,
            comparison: [closest],
            active: false,
        });
        expect(answer.reasons).toEqual([
            "Small Model is below target on Summary and Customer type.",
            "Strongest: Sales label (95%).",
            "Small Model failed 2 items; they count as misses.",
        ]);
    });

    const failing = summary("rm-crashy", {
        relativeCost: 0.025,
        failedItems: 7,
        assessment: { verdict: "fail", reasons: ["Tags: below target."] },
    });
    const unsure = summary("rm-small", {
        relativeCost: 0.05,
        assessment: {
            verdict: "conditional",
            reasons: ["Tags: could be either side of target 90%."],
        },
    });

    it("follows the verdict, not the cheapest or highest-scoring model", () => {
        const comparison = [failing, unsure];
        const answer = describeRunAnswer({
            results: results(comparison),
            leaderboard: LEADERBOARD,
            comparison,
            active: false,
        });
        expect(answer.sentence).toBe(
            "No model can replace Big Model yet. Small Model is the closest, at 5% of the cost.",
        );
        expect(answer.pickLabel).toBe("Closest replacement");
        expect(answer.verdict).toBe("conditional");
        expect(answer.reasons).toEqual([
            "Tags: could be either side of target 90%.",
            "1 of 2 models miss at least one target.",
        ]);
        expect(answer.sample).toBeUndefined();
    });

    it("says a passing model can replace today's model", () => {
        const comparison = [
            failing,
            {
                ...unsure,
                assessment: { verdict: "pass" as const, reasons: [] },
            },
        ];
        const answer = describeRunAnswer({
            results: results(comparison),
            leaderboard: LEADERBOARD,
            comparison,
            active: false,
        });
        expect(answer.sentence).toBe(
            "Small Model can replace Big Model at 5% of the cost.",
        );
        expect(answer.reasons[0]).toBe(
            "Meets every target with enough items to be confident.",
        );
    });

    it("flags too few and few items with the sample-size rules", () => {
        const tiny = [{ ...unsure, comparableItems: 3 }];
        expect(
            describeRunAnswer({
                results: results(tiny),
                leaderboard: LEADERBOARD,
                comparison: tiny,
                active: false,
            }).sample?.label,
        ).toBe("Too few items for a verdict");
        const small = [{ ...unsure, comparableItems: 12 }];
        expect(
            describeRunAnswer({
                results: results(small),
                leaderboard: LEADERBOARD,
                comparison: small,
                active: false,
            }).sample,
        ).toEqual({
            label: "Small sample",
            detail: "12 items compared. Results on fewer than 20 items are uncertain.",
        });
    });

    it("never offers today's model as its own replacement", () => {
        const comparison = [
            summary("rm-big", {
                assessment: { verdict: "pass", reasons: [] },
            }),
            failing,
        ];
        const answer = describeRunAnswer({
            results: results(comparison),
            leaderboard: LEADERBOARD,
            comparison,
            active: false,
        });
        expect(answer.pick?.runModelId).toBe("rm-crashy");
    });
});

describe("monthlySaving", () => {
    it("multiplies the difference in cost per call by the calls", () => {
        const [crashy, small, big] = results();
        expect(monthlySaving(big, small, 100_000)).toBeCloseTo(3800);
        expect(monthlySaving(small, crashy, 1000)).toBeCloseTo(1);
        expect(monthlySaving(big, big, 1000)).toBeUndefined();
        expect(monthlySaving(undefined, small, 1000)).toBeUndefined();
    });
});

describe("servedByModel", () => {
    it("counts the hosts that served each model's answers, most first", () => {
        expect(
            servedByModel([
                { runModelId: "a", servedBy: "vertex" },
                { runModelId: "a", servedBy: "deepinfra" },
                { runModelId: "a", servedBy: "vertex" },
                { runModelId: "b" },
            ]),
        ).toEqual({
            a: [
                { host: "vertex", answers: 2 },
                { host: "deepinfra", answers: 1 },
            ],
        });
    });
});

describe("buildPipelineComparisonResults", () => {
    // Made-up snack-sales extraction; not client data.
    const items = Array.from({ length: 40 }, (_, index) => `item-${index}`);
    const comparison: IPipelineComparison = {
        run: { id: "eval-run-1", status: "completed" },
        ...summarizePipelineComparison({
            config: {
                runId: "eval-run-1",
                benchmark: {
                    source: "model",
                    taskMap: {
                        tasks: [
                            {
                                key: "products",
                                name: "Products",
                                method: "agreement",
                                fields: [
                                    {
                                        path: "$.products",
                                        matcher: "set_overlap",
                                    },
                                ],
                            },
                        ],
                    },
                },
                referenceRunModelId: "rm-ref",
                referenceModelId: "openai/big-model",
            },
            pipelineName: "Acme chain",
            evalItemIds: items,
            referenceCells: items.map((datasetItemId) => ({
                datasetItemId,
                succeeded: true,
                costUsd: 0.004,
                latencyMs: 2000,
            })),
            answers: items.map((datasetItemId) => ({
                datasetItemId,
                status: "complete" as const,
                costUsd: 0.001,
                latencyMs: 900,
                scored: true,
                details: {
                    tasks: [
                        {
                            key: "products",
                            method: "agreement" as const,
                            agreement: 1,
                        },
                    ],
                },
            })),
        }),
    };

    it("shows the reference as Reference and the pipeline as the candidate", () => {
        const results = buildPipelineComparisonResults({
            comparison,
            pipelineName: "Acme chain",
            referenceName: "Big Model",
        });
        expect(results.map((result) => result.name)).toEqual([
            "Acme chain",
            "Big Model",
        ]);
        expect(results[0]).toMatchObject({
            runModelId: "pipeline",
            modelId: "Acme chain",
            isReference: false,
            failedCells: 0,
            cells: 40,
            avgLatencyMs: 900,
        });
        expect(results[0]!.costPerCall).toBeCloseTo(0.001);
        expect(results[0]!.relativeCost).toBeCloseTo(0.25);
        expect(results[1]).toMatchObject({
            runModelId: "rm-ref",
            modelId: "openai/big-model",
            isReference: true,
            comparison: { isReference: true },
        });
        expect(results[1]!.costPerCall).toBeCloseTo(0.004);
    });

    it("answers whether the pipeline can replace the reference", () => {
        const results = buildPipelineComparisonResults({
            comparison,
            pipelineName: "Acme chain",
            referenceName: "Big Model",
        });
        const answer = describeRunAnswer({
            results,
            leaderboard: [],
            comparison: comparison.summary,
            active: false,
        });
        expect(answer.sentence).toBe(
            "Acme chain can replace Big Model at 25% of the cost.",
        );
        expect(answer.pick?.runModelId).toBe("pipeline");
        expect(answer.reference?.runModelId).toBe("rm-ref");
    });
});

describe("temperature per model", () => {
    it("keeps the temperature each model was sent, by run model", () => {
        const temperature = temperatureByModel([
            { id: "rm-small", temperature: 0 },
            { id: "rm-big" },
        ]);
        expect(temperature).toEqual({ "rm-small": 0 });
        const rows = buildModelResults({
            leaderboard: LEADERBOARD,
            snapshot: SNAPSHOT,
            modelInfo: INFO,
            temperature,
        });
        expect(rows.find((r) => r.runModelId === "rm-small")).toMatchObject({
            temperature: 0,
        });
        expect(rows.find((r) => r.runModelId === "rm-big")).not.toHaveProperty(
            "temperature",
        );
    });
});

describe("thinking per model", () => {
    it("counts answers whose thinking level was not sent, with the reason", () => {
        const byModel = thinkingByModel([
            {
                runModelId: "a",
                reasoningTokens: 120,
                thinking: { requested: "high", sent: true },
            },
            {
                runModelId: "a",
                reasoningTokens: 30,
                thinking: {
                    requested: "high",
                    sent: false,
                    reason: "No thinking setting on this route.",
                },
            },
            { runModelId: "b" },
        ]);
        expect(byModel).toEqual({
            a: {
                level: "high",
                sent: 1,
                notSent: 1,
                reason: "No thinking setting on this route.",
                tokens: 150,
            },
        });
        expect(describeModelThinking(byModel.a!)).toEqual({
            text: "Thinking high · 150 thinking tokens",
            warning:
                "Thinking high not sent on 1 answer: No thinking setting on this route.",
        });
    });
});
