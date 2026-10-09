import { eq, inArray } from "drizzle-orm";
import {
    buildLeaderboardRows,
    type ILeaderboardRow,
} from "@mosaic/api-contract";
import { db } from "../db/client";
import { runCells, runModels, datasetItems, cellScores } from "../db/schema";
import { getCellAnnotations, type ICellAnnotation } from "./reviews";

export interface MatrixCellScore {
    scorerType: "field_diff" | "judge" | "transcript_metric" | "transcript_judge";
    score: number | null;
    rationale: string | null;
    detailsJson: unknown;
}

export async function getRunMatrix(runId: string) {
    const models = await db
        .select()
        .from(runModels)
        .where(eq(runModels.runId, runId));
    const cells = await db
        .select()
        .from(runCells)
        .where(eq(runCells.runId, runId));
    const itemIds = [...new Set(cells.map((c) => c.datasetItemId))];
    const items =
        itemIds.length > 0
            ? await db
                  .select()
                  .from(datasetItems)
                  .where(inArray(datasetItems.id, itemIds))
            : [];
    const cellIds = cells.map((c) => c.id);
    const scores =
        cellIds.length > 0
            ? await db
                  .select()
                  .from(cellScores)
                  .where(inArray(cellScores.runCellId, cellIds))
            : [];
    const annotationsByCell = await getCellAnnotations(cellIds);

    const scoresByCell = new Map<string, MatrixCellScore[]>();
    for (const s of scores) {
        const arr = scoresByCell.get(s.runCellId) ?? [];
        arr.push({
            scorerType: s.scorerType,
            score: s.score,
            rationale: s.rationale,
            detailsJson: s.detailsJson,
        });
        scoresByCell.set(s.runCellId, arr);
    }

    return { models, items, cells, scoresByCell, annotationsByCell };
}

export type MatrixCellAnnotation = ICellAnnotation;

export type LeaderboardRow = ILeaderboardRow;

export async function getLeaderboard(runId: string): Promise<LeaderboardRow[]> {
    const { models, cells, scoresByCell } = await getRunMatrix(runId);
    return buildLeaderboardRows(models, cells, scoresByCell);
}
