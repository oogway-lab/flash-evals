import type { ScorerType } from "./index.js";

export interface ILeaderboardScore {
    /** Benchmark scores are summarized separately and ignored here. */
    scorerType: ScorerType;
    score: number | null;
    detailsJson: unknown;
}

export interface ILeaderboardModel {
    id: string;
    modelId: string;
    isReference: boolean;
}

export interface ILeaderboardCell {
    id: string;
    runModelId: string;
    /** Used to count failed cells against a model's average scores. */
    datasetItemId?: string;
    /** Cell status; "failed" cells count as zero (see `buildLeaderboardRows`). */
    status?: string;
    latencyMs: number | null;
    costUsd: number | null;
    /** What judging the cell cost (every scoring pass); see run totals. */
    judgeCostUsd?: number | null;
    promptTokens: number | null;
    completionTokens: number | null;
}

export interface ILeaderboardRow {
    runModelId: string;
    modelId: string;
    isReference: boolean;
    n: number;
    /** Cells that failed (no output). */
    failedCells: number;
    avgFieldScore: number | undefined;
    avgJudgeScore: number | undefined;
    avgTranscriptScore: number | undefined;
    avgTranscriptJudgeScore: number | undefined;
    avgWer: number | undefined;
    avgCer: number | undefined;
    avgCpWer: number | undefined;
    avgSttLatencyMs: number | undefined;
    p95SttLatencyMs: number | undefined;
    totalSttCostUsd: number | undefined;
    p95LatencyMs: number | undefined;
    transcriptFailureCount: number;
    avgLatencyMs: number | undefined;
    avgPromptTokens: number | undefined;
    avgCompletionTokens: number | undefined;
    avgTotalTokens: number | undefined;
    totalCostUsd: number | undefined;
    /**
     * What judging this model's cells cost. Not part of `totalCostUsd`, which
     * stays the model's own cost so models compare fairly; the run's total
     * cost adds it.
     */
    totalJudgeCostUsd?: number;
    projectedCostPer1k: number | undefined;
    costAvailable: boolean;
    tokenUsageAvailable: boolean;
}

interface IScoreStats {
    fieldScores: number[];
    judgeScores: number[];
    transcriptScores: number[];
    transcriptJudgeScores: number[];
    transcriptWers: number[];
    transcriptCers: number[];
    transcriptCpWers: number[];
    sttLatencies: number[];
    sttCosts: number[];
    transcriptFailureCount: number;
}

/**
 * One row per model. A failed cell counts as a zero golden or judge score
 * whenever another model's cell on the same item got that score, so a model
 * that crashes on hard items can't outrank one that answered them.
 */
