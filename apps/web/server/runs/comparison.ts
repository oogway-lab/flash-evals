import { eq } from "drizzle-orm";
import type { ReasoningEffort } from "@mosaic/llm-core";
import { buildSttShipGate, type ISttShipGate } from "@mosaic/api-contract";
import { db } from "../db/client";
import { runModels } from "../db/schema";
import { getLeaderboard, type LeaderboardRow } from "./reads";
import { enrichRunRows } from "./listReads";
import { listRuns } from "./service";

export type QualitySource = "judge";

export interface ComparableRun {
    id: string;
    createdAt: Date;
    models: string[];
}

export interface SideMetrics {
    quality: number | undefined;
    qualitySource: QualitySource | undefined;
    cost: number | undefined; // total cost for this run/model
    latency: number | undefined; // avg ms
    p95Latency: number | undefined;
    sttCost: number | undefined;
    sttP95Latency: number | undefined;
    wer: number | undefined;
    cpWer: number | undefined;
    transcriptJudgeScore: number | undefined;
    hardFailureCount: number;
    effort: ReasoningEffort | undefined;
    n: number;
}

export interface ModelComparison {
    modelId: string;
    isReference: boolean;
    baseline: SideMetrics | undefined;
    current: SideMetrics | undefined;
    // current − baseline; positive quality is better, positive cost/latency is worse.
    delta:
        | {
              quality: number | undefined;
              cost: number | undefined;
              latency: number | undefined;
              // false when a side is missing a judge score, so quality can't be diffed
              qualityComparable: boolean;
          }
        | undefined;
    sttShipGate: ISttShipGate | undefined;
}

export interface RunComparisonRow {
    row: LeaderboardRow;
    effort: ReasoningEffort | undefined;
}

function side(input: RunComparisonRow): SideMetrics {
    const { row } = input;
    const quality = row.avgJudgeScore;
    const qualitySource: QualitySource | undefined =
        row.avgJudgeScore !== undefined ? "judge" : undefined;
    return {
        quality,
        qualitySource,
        cost: row.totalCostUsd,
        latency: row.avgLatencyMs,
        p95Latency: row.p95LatencyMs,
        sttCost: row.totalSttCostUsd,
        sttP95Latency: row.p95SttLatencyMs,
        wer: row.avgWer,
        cpWer: row.avgCpWer,
        transcriptJudgeScore: row.avgTranscriptJudgeScore,
        hardFailureCount: row.transcriptFailureCount,
        effort: input.effort,
        n: row.n,
    };
}

function diff(
    a: number | undefined,
    b: number | undefined,
): number | undefined {
    return a === undefined || b === undefined ? undefined : a - b;
}

// Pure: join baseline + current per model and compute per-axis deltas
// (see the `delta` field above for the sign convention).
export function buildComparison(
    baseline: RunComparisonRow[],
    current: RunComparisonRow[],
): ModelComparison[] {
    const baseByModel = new Map(baseline.map((r) => [r.row.modelId, r]));
    const curByModel = new Map(current.map((r) => [r.row.modelId, r]));
    const modelIds = [
        ...new Set([...baseByModel.keys(), ...curByModel.keys()]),
    ];

    return modelIds.map((modelId) => {
        const b = baseByModel.get(modelId);
        const c = curByModel.get(modelId);
        const baselineSide = b ? side(b) : undefined;
        const currentSide = c ? side(c) : undefined;

        let delta: ModelComparison["delta"];
        if (baselineSide && currentSide) {
            const qualityComparable =
                baselineSide.qualitySource !== undefined &&
                baselineSide.qualitySource === currentSide.qualitySource;
            delta = {
                quality: qualityComparable
                    ? diff(currentSide.quality, baselineSide.quality)
                    : undefined,
                cost: diff(currentSide.cost, baselineSide.cost),
                latency: diff(currentSide.latency, baselineSide.latency),
                qualityComparable,
            };
        }

        return {
            modelId,
            isReference: (c ?? b)!.row.isReference,
            baseline: baselineSide,
            current: currentSide,
            delta,
            sttShipGate: buildSttShipGate({
                baseline: baselineSide,
                current: currentSide,
            }),
        };
    });
}

async function effortByModel(
    runId: string,
): Promise<Map<string, ReasoningEffort | undefined>> {
    const rows = await db
        .select({
            modelId: runModels.modelId,
            reasoningConfig: runModels.reasoningConfig,
        })
        .from(runModels)
        .where(eq(runModels.runId, runId));
    return new Map(rows.map((r) => [r.modelId, r.reasoningConfig?.effort]));
}

async function rowsForRun(runId: string): Promise<RunComparisonRow[]> {
    const [rows, efforts] = await Promise.all([
        getLeaderboard(runId),
        effortByModel(runId),
    ]);
    return rows.map((row) => ({ row, effort: efforts.get(row.modelId) }));
}

export async function compareRuns(
    baselineRunId: string,
    currentRunId: string,
): Promise<ModelComparison[]> {
    const [baseline, current] = await Promise.all([
        rowsForRun(baselineRunId),
        rowsForRun(currentRunId),
    ]);
    return buildComparison(baseline, current);
}

interface IRunLineageRow {
    id: string;
    datasetId: string;
    configSnapshot: {
        sourceRunId?: string;
    };
}

export function relatedRunIdsForComparison(
    currentRun: IRunLineageRow,
    runs: IRunLineageRow[],
): Set<string> {
    const sourceRunId = currentRun.configSnapshot.sourceRunId;
    if (sourceRunId) return new Set([sourceRunId]);

    return new Set(
        runs
            .filter((run) => run.configSnapshot.sourceRunId === currentRun.id)
            .map((run) => run.id),
    );
}

// Completed runs in the direct rerun lineage only. A rerun compares to its
// source run; a source run compares to runs launched from its Rerun button.
export async function listComparableRuns(
    teamId: string,
    currentRun: IRunLineageRow,
): Promise<ComparableRun[]> {
    const runRows = await listRuns(teamId);
    const relatedIds = relatedRunIdsForComparison(currentRun, runRows);
    if (relatedIds.size === 0) return [];

    const enriched = await enrichRunRows(runRows);
    return enriched
        .filter(
            (r) =>
                relatedIds.has(r.id) &&
                r.datasetId === currentRun.datasetId &&
                r.id !== currentRun.id &&
                r.status === "completed",
        )
        .map((r) => ({ id: r.id, createdAt: r.createdAt, models: r.models }));
}
