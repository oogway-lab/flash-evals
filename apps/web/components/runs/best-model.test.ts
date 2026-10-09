import { describe, expect, it } from "vitest";
import type { ILeaderboardRow } from "@mosaic/api-contract";
import { summarizeBestModel } from "./best-model";

function row(overrides: Partial<ILeaderboardRow>): ILeaderboardRow {
    return {
        runModelId: "rm",
        modelId: "model",
        isReference: false,
        n: 1,
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

describe("summarizeBestModel", () => {
    it("picks the highest judge score", () => {
        const best = summarizeBestModel([
            row({ modelId: "a", avgJudgeScore: 0.7 }),
            row({ modelId: "b", avgJudgeScore: 0.9 }),
            row({ modelId: "c", avgJudgeScore: 0.8 }),
        ]);
        expect(best).toEqual({
            metric: "judge",
            score: 0.9,
            modelIds: ["b"],
            tied: false,
            scored: 3,
        });
    });

    it("treats scores that display the same as a tie", () => {
        const best = summarizeBestModel([
            row({ modelId: "a", avgJudgeScore: 0.9 }),
            row({ modelId: "b", avgJudgeScore: 0.904 }),
            row({ modelId: "c", avgJudgeScore: 0.5 }),
        ]);
        expect(best?.tied).toBe(true);
        expect(best?.modelIds).toEqual(["a", "b"]);
    });

    it("ignores models without a score and counts those that have one", () => {
        const best = summarizeBestModel([
            row({ modelId: "a", avgJudgeScore: undefined }),
            row({ modelId: "b", avgJudgeScore: 0.6 }),
        ]);
        expect(best).toMatchObject({ modelIds: ["b"], scored: 1, tied: false });
    });

    it("falls back to the transcript score when no model has a judge score", () => {
        const best = summarizeBestModel([
            row({ modelId: "a", avgTranscriptScore: 0.4 }),
            row({ modelId: "b", avgTranscriptScore: 0.8 }),
        ]);
        expect(best).toMatchObject({ metric: "transcript", modelIds: ["b"] });
    });

    it("is undefined when nothing has a score yet", () => {
        expect(summarizeBestModel([])).toBeUndefined();
        expect(
            summarizeBestModel([row({ modelId: "a" }), row({ modelId: "b" })]),
        ).toBeUndefined();
    });
});