export function buildLeaderboardRows(
    models: ILeaderboardModel[],
    cells: ILeaderboardCell[],
    scoresByCell: Map<string, ILeaderboardScore[]>,
): ILeaderboardRow[] {
    const scoredItems = scoredItemsByMetric(cells, scoresByCell);
    return models.map((model) => {
        const modelCells = cells.filter((cell) => cell.runModelId === model.id);
        const stats = scoreStatsForCells(modelCells, scoresByCell);
        const failedCells = modelCells.filter(
            (cell) => cell.status === "failed",
        );
        for (const cell of failedCells) {
            if (scoredItems.field.has(itemKey(cell))) stats.fieldScores.push(0);
            if (scoredItems.judge.has(itemKey(cell))) stats.judgeScores.push(0);
        }
        const latencies = presentNumbers(
            modelCells.map((cell) => cell.latencyMs),
        );
        const costs = presentNumbers(modelCells.map((cell) => cell.costUsd));
        const judgeCosts = presentNumbers(
            modelCells.map((cell) => cell.judgeCostUsd ?? null),
        );
        const promptTokens = presentNumbers(
            modelCells.map((cell) => cell.promptTokens),
        );
        const completionTokens = presentNumbers(
            modelCells.map((cell) => cell.completionTokens),
        );
        const averageCost = mean(costs);
        const tokenTotals = modelCells
            .map((cell) =>
                cell.promptTokens == null || cell.completionTokens == null
                    ? undefined
                    : cell.promptTokens + cell.completionTokens,
            )
            .filter((value): value is number => value !== undefined);

        return {
            runModelId: model.id,
            modelId: model.modelId,
            isReference: model.isReference,
            n: modelCells.length,
            failedCells: failedCells.length,
            avgFieldScore: mean(stats.fieldScores),
            avgJudgeScore: mean(stats.judgeScores),
            avgTranscriptScore: mean(stats.transcriptScores),
            avgTranscriptJudgeScore: mean(stats.transcriptJudgeScores),
            avgWer: mean(stats.transcriptWers),
            avgCer: mean(stats.transcriptCers),
            avgCpWer: mean(stats.transcriptCpWers),
            avgSttLatencyMs: mean(stats.sttLatencies),
            p95SttLatencyMs: percentile(stats.sttLatencies, 0.95),
            totalSttCostUsd: stats.sttCosts.length
                ? sum(stats.sttCosts)
                : undefined,
            p95LatencyMs: percentile(latencies, 0.95),
            transcriptFailureCount: stats.transcriptFailureCount,
            avgLatencyMs: mean(latencies),
            avgPromptTokens: mean(promptTokens),
            avgCompletionTokens: mean(completionTokens),
            avgTotalTokens: mean(tokenTotals),
            totalCostUsd: costs.length ? sum(costs) : undefined,
            ...(judgeCosts.length
                ? { totalJudgeCostUsd: sum(judgeCosts) }
                : {}),
            projectedCostPer1k:
                averageCost === undefined ? undefined : averageCost * 1000,
            costAvailable:
                costs.length === modelCells.length && modelCells.length > 0,
            tokenUsageAvailable:
                tokenTotals.length === modelCells.length &&
                modelCells.length > 0,
        };
    });
}

/** Cells without an item id share one key, so the rule falls back to the whole run. */
function itemKey(cell: ILeaderboardCell): string {
    return cell.datasetItemId ?? "";
}

/** Items on which at least one cell has a golden or judge score. */
function scoredItemsByMetric(
    cells: ILeaderboardCell[],
    scoresByCell: Map<string, ILeaderboardScore[]>,
): { field: Set<string>; judge: Set<string> } {
    const field = new Set<string>();
    const judge = new Set<string>();
    for (const cell of cells) {
        for (const score of scoresByCell.get(cell.id) ?? []) {
            if (score.score === null) continue;
            if (score.scorerType === "field_diff") field.add(itemKey(cell));
            else if (score.scorerType === "judge") judge.add(itemKey(cell));
        }
    }
    return { field, judge };
}

function scoreStatsForCells(
    cells: Array<{ id: string }>,
    scoresByCell: Map<string, ILeaderboardScore[]>,
): IScoreStats {
    const stats: IScoreStats = {
        fieldScores: [],
        judgeScores: [],
        transcriptScores: [],
        transcriptJudgeScores: [],
        transcriptWers: [],
        transcriptCers: [],
        transcriptCpWers: [],
        sttLatencies: [],
        sttCosts: [],
        transcriptFailureCount: 0,
    };

    for (const cell of cells) {
        for (const score of scoresByCell.get(cell.id) ?? []) {
            addScore(stats, score);
        }
    }
    return stats;
}

