import { pickBestModel, type ILeaderboardRow } from "@mosaic/api-contract";

export interface IBestModelSummary {
    /** What the score is: judge score, or transcript score for STT runs. */
    metric: "judge" | "transcript";
    score: number;
    /** The top model, or every model sharing the top score as displayed. */
    modelIds: string[];
    /** More than one model shares the top score. */
    tied: boolean;
    /** Models that have a score for the metric. */
    scored: number;
}

/**
 * The top model for the run summary. It uses the same rule as the
 * leaderboard's "Best" marker (`pickBestModel`: judge score, else transcript
 * score; scores compared as displayed to two decimals), so the two never
 * disagree. Returns `undefined` when no model has a score yet.
 */
export function summarizeBestModel(
    rows: readonly ILeaderboardRow[],
): IBestModelSummary | undefined {
    const best = pickBestModel(rows);
    if (!best) return undefined;
    const scoreOf = (row: ILeaderboardRow) =>
        best.metric === "judge" ? row.avgJudgeScore : row.avgTranscriptScore;
    const shown = best.score.toFixed(2);
    const modelIds = rows
        .filter((row) => scoreOf(row)?.toFixed(2) === shown)
        .map((row) => row.modelId);
    return {
        metric: best.metric,
        score: best.score,
        modelIds,
        tied: best.tiedCount > 1,
        scored: best.scored,
    };
}
