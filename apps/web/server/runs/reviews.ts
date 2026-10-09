import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
    runs,
    runCells,
    runNotes,
    runCellAnnotations,
} from "../db/schema";

export type ReviewVerdict = "unreviewed" | "approved" | "needs_review" | "issue";

export interface IRunNote {
    body: string;
    updatedAt: Date;
    updatedBy: string | null;
}

export interface ICellAnnotation {
    runCellId: string;
    verdict: ReviewVerdict;
    comment: string;
    updatedAt: Date;
    updatedBy: string | null;
}

export async function getRunNote(runId: string): Promise<IRunNote | undefined> {
    const [note] = await db
        .select({
            body: runNotes.body,
            updatedAt: runNotes.updatedAt,
            updatedBy: runNotes.updatedBy,
        })
        .from(runNotes)
        .where(eq(runNotes.runId, runId))
        .limit(1);
    return note;
}

export async function saveRunNote(input: {
    runId: string;
    body: string;
    updatedBy: string;
}) {
    await db
        .insert(runNotes)
        .values({
            runId: input.runId,
            body: input.body,
            updatedBy: input.updatedBy,
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: runNotes.runId,
            set: {
                body: input.body,
                updatedBy: input.updatedBy,
                updatedAt: new Date(),
            },
        });
}

export async function getCellAnnotations(
    runCellIds: string[],
): Promise<Map<string, ICellAnnotation>> {
    const annotations = new Map<string, ICellAnnotation>();
    if (runCellIds.length === 0) return annotations;
    const rows = await db
        .select({
            runCellId: runCellAnnotations.runCellId,
            verdict: runCellAnnotations.verdict,
            comment: runCellAnnotations.comment,
            updatedAt: runCellAnnotations.updatedAt,
            updatedBy: runCellAnnotations.updatedBy,
        })
        .from(runCellAnnotations)
        .where(inArray(runCellAnnotations.runCellId, runCellIds));
    for (const row of rows) annotations.set(row.runCellId, row);
    return annotations;
}

export async function saveCellAnnotation(input: {
    runCellId: string;
    verdict: ReviewVerdict;
    comment: string;
    updatedBy: string;
}) {
    await db
        .insert(runCellAnnotations)
        .values({
            runCellId: input.runCellId,
            verdict: input.verdict,
            comment: input.comment,
            updatedBy: input.updatedBy,
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: runCellAnnotations.runCellId,
            set: {
                verdict: input.verdict,
                comment: input.comment,
                updatedBy: input.updatedBy,
                updatedAt: new Date(),
            },
        });
}

export async function getRunTeamForCell(runCellId: string) {
    const [row] = await db
        .select({
            runId: runs.id,
            teamId: runs.teamId,
        })
        .from(runCells)
        .innerJoin(runs, eq(runCells.runId, runs.id))
        .where(eq(runCells.id, runCellId))
        .limit(1);
    return row;
}