function addScore(stats: IScoreStats, score: ILeaderboardScore): void {
    if (score.score === null) return;
    if (score.scorerType === "field_diff") stats.fieldScores.push(score.score);
    else if (score.scorerType === "judge") stats.judgeScores.push(score.score);
    else if (score.scorerType === "transcript_judge") {
        stats.transcriptJudgeScores.push(score.score);
    } else if (score.scorerType === "transcript_metric") {
        const details = transcriptMetricDetails(score.detailsJson);
        if (details.metricKind === "llm_judge") return;
        stats.transcriptScores.push(score.score);
        pushIfPresent(stats.transcriptWers, details.wer);
        pushIfPresent(stats.transcriptCers, details.cer);
        pushIfPresent(stats.transcriptCpWers, details.cpWer);
        pushIfPresent(stats.sttLatencies, details.latencyMsTotal);
        pushIfPresent(stats.sttCosts, details.costUsd);
        if (details.hasHardFailure) stats.transcriptFailureCount += 1;
    }
}

function transcriptMetricDetails(detailsJson: unknown) {
    if (!isRecord(detailsJson)) {
        return {
            wer: undefined,
            cer: undefined,
            cpWer: undefined,
            latencyMsTotal: undefined,
            costUsd: undefined,
            hasHardFailure: false,
            metricKind: undefined,
        };
    }
    const diarization = detailsJson.diarization;
    return {
        wer: finiteNumber(detailsJson.wer),
        cer: finiteNumber(detailsJson.cer),
        cpWer: isRecord(diarization)
            ? finiteNumber(diarization.cpWer)
            : undefined,
        latencyMsTotal: finiteNumber(detailsJson.latencyMsTotal),
        costUsd: finiteNumber(detailsJson.costUsd),
        hasHardFailure:
            Array.isArray(detailsJson.hardFailures) &&
            detailsJson.hardFailures.length > 0,
        metricKind:
            typeof detailsJson.metricKind === "string"
                ? detailsJson.metricKind
                : undefined,
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function presentNumbers(values: Array<number | null | undefined>): number[] {
    return values.filter(
        (value): value is number => value !== null && value !== undefined,
    );
}

function pushIfPresent(values: number[], value: number | undefined): void {
    if (value !== undefined) values.push(value);
}

function finiteNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function mean(values: number[]): number | undefined {
    return values.length ? sum(values) / values.length : undefined;
}

function percentile(values: number[], quantile: number): number | undefined {
    if (values.length === 0) return undefined;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil(quantile * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

export interface IBestModelCandidate {
    modelId: string;
    avgFieldScore?: number;
    avgJudgeScore: number | undefined;
    avgTranscriptScore: number | undefined;
}

export interface IRunBestModel {
    modelId: string;
    score: number;
    /** Which score ranked the models. */
    metric: "judge" | "transcript" | "field";
    /** Models that have a score for that metric. */
    scored: number;
    /** All models considered, scored or not; `scored < total` means a partial winner. */
    total: number;
    /** Models sharing the top score as displayed (two decimals); 1 = clear winner. */
    tiedCount: number;
}

/**
 * The top model by judge score, or by transcript score when no model has a
 * judge score (STT runs), then golden field score. Ties are compared as displayed
 * (two decimals), the same rule the leaderboard uses to decide where to put its "Best" marker.
 */
export function pickBestModel(
    candidates: readonly IBestModelCandidate[],
): IRunBestModel | undefined {
    const metric = candidates.some((c) => c.avgJudgeScore !== undefined)
        ? "judge"
        : candidates.some((c) => c.avgTranscriptScore !== undefined)
          ? "transcript"
          : "field";
    const scored = candidates.flatMap((c) => {
        const score =
            metric === "judge"
                ? c.avgJudgeScore
                : metric === "transcript"
                  ? c.avgTranscriptScore
                  : c.avgFieldScore;
        return score === undefined ? [] : [{ modelId: c.modelId, score }];
    });
    if (scored.length === 0) return undefined;
    const top = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const shown = top.score.toFixed(2);
    const tiedCount = scored.filter((s) => s.score.toFixed(2) === shown).length;
    return {
        modelId: top.modelId,
        score: top.score,
        metric,
        scored: scored.length,
        total: candidates.length,
        tiedCount,
    };
}
