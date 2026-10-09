import { createHash } from "crypto";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import type { ProviderTransport } from "@mosaic/api-contract";
import { db } from "../db/client";
import {
    runs,
    runModels,
    runCells,
    datasetItems,
    cellScores,
    runCellAnnotations,
    runNotes,
} from "../db/schema";
import type { IPipelineFieldConfig, RunModelSpec } from "../db/jsonTypes";
import { getPipeline } from "../pipelines/service";

export async function createRun(
    teamId: string,
    datasetId: string,
    pipelineId: string | undefined,
    models: RunModelSpec[],
    maxTokens: number,
    judgeConfigId: string | undefined,
    fieldConfigs: IPipelineFieldConfig[],
    createdBy: string,
    judgePromptVersionId?: string,
    sourceRunId?: string,
): Promise<string> {
    const items = await db
        .select({
            id: datasetItems.id,
            inputText: datasetItems.inputText,
            storageKey: datasetItems.storageKey,
        })
        .from(datasetItems)
        .where(eq(datasetItems.datasetId, datasetId));

    if (items.length === 0) {
        throw new Error("Cannot start a run on a dataset with no items.");
    }
    if (models.length === 0) {
        throw new Error("Cannot start a run with no candidate models.");
    }

    const pipeline = pipelineId ? await getPipeline(pipelineId) : undefined;
    if (!pipeline) {
        if (pipelineId) throw new Error("Prompt bundle not found.");
    }

    const runId = await db.transaction(async (tx) => {
        const [run] = await tx
            .insert(runs)
            .values({
                teamId,
                projectId: sql`(select id from projects where team_id = ${teamId} order by created_at limit 1)`,
                datasetId,
                judgeConfigId,
                judgePromptVersionId,
                pipelineId,
                status: "pending",
                configSnapshot: {
                    datasetId,
                    models,
                    judgeConfigId,
                    judgePromptVersionId,
                    maxTokens,
                    pipelineId,
                    fieldConfigs,
                    sourceRunId,
                },
                createdBy,
            })
            .returning();

        const insertedModels = await tx
            .insert(runModels)
            .values(
                models.map((m) => ({
                    runId: run.id,
                    modelId: m.modelId,
                    promptVersionId: m.promptVersionId,
                    schemaVersionId: m.schemaVersionId,
                    promptSnapshot: m.promptSnapshot,
                    reasoningConfig: m.reasoningConfig,
                    isReference: m.isReference,
                })),
            )
            .returning();

        await tx.insert(runCells).values(
            insertedModels.flatMap((rm) =>
                items.map((item) => ({
                    runId: run.id,
                    datasetItemId: item.id,
                    runModelId: rm.id,
                    status: "pending" as const,
                    contentFingerprint: contentFingerprintForItem(
                        item.inputText,
                        item.storageKey,
                    ),
                })),
            ),
        );

        return run.id;
    });

    return runId;
}

export async function listRuns(teamId: string) {
    return db
        .select()
        .from(runs)
        .where(eq(runs.teamId, teamId))
        .orderBy(desc(runs.createdAt));
}

export async function getRun(runId: string) {
    const [row] = await db
        .select()
        .from(runs)
        .where(eq(runs.id, runId))
        .limit(1);
    return row;
}

export async function deleteRun(runId: string) {
    await db.transaction(async (tx) => {
        const cells = await tx
            .select({ id: runCells.id })
            .from(runCells)
            .where(eq(runCells.runId, runId));
        const cellIds = cells.map((cell) => cell.id);

        if (cellIds.length > 0) {
            await tx
                .delete(cellScores)
                .where(inArray(cellScores.runCellId, cellIds));
            await tx
                .delete(runCellAnnotations)
                .where(inArray(runCellAnnotations.runCellId, cellIds));
        }

        await tx.delete(runNotes).where(eq(runNotes.runId, runId));
        await tx.delete(runCells).where(eq(runCells.runId, runId));
        await tx.delete(runModels).where(eq(runModels.runId, runId));
        await tx.delete(runs).where(eq(runs.id, runId));
    });
}

export async function getRunModels(runId: string) {
    return db.select().from(runModels).where(eq(runModels.runId, runId));
}

export async function getRunCells(runId: string) {
    return db.select().from(runCells).where(eq(runCells.runId, runId));
}

export async function getScoredRunCellIds(runId: string): Promise<Set<string>> {
    const rows = await db
        .selectDistinct({ id: cellScores.runCellId })
        .from(cellScores)
        .innerJoin(runCells, eq(runCells.id, cellScores.runCellId))
        .where(eq(runCells.runId, runId));
    return new Set(rows.map((row) => row.id));
}

