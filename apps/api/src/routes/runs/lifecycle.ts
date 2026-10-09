import type {
    IRunLifecycleRequest,
    IRunProgressResponse,
    ISaveCellAnnotationRequest,
    ISaveRunNoteRequest,
    ReviewVerdict,
    RunStatus,
} from "@mosaic/api-contract";
import type { IDb } from "../../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../../errors.js";

interface IRunRow {
    status: RunStatus;
}

interface IRunTeamForCellRow {
    run_id: string;
    team_id: string;
    project_id: string;
}

interface IProgressRow {
    status: "pending" | "running" | "succeeded" | "failed" | "cached";
    count: number | string;
}

export async function runProgressPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
): Promise<IRunProgressResponse> {
    const run = await getTeamRun(db, teamId, projectId, runId);
    if (!run) throw new ApiNotFoundError();
    return {
        status: run.status,
        ...(await progressPayloadForRun(db, runId)),
    };
}

export async function saveRunNotePayload(
    db: IDb,
    input: ISaveRunNoteRequest,
): Promise<void> {
    const run = await getTeamRun(db, input.teamId, input.projectId, input.runId);
    if (!run) throw new ApiNotFoundError();
    await db.query(
        `insert into run_notes (run_id, body, updated_by, updated_at)
        values ($1, $2, $3, now())
        on conflict (run_id) do update set
            body = excluded.body,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [input.runId, input.body, input.updatedBy],
    );
}

export async function saveCellAnnotationPayload(
    db: IDb,
    input: ISaveCellAnnotationRequest,
): Promise<{ runId: string }> {
    if (!isReviewVerdict(input.verdict)) {
        throw new ApiBadRequestError("Invalid review verdict");
    }
    const result = await db.query<IRunTeamForCellRow>(
        `select r.id as run_id, r.team_id, r.project_id
        from run_cells rc
        inner join runs r on rc.run_id = r.id
        where rc.id = $1
        limit 1`,
        [input.runCellId],
    );
    const row = result.rows[0];
    if (
        !row ||
        row.team_id !== input.teamId ||
        row.project_id !== input.projectId
    ) throw new ApiNotFoundError();

    await db.query(
        `insert into run_cell_annotations (
            run_cell_id,
            verdict,
            comment,
            updated_by,
            updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (run_cell_id) do update set
            verdict = excluded.verdict,
            comment = excluded.comment,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [input.runCellId, input.verdict, input.comment, input.updatedBy],
    );
    return { runId: row.run_id };
}

export async function deleteRunPayload(
    db: IDb,
    input: IRunLifecycleRequest,
): Promise<void> {
    const run = await getTeamRun(db, input.teamId, input.projectId, input.runId);
    if (!run) throw new ApiNotFoundError();

    const cells = await db.query<{ id: string }>(
        `select id
        from run_cells
        where run_id = $1`,
        [input.runId],
    );
    const cellIds = cells.rows.map((cell) => cell.id);
    if (cellIds.length > 0) {
        await db.query(
            `delete from cell_scores
            where run_cell_id = any($1::uuid[])`,
            [cellIds],
        );
        await db.query(
            `delete from run_cell_annotations
            where run_cell_id = any($1::uuid[])`,
            [cellIds],
        );
    }
    await db.query("delete from run_notes where run_id = $1", [input.runId]);
    await db.query("delete from run_cells where run_id = $1", [input.runId]);
    await db.query("delete from run_models where run_id = $1", [input.runId]);
    await db.query("delete from runs where id = $1 and team_id = $2 and project_id = $3", [
        input.runId,
        input.teamId,
        input.projectId,
    ]);
}

export async function retryRunPayload(
    db: IDb,
    input: IRunLifecycleRequest,
): Promise<void> {
    const run = await getTeamRun(db, input.teamId, input.projectId, input.runId);
    if (!run) throw new ApiNotFoundError();
}

async function getTeamRun(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
): Promise<IRunRow | undefined> {
    const result = await db.query<IRunRow>(
        "select status from runs where id = $1 and team_id = $2 and project_id = $3 limit 1",
        [runId, teamId, projectId],
    );
    return result.rows[0];
}

async function progressPayloadForRun(
    db: IDb,
    runId: string,
): Promise<{ total: number; done: number; failed: number; pending: number }> {
    const progressResult = await db.query<IProgressRow>(
        `select status, count(*)::int as count
        from run_cells
        where run_id = $1
        group by status`,
        [runId],
    );
    let total = 0;
    let done = 0;
    let failed = 0;
    for (const row of progressResult.rows) {
        const count = typeof row.count === "number" ? row.count : Number(row.count);
        total += count;
        if (row.status === "succeeded" || row.status === "cached") done += count;
        else if (row.status === "failed") failed += count;
    }
    return { total, done, failed, pending: total - done - failed };
}

const REVIEW_VERDICTS = new Set<string>([
    "unreviewed",
    "approved",
    "needs_review",
    "issue",
]);

function isReviewVerdict(value: string): value is ReviewVerdict {
    return REVIEW_VERDICTS.has(value);
}
