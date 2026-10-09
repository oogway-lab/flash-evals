import type {
    ICreateProjectRequest,
    IProject,
    IListProjectsResponse,
    IUpdateProjectRequest,
} from "@mosaic/api-contract";
import type { IDb } from "../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../errors.js";

interface IProjectRow {
    id: string;
    team_id: string;
    workspace_id: string;
    name: string;
    created_by: string | null;
    created_at: Date | string;
}

export async function listProjectsPayload(
    db: IDb,
    teamId: string,
    workspaceId?: string,
): Promise<IListProjectsResponse> {
    const result = await db.query<IProjectRow>(
        `select id, team_id, workspace_id, name, created_by, created_at
        from projects
        where team_id = $1 and ($2::uuid is null or workspace_id = $2)
        order by created_at, id`,
        [teamId, workspaceId ?? null],
    );
    return result.rows.map(projectFromRow);
}

export async function createProjectPayload(
    db: IDb,
    input: ICreateProjectRequest,
): Promise<IProject> {
    const name = input.name.trim();
    if (!name) throw new ApiBadRequestError("Project name is required.");
    if (name.length > 120) {
        throw new ApiBadRequestError(
            "Project name must be 120 characters or fewer.",
        );
    }
    const result = await db.query<IProjectRow>(
        `insert into projects (team_id, workspace_id, name, created_by)
        select $1, coalesce($2::uuid, u.default_workspace_id), $3, u.id
        from users u
        join workspaces w on w.id = coalesce($2::uuid, u.default_workspace_id) and w.team_id = u.team_id
        where u.id = $4 and u.team_id = $1
        returning id, team_id, workspace_id, name, created_by, created_at`,
        [
            input.teamId,
            input.workspaceId ?? null,
            name,
            input.createdBy ?? null,
        ],
    );
    const project = result.rows[0];
    if (!project) {
        throw new ApiNotFoundError(
            "Project creator was not found in this team.",
        );
    }
    return projectFromRow(project);
}

export async function updateProjectPayload(
    db: IDb,
    input: IUpdateProjectRequest,
): Promise<IProject> {
    const name = input.name.trim();
    if (!name) throw new ApiBadRequestError("Project name is required.");
    if (name.length > 120) {
        throw new ApiBadRequestError(
            "Project name must be 120 characters or fewer.",
        );
    }
    const result = await db.query<IProjectRow>(
        `update projects p
        set name = $1
        from users u
        join workspaces w on w.team_id = u.team_id
        where p.id = $2 and p.team_id = $4 and p.workspace_id = w.id
          and ($3::uuid is null or p.workspace_id = $3)
          and u.id = $5 and u.team_id = p.team_id
        returning p.id, p.team_id, p.workspace_id, p.name, p.created_by, p.created_at`,
        [
            name,
            input.projectId,
            input.workspaceId ?? null,
            input.teamId,
            input.updatedBy,
        ],
    );
    const project = result.rows[0];
    if (!project) {
        throw new ApiNotFoundError("Project was not found in this team.");
    }
    return projectFromRow(project);
}

function projectFromRow(row: IProjectRow): IProject {
    return {
        id: row.id,
        teamId: row.team_id,
        workspaceId: row.workspace_id,
        name: row.name,
        ...(row.created_by ? { createdBy: row.created_by } : {}),
        createdAt:
            row.created_at instanceof Date
                ? row.created_at.toISOString()
                : new Date(row.created_at).toISOString(),
    };
}