export async function getRunProgress(runId: string) {
    // Count by status in SQL — avoids loading every cell's jsonb payload, which
    // matters since this runs on every progress poll and per-row in list reads.
    const rows = await db
        .select({
            status: runCells.status,
            count: sql<number>`count(*)::int`,
        })
        .from(runCells)
        .where(eq(runCells.runId, runId))
        .groupBy(runCells.status);

    let total = 0;
    let done = 0;
    let failed = 0;
    for (const r of rows) {
        total += r.count;
        if (r.status === "succeeded" || r.status === "cached") done += r.count;
        else if (r.status === "failed") failed += r.count;
    }
    return { total, done, failed, pending: total - done - failed };
}

export interface RunProgress {
    total: number;
    done: number;
    failed: number;
    pending: number;
}

export function contentFingerprintForItem(
    inputText: string | null | undefined,
    storageKey: string | null | undefined,
): string {
    return createHash("sha256")
        .update(inputText ?? "")
        .update("\0")
        .update(storageKey ?? "")
        .digest("hex");
}

export async function getRunProgressForRuns(
    runIds: string[],
): Promise<Map<string, RunProgress>> {
    const result = new Map<string, RunProgress>();
    if (runIds.length === 0) return result;
    for (const id of runIds) {
        result.set(id, { total: 0, done: 0, failed: 0, pending: 0 });
    }
    const rows = await db
        .select({
            runId: runCells.runId,
            status: runCells.status,
            count: sql<number>`count(*)::int`,
        })
        .from(runCells)
        .where(inArray(runCells.runId, runIds))
        .groupBy(runCells.runId, runCells.status);
    for (const r of rows) {
        const p = result.get(r.runId);
        if (!p) continue;
        p.total += r.count;
        if (r.status === "succeeded" || r.status === "cached")
            p.done += r.count;
        else if (r.status === "failed") p.failed += r.count;
    }
    for (const p of result.values()) p.pending = p.total - p.done - p.failed;
    return result;
}

export async function listRecentRuns(teamId: string, limit: number) {
    return db
        .select()
        .from(runs)
        .where(eq(runs.teamId, teamId))
        .orderBy(desc(runs.createdAt))
        .limit(limit);
}

export async function getRunCounts(
    teamId: string,
): Promise<{ total: number; active: number }> {
    const [row] = await db
        .select({
            total: sql<number>`count(*)::int`,
            active: sql<number>`count(*) filter (where ${runs.status} in ('running','pending'))::int`,
        })
        .from(runs)
        .where(eq(runs.teamId, teamId));
    return { total: row?.total ?? 0, active: row?.active ?? 0 };
}

export async function getScoresForCells(cellIds: string[]) {
    if (cellIds.length === 0) return [];
    return db
        .select()
        .from(cellScores)
        .where(inArray(cellScores.runCellId, cellIds));
}

/**
 * Prior succeeded/cached generation for the same item × model × prompt version ×
 * transport × maxTokens, from any run. Schema-violating cells are never reused.
 * The run snapshot supplies the immutable transport selected for the cached run.
 */
export async function findCachedCell(
    datasetItemId: string,
    modelId: string,
    promptVersionId: string,
    maxTokens: number,
    contentFingerprint: string,
    schemaHash: string | undefined,
    transport: ProviderTransport | undefined,
) {
    const rows = await db
        .select({
            outputJson: runCells.outputJson,
            latencyMs: runCells.latencyMs,
            costUsd: runCells.costUsd,
            costSource: runCells.costSource,
            promptTokens: runCells.promptTokens,
            completionTokens: runCells.completionTokens,
            providerMetadata: runCells.providerMetadata,
        })
        .from(runCells)
        .innerJoin(runModels, eq(runCells.runModelId, runModels.id))
        .innerJoin(runs, eq(runModels.runId, runs.id))
        .where(
            and(
                eq(runCells.datasetItemId, datasetItemId),
                eq(runModels.modelId, modelId),
                eq(runModels.promptVersionId, promptVersionId),
                eq(runCells.maxTokens, maxTokens),
                eq(runCells.contentFingerprint, contentFingerprint),
                schemaHash === undefined
                    ? sql`${runCells.schemaHash} is null`
                    : eq(runCells.schemaHash, schemaHash),
                sql`exists (
                    select 1
                    from jsonb_array_elements(${runs.configSnapshot}->'models') as cached_model
                    where cached_model->>'modelId' = ${modelId}
                      and cached_model->>'promptVersionId' = ${promptVersionId}
                      and cached_model->>'transport' is not distinct from ${transport ?? null}
                )`,
                eq(runCells.schemaViolation, false),
                inArray(runCells.status, ["succeeded", "cached"]),
            ),
        )
        .limit(1);
    return rows[0];
}

/**
 * Atomically claim this run's pending/failed cells by flipping them to 'running'
 * and returning only the rows this call won. A concurrent executor (e.g. a retry
 * racing the worker) gets the remaining rows or none, so no cell is processed twice.
 */
export async function claimRunCells(runId: string) {
    return db
        .update(runCells)
        .set({ status: "running", claimedAt: new Date(), error: null })
        .where(
            and(
                eq(runCells.runId, runId),
                inArray(runCells.status, ["pending", "failed"]),
            ),
        )
        .returning();
}
