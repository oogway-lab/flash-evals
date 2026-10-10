import { Pool, type PoolClient } from "pg";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type PilotTeamBootstrapResult = "created" | "already-exists";

export async function bootstrapPilotTeam(
    client: Pick<PoolClient, "query">,
    teamId: string,
    teamName: string,
): Promise<PilotTeamBootstrapResult> {
    if (!UUID_PATTERN.test(teamId)) {
        throw new Error("MOSAIC_DEFAULT_TEAM_ID must be a UUID");
    }
    if (!teamName.trim()) {
        throw new Error("MOSAIC_DEFAULT_TEAM_NAME must not be empty");
    }

    await client.query("BEGIN");
    try {
        const table = await client.query(
            "SELECT to_regclass('public.teams') AS table_name",
        );
        if (!table.rows[0]?.table_name) {
            throw new Error(
                "The teams table is missing; run the reviewed migrations first",
            );
        }

        await client.query(
            "LOCK TABLE public.teams IN SHARE ROW EXCLUSIVE MODE",
        );
        const existing = await client.query(
            "SELECT id::text AS id, name FROM public.teams WHERE id = $1",
            [teamId],
        );
        if (existing.rows.length > 0) {
            if (existing.rows[0]?.name !== teamName) {
                throw new Error(
                    "The configured team ID already exists with a different name",
                );
            }
        }

        const otherTeams = await client.query(
            "SELECT id FROM public.teams WHERE id <> $1 LIMIT 1",
            [teamId],
        );
        if (otherTeams.rows.length > 0) {
            throw new Error(
                "The teams table contains another team; refusing to bootstrap",
            );
        }

        if (existing.rows.length > 0) {
            await client.query("COMMIT");
            return "already-exists";
        }

        await client.query(
            "INSERT INTO public.teams (id, name) VALUES ($1, $2)",
            [teamId, teamName],
        );
        await client.query("COMMIT");
        return "created";
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
}

async function main(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL is not set");

    const teamId = process.env.MOSAIC_DEFAULT_TEAM_ID?.trim();
    if (!teamId) throw new Error("MOSAIC_DEFAULT_TEAM_ID is not set");

    const teamName =
        process.env.MOSAIC_DEFAULT_TEAM_NAME?.trim() || "Oogway Labs";
    const pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
    });

    try {
        const client = await pool.connect();
        try {
            const result = await bootstrapPilotTeam(client, teamId, teamName);
            console.info(
                result === "created"
                    ? "Created the configured pilot team."
                    : "The configured pilot team already exists; no changes were made.",
            );
        } finally {
            client.release();
        }
    } finally {
        await pool.end();
    }
}

if (process.argv[1]?.endsWith("bootstrap-pilot-team.ts")) {
    void main().catch(() => {
        console.error(
            "Pilot-team bootstrap failed. Check DATABASE_URL, migrations, team ID, and team name.",
        );
        process.exitCode = 1;
    });
}
