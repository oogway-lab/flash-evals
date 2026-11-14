import { describe, expect, it } from "vitest";
import {
    buildLeaderboardRows,
    pickBestModel,
    type ILeaderboardCell,
    type ILeaderboardScore,
} from "./leaderboard.js";

const models = [
    { id: "rm-a", modelId: "steady", isReference: true },
    { id: "rm-b", modelId: "crashy", isReference: false },
];

function cell(
    id: string,
    runModelId: string,
    datasetItemId: string,
    status: string,
): ILeaderboardCell {
    return {
        id,
        runModelId,
        datasetItemId,
        status,
        latencyMs: 100,
        costUsd: status === "failed" ? null : 0.01,
        promptTokens: null,
        completionTokens: null,
    };
}

const field = (score: number | null): ILeaderboardScore[] => [
    { scorerType: "field_diff", score, detailsJson: {} },
];

describe("buildLeaderboardRows", () => {
    it("adds judge cost per model without changing the model's own cost", () => {
        const cells = [
            { ...cell("a1", "rm-a", "i1", "succeeded"), judgeCostUsd: 0.002 },
            { ...cell("a2", "rm-a", "i2", "cached"), judgeCostUsd: 0.003 },
            cell("b1", "rm-b", "i1", "succeeded"),
        ];
        const [steady, crashy] = buildLeaderboardRows(models, cells, new Map());
        expect(steady?.totalCostUsd).toBeCloseTo(0.02);
        expect(steady?.totalJudgeCostUsd).toBeCloseTo(0.005);
        expect(crashy).not.toHaveProperty("totalJudgeCostUsd");
    });

    it("counts a failed cell as zero where another model was scored", () => {
        const cells = [
            cell("a1", "rm-a", "i1", "succeeded"),
            cell("a2", "rm-a", "i2", "succeeded"),
            cell("b1", "rm-b", "i1", "succeeded"),
            cell("b2", "rm-b", "i2", "failed"),
        ];
        const scores = new Map([
            ["a1", field(0.6)],
            ["a2", field(0.6)],
            ["b1", field(1)],
        ]);
        const [steady, crashy] = buildLeaderboardRows(models, cells, scores);
        expect(steady).toMatchObject({ avgFieldScore: 0.6, failedCells: 0 });
        expect(crashy).toMatchObject({ avgFieldScore: 0.5, failedCells: 1 });
        // Without the failure counted, the crashing model would rank first.
        expect(pickBestModel([steady!, crashy!])?.modelId).toBe("steady");
    });

    it("leaves a failure out where no model has a score for the item", () => {
        const cells = [
            cell("a1", "rm-a", "i1", "succeeded"),
            cell("a2", "rm-a", "i2", "succeeded"),
            cell("b1", "rm-b", "i1", "succeeded"),
            cell("b2", "rm-b", "i2", "failed"),
        ];
        // Item i2 has no golden answer, so nothing on it was scored.
        const scores = new Map([
            ["a1", field(0.6)],
            ["a2", field(null)],
            ["b1", field(1)],
        ]);
        const [, crashy] = buildLeaderboardRows(models, cells, scores);
        expect(crashy).toMatchObject({ avgFieldScore: 1, failedCells: 1 });
    });

    it("counts failures against judge scores the same way", () => {
        const cells = [
            cell("a1", "rm-a", "i1", "succeeded"),
            cell("b1", "rm-b", "i1", "failed"),
        ];
        const scores = new Map<string, ILeaderboardScore[]>([
            ["a1", [{ scorerType: "judge", score: 0.8, detailsJson: {} }]],
        ]);
        const [, crashy] = buildLeaderboardRows(models, cells, scores);
        expect(crashy).toMatchObject({
            avgJudgeScore: 0,
            avgFieldScore: undefined,
        });
    });

    it("scores a model that failed every item as zero", () => {
        const cells = [
            cell("a1", "rm-a", "i1", "succeeded"),
            cell("b1", "rm-b", "i1", "failed"),
        ];
        const [, crashy] = buildLeaderboardRows(
            models,
            cells,
            new Map([["a1", field(0.4)]]),
        );
        expect(crashy!.avgFieldScore).toBe(0);
    });
});
