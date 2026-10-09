import type { IDashboardResponse, IDashboardRun } from "@mosaic/api-contract";
import type { IDb } from "../db.js";
import { RUN_NOTE_TITLE_SQL } from "./runNoteTitle.js";

interface ICountRow {
    count: number | string;
}

interface IRunCountRow {
    total: number | string;
    active: number | string;
}

interface IRecentRunRow {
    id: string;
    status: IDashboardRun["status"];
    created_at: Date | string;
    dataset_id: string;
    dataset_name: string;
    models: string[] | null;
    total: number | string;
    done: number | string;
    failed: number | string;
    pending: number | string;
    note_title?: string | null;
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
    ] = await Promise.all([
        countActiveDatasets(db, teamId, projectId),
        countPrompts(db, teamId, projectId),
        countRuns(db, teamId, projectId),
        countDatasetsWithSchemas(db, teamId, projectId),
        countDatasetsWithItems(db, teamId, projectId),
        listRecentRuns(db, teamId, projectId, limit),
    ]);

    return {
        stats: {
            datasetCount,
            promptCount,
            runCount: runCounts.total,
            runningCount: runCounts.active,
            hasDatasetWithSchema: schemaCount > 0,
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
        from runs
        where team_id = $1 and project_id = $2`,
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

async function listRecentRuns(
    db: IDb,
    teamId: string,
    projectId: string,
    limit: number,
): Promise<IDashboardRun[]> {
    const result = await db.query<IRecentRunRow>(
        `select
            r.id,
            r.status,
            r.created_at,
            r.dataset_id,
            d.name as dataset_name,
            coalesce(
                array_remove(array_agg(distinct rm.model_id order by rm.model_id), null),
                array[]::text[]
            ) as models,
            count(distinct rc.id)::int as total,
            count(distinct rc.id) filter (where rc.status in ('succeeded', 'cached'))::int as done,
            count(distinct rc.id) filter (where rc.status = 'failed')::int as failed,
            count(distinct rc.id) filter (where rc.status in ('pending', 'running'))::int as pending,
            ${RUN_NOTE_TITLE_SQL} as note_title
        from runs r
        inner join datasets d on d.id = r.dataset_id
        left join run_models rm on rm.run_id = r.id
        left join run_cells rc on rc.run_id = r.id
        where r.team_id = $1 and r.project_id = $2
        group by r.id, r.status, r.created_at, r.dataset_id, d.name
        order by r.created_at desc
        limit $3`,
        [teamId, projectId, limit],
    );

    return result.rows.map((row) => ({
        id: row.id,
        status: row.status,
        createdAt:
            row.created_at instanceof Date
                ? row.created_at.toISOString()
                : new Date(row.created_at).toISOString(),
        datasetId: row.dataset_id,
        datasetName: row.dataset_name,
        models: row.models ?? [],
        progress: {
            total: rowCount(row, "total"),
            done: rowCount(row, "done"),
            failed: rowCount(row, "failed"),
            pending: rowCount(row, "pending"),
        },
        ...(row.note_title ? { noteTitle: row.note_title } : {}),
    }));
}

function rowCount(row: unknown, key = "count"): number {
    if (!row || typeof row !== "object") return 0;
    const value = (row as Record<string, unknown>)[key];
    return typeof value === "number" ? value : Number(value ?? 0);
}
