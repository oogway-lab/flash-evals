import type { IDb } from "../db.js";
import { ApiNotFoundError } from "../errors.js";

export async function assertProjectInTeam(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<void> {
    const result = await db.query<{ id: string }>(
        `select id from projects where id = $1 and team_id = $2 limit 1`,
        [projectId, teamId],
    );
    if (!result.rows[0]) throw new ApiNotFoundError("Project not found.");
}
