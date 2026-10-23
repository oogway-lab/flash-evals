import type { IDashboardResponse } from "@flash-evals/api-contract";
import type { IDb } from "../db.js";
import { listRecentRunsPayload } from "./runs.js";

interface ICountRow {
    count: number | string;
}

interface IRunCountRow {
    total: number | string;
    active: number | string;
}

export async function dashboardPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    limit = 5,
): Promise<IDashboardResponse> {
    const [
        datasetCount,
        promptCount,
        runCounts,
        schemaCount,
        itemCount,
        recentRuns,
        goldenCount,
    ] = await Promise.all([
        countActiveDatasets(db, teamId, projectId),
        countPrompts(db, teamId, projectId),
        countRuns(db, teamId, projectId),
        countDatasetsWithSchemas(db, teamId, projectId),
        countDatasetsWithItems(db, teamId, projectId),
        listRecentRunsPayload(db, teamId, projectId, limit),
        countGoldenLabels(db, teamId, projectId),
    ]);

    return {
        stats: {
            datasetCount,
            promptCount,
            runCount: runCounts.total,
            runningCount: runCounts.active,
            hasDatasetWithSchema: schemaCount > 0,
            ...(goldenCount > 0 ? { hasGoldenLabels: true } : {}),
            hasDatasetWithItems: itemCount > 0,
            hasPrompt: promptCount > 0,
        },
        recentRuns,
    };
}

async function countActiveDatasets(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<number> {
    const result = await db.query<ICountRow>(
        "select count(*)::int as count from datasets where team_id = $1 and project_id = $2 and archived_at is null",
        [teamId, projectId],
    );
    return rowCount(result.rows[0]);
}

async function countPrompts(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<number> {
    const result = await db.query<ICountRow>(
        "select count(*)::int as count from prompts where team_id = $1 and project_id = $2",
        [teamId, projectId],
    );
    return rowCount(result.rows[0]);
}

async function countRuns(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<{ total: number; active: number }> {
    const result = await db.query<IRunCountRow>(
        `select
            count(*)::int as total,
            count(*) filter (where status in ('pending', 'running'))::int as active
        from (
            select status from runs where team_id=$1 and project_id=$2
            union all
            select status from workflow_runs where team_id=$1 and project_id=$2
        ) project_runs`,
        [teamId, projectId],
    );
    const row = result.rows[0];
    return {
        total: rowCount(row, "total"),
        active: rowCount(row, "active"),
    };
}

async function countDatasetsWithSchemas(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<number> {
    const result = await db.query<ICountRow>(
        `select count(distinct ds.dataset_id)::int as count
        from dataset_schemas ds
        inner join datasets d on d.id = ds.dataset_id
        where d.team_id = $1 and d.project_id = $2 and d.archived_at is null`,
        [teamId, projectId],
    );
    return rowCount(result.rows[0]);
}

async function countDatasetsWithItems(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<number> {
    const result = await db.query<ICountRow>(
        `select count(distinct di.dataset_id)::int as count
        from dataset_items di
        inner join datasets d on d.id = di.dataset_id
        where d.team_id = $1 and d.project_id = $2 and d.archived_at is null`,
        [teamId, projectId],
    );
    return rowCount(result.rows[0]);
}

async function countGoldenLabels(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<number> {
    const result = await db.query<ICountRow>(
        `select count(distinct di.dataset_id)::int as count
         from labels l inner join dataset_items di on di.id=l.dataset_item_id
         inner join datasets d on d.id=di.dataset_id
         where d.team_id=$1 and d.project_id=$2 and d.archived_at is null and d.purpose='golden'`,
        [teamId, projectId],
    );
    return rowCount(result.rows[0]);
}

function rowCount(row: unknown, key = "count"): number {
    if (!row || typeof row !== "object") return 0;
    const value = (row as Record<string, unknown>)[key];
    return typeof value === "number" ? value : Number(value ?? 0);
}
