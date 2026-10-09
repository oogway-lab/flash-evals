import type {
    ICreateWorkspaceRequest,
    IListWorkspacesResponse,
    IUpdateWorkspaceRequest,
    IWorkspace,
} from "@mosaic/api-contract";
import type { IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../errors.js";

interface IWorkspaceRow {
    id: string;
    team_id: string;
    name: string;
    owner_user_id: string | null;
    created_at: Date | string;
}

export async function listWorkspacesPayload(
    db: IDb,
    teamId: string,
): Promise<IListWorkspacesResponse> {
    const result = await db.query<IWorkspaceRow>(
        `select id, team_id, name, owner_user_id, created_at
        from workspaces
        where team_id = $1
        order by created_at, id`,
        [teamId],
    );
    return result.rows.map(workspaceFromRow);
}

export async function createWorkspacePayload(
    db: IDb,
    input: ICreateWorkspaceRequest,
): Promise<IWorkspace> {
    const name = requiredName(input.name, "Workspace");
    try {
        const result = await db.query<IWorkspaceRow>(
            `insert into workspaces (team_id, name, owner_user_id)
            select $1, $2, u.id
            from users u
            where u.id = $3 and u.team_id = $1
            returning id, team_id, name, owner_user_id, created_at`,
            [input.teamId, name, input.createdBy],
        );
        const workspace = result.rows[0];
        if (!workspace) {
            throw new ApiNotFoundError(
                "Workspace creator was not found in this tenant.",
            );
        }
        return workspaceFromRow(workspace);
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new ApiConflictError(
                "A workspace with this name already exists.",
            );
        }
        throw error;
    }
}

export async function updateWorkspacePayload(
    db: IDb,
    input: IUpdateWorkspaceRequest,
): Promise<IWorkspace> {
    const name = requiredName(input.name, "Workspace");
    try {
        const result = await db.query<IWorkspaceRow>(
            `update workspaces w
            set name = $1
            from users u
            where w.id = $2 and w.team_id = $3
              and u.id = $4 and u.team_id = w.team_id
            returning w.id, w.team_id, w.name, w.owner_user_id, w.created_at`,
            [name, input.workspaceId, input.teamId, input.updatedBy],
        );
        const workspace = result.rows[0];
        if (!workspace)
            throw new ApiNotFoundError(
                "Workspace was not found in this tenant.",
            );
        return workspaceFromRow(workspace);
    } catch (error) {
        if (isUniqueViolation(error)) {
            throw new ApiConflictError(
                "A workspace with this name already exists.",
            );
        }
        throw error;
    }
}

export function workspaceFromRow(row: IWorkspaceRow): IWorkspace {
    return {
        id: row.id,
        teamId: row.team_id,
        name: row.name,
        ...(row.owner_user_id ? { ownerUserId: row.owner_user_id } : {}),
        createdAt:
            row.created_at instanceof Date
                ? row.created_at.toISOString()
                : new Date(row.created_at).toISOString(),
    };
}

function requiredName(value: string, label: string): string {
    const name = value.trim();
    if (!name) throw new ApiBadRequestError(`${label} name is required.`);
    if (name.length > 120)
        throw new ApiBadRequestError(
            `${label} name must be 120 characters or fewer.`,
        );
    return name;
}

function isUniqueViolation(error: unknown): boolean {
    return Boolean(
        error &&
        typeof error === "object" &&
        "code" in error &&
        (error as { code?: string }).code === "23505",
    );
}
