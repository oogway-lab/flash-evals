import { describe, expect, it, vi } from "vitest";

// buildComparison is pure, but importing the module pulls in the db client via
// the read helpers; mock it so the suite loads without a database.
vi.mock("@/server/db/client", () => ({ db: {} }));

import {
    buildComparison,
    relatedRunIdsForComparison,
    type RunComparisonRow,
} from "./comparison";
import type { LeaderboardRow } from "./reads";

function row(overrides: Partial<LeaderboardRow>): LeaderboardRow {
    return {
        runModelId: "rm",
        modelId: "gpt-4o",
        isReference: false,
        n: 10,
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
        avgLatencyMs: undefined,
        avgPromptTokens: undefined,
        avgCompletionTokens: undefined,
        avgTotalTokens: undefined,
        totalCostUsd: undefined,
        projectedCostPer1k: undefined,
        costAvailable: false,
        tokenUsageAvailable: false,
        ...overrides,
    };
}

function side(
    overrides: Partial<LeaderboardRow>,
    effort?: RunComparisonRow["effort"],
): RunComparisonRow {
    return { row: row(overrides), effort };
}

describe("buildComparison", () => {
    it("computes current-minus-baseline deltas across all three axes", () => {
        const result = buildComparison(
            [
                side({
                    modelId: "gpt-4o",
                    avgJudgeScore: 0.7,
                    totalCostUsd: 1,
                    projectedCostPer1k: 10,
                    avgLatencyMs: 1000,
                }),
            ],
            [
                side({
                    modelId: "gpt-4o",
                    avgJudgeScore: 0.76,
                    totalCostUsd: 0.8,
                    projectedCostPer1k: 8,
                    avgLatencyMs: 1200,
                }),
            ],
        );

        expect(result).toHaveLength(1);
        const d = result[0].delta!;
        expect(d.quality).toBeCloseTo(0.06); // improved
        expect(d.cost).toBeCloseTo(-0.2); // cheaper
        expect(d.latency).toBeCloseTo(200); // slower
        expect(d.qualityComparable).toBe(true);
    });

    it("marks quality not comparable when a side has no judge score", () => {
        const result = buildComparison(
            [side({ modelId: "gpt-4o", avgFieldScore: 0.7 })],
            [side({ modelId: "gpt-4o", avgJudgeScore: 0.9 })],
        );
        const d = result[0].delta!;
        expect(d.qualityComparable).toBe(false);
        expect(d.quality).toBeUndefined();
    });

    it("uses the judge score as the quality axis and ignores the field score", () => {
        const result = buildComparison(
            [side({ modelId: "gpt-4o", avgFieldScore: 0.5, avgJudgeScore: 0.8 })],
            [side({ modelId: "gpt-4o", avgFieldScore: 0.6, avgJudgeScore: 0.9 })],
        );
        expect(result[0].baseline?.qualitySource).toBe("judge");
        expect(result[0].baseline?.quality).toBe(0.8);
        expect(result[0].delta?.quality).toBeCloseTo(0.1);
    });

    it("leaves quality undefined for a side scored only by field diff", () => {
        const result = buildComparison(
            [side({ modelId: "gpt-4o", avgFieldScore: 0.7 })],
            [side({ modelId: "gpt-4o", avgFieldScore: 0.8 })],
        );
        expect(result[0].baseline?.quality).toBeUndefined();
        expect(result[0].baseline?.qualitySource).toBeUndefined();
        expect(result[0].current?.quality).toBeUndefined();
        expect(result[0].current?.qualitySource).toBeUndefined();
        // both sides lack a judge score, so the quality axis is not comparable
        expect(result[0].delta?.qualityComparable).toBe(false);
        expect(result[0].delta?.quality).toBeUndefined();
    });

    it("surfaces models present on only one side without a delta", () => {
        const result = buildComparison(
            [side({ modelId: "only-baseline", avgFieldScore: 0.5 })],
            [side({ modelId: "only-current", avgFieldScore: 0.6 })],
        );
        const baselineOnly = result.find((r) => r.modelId === "only-baseline")!;
        const currentOnly = result.find((r) => r.modelId === "only-current")!;
        expect(baselineOnly.current).toBeUndefined();
        expect(baselineOnly.delta).toBeUndefined();
        expect(currentOnly.baseline).toBeUndefined();
        expect(currentOnly.delta).toBeUndefined();
    });

    it("carries reasoning effort per side and the reference flag", () => {
        const result = buildComparison(
            [side({ modelId: "gpt-5.4", avgFieldScore: 0.7, isReference: true }, "low")],
            [side({ modelId: "gpt-5.4", avgFieldScore: 0.7, isReference: true }, "high")],
        );
        expect(result[0].isReference).toBe(true);
        expect(result[0].baseline?.effort).toBe("low");
        expect(result[0].current?.effort).toBe("high");
    });

    it("leaves cost/latency delta undefined when a side lacks the metric", () => {
        const result = buildComparison(
            [side({ modelId: "gpt-4o", avgFieldScore: 0.7 })], // no cost/latency
            [
                side({
                    modelId: "gpt-4o",
                    avgFieldScore: 0.7,
                    totalCostUsd: 0.8,
                    avgLatencyMs: 900,
                }),
            ],
        );
        expect(result[0].delta?.cost).toBeUndefined();
        expect(result[0].delta?.latency).toBeUndefined();
    });

    it("computes STT methodology gate verdicts from transcript metrics", () => {
        const result = buildComparison(
            [
                side({
                    modelId: "soniox",
                    avgWer: 0.1,
                    avgCpWer: 0.2,
                    avgTranscriptJudgeScore: 0.8,
                    transcriptFailureCount: 0,
                    p95SttLatencyMs: 1000,
                    totalSttCostUsd: 2,
                }),
            ],
            [
                side({
                    modelId: "soniox",
                    avgWer: 0.11,
                    avgCpWer: 0.22,
                    avgTranscriptJudgeScore: 0.7,
                    transcriptFailureCount: 0,
                    p95SttLatencyMs: 1400,
                    totalSttCostUsd: 1.5,
                }),
            ],
        );

        expect(result[0].sttShipGate?.status).toBe("pass");
    });

    it("fails the STT methodology gate when WER or hard failures regress", () => {
        const result = buildComparison(
            [side({ modelId: "soniox", avgWer: 0.1, transcriptFailureCount: 0 })],
            [side({ modelId: "soniox", avgWer: 0.2, transcriptFailureCount: 1 })],
        );

        expect(result[0].sttShipGate?.status).toBe("fail");
        expect(
            result[0].sttShipGate?.checks.some(
                (check) => check.key === "hard_failures" && check.passed === false,
            ),
        ).toBe(true);
    });
});

describe("relatedRunIdsForComparison", () => {
    it("limits a rerun to its source run", () => {
        const result = relatedRunIdsForComparison(
            {
                id: "rerun-1",
                datasetId: "dataset-1",
                configSnapshot: { sourceRunId: "source-1" },
            },
            [
                {
                    id: "source-1",
                    datasetId: "dataset-1",
                    configSnapshot: {},
                },
                {
                    id: "other-1",
                    datasetId: "dataset-1",
                    configSnapshot: {},
                },
            ],
        );

        expect([...result]).toEqual(["source-1"]);
    });

    it("limits a source run to direct reruns launched from it", () => {
        const result = relatedRunIdsForComparison(
            {
                id: "source-1",
                datasetId: "dataset-1",
                configSnapshot: {},
            },
            [
                {
                    id: "rerun-1",
                    datasetId: "dataset-1",
                    configSnapshot: { sourceRunId: "source-1" },
                },
                {
                    id: "other-1",
                    datasetId: "dataset-1",
                    configSnapshot: { sourceRunId: "other-source" },
                },
            ],
        );

        expect([...result]).toEqual(["rerun-1"]);
    });
});
