import { inArray } from "drizzle-orm";
import { db } from "@/server/db/client";
import { datasets, runModels } from "@/server/db/schema";
import {
    listRuns,
    getRunProgressForRuns,
    type RunProgress,
} from "@/server/runs/service";

export type RunStatus =
    | "pending"
    | "running"
    | "completed"
    | "partial"
    | "failed";

export interface RunListRow {
    id: string;
    status: RunStatus;
    createdAt: Date;
    datasetId: string;
    datasetName: string;
    models: string[];
    progress: RunProgress;
}

export async function enrichRunRows<R extends { id: string; datasetId: string }>(
    rows: R[],
): Promise<
    (R & { datasetName: string; models: string[]; progress: RunProgress })[]
> {
    if (rows.length === 0) return [];

    const datasetIds = [...new Set(rows.map((r) => r.datasetId))];
    const dsRows = await db
        .select({ id: datasets.id, name: datasets.name })
        .from(datasets)
        .where(inArray(datasets.id, datasetIds));
    const dsById = new Map(dsRows.map((d) => [d.id, d.name]));

    const runIds = rows.map((r) => r.id);
    const modelRows = await db
        .select({ runId: runModels.runId, modelId: runModels.modelId })
        .from(runModels)
        .where(inArray(runModels.runId, runIds));
    const modelsByRun = new Map<string, string[]>();
    for (const m of modelRows) {
        const arr = modelsByRun.get(m.runId) ?? [];
        arr.push(m.modelId);
        modelsByRun.set(m.runId, arr);
    }

    const progressByRun = await getRunProgressForRuns(runIds);

    return rows.map((r) => ({
        ...r,
        datasetName: dsById.get(r.datasetId) ?? "Unknown",
        models: modelsByRun.get(r.id) ?? [],
        progress: progressByRun.get(r.id) ?? {
            total: 0,
            done: 0,
            failed: 0,
            pending: 0,
        },
    }));
}

export async function listRunsEnriched(teamId: string): Promise<RunListRow[]> {
    const runRows = await listRuns(teamId);
    const enriched = await enrichRunRows(runRows);
    return enriched.map((r) => ({
        id: r.id,
        status: r.status,
        createdAt: r.createdAt,
        datasetId: r.datasetId,
        datasetName: r.datasetName,
        models: r.models,
        progress: r.progress,
    }));
}
