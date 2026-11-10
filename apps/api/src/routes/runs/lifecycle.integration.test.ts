import { randomUUID } from "node:crypto";
import pg from "pg";
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { cancelRunPayload } from "./lifecycle.js";

// Session-local tables exercise the real lease SQL without touching application data.
const databaseUrl = process.env.FLASH_EVALS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("eval run lease liveness (PostgreSQL)", () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const input = {
        teamId: randomUUID(),
        projectId: randomUUID(),
        runId: randomUUID(),
    };
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        await client.end();
    });
    beforeEach(async () => {
        await client.query("begin");
        await client.query(`
            create temporary table runs (
                id uuid primary key, team_id uuid, project_id uuid,
                status text, stop_reason text, cancel_requested_at timestamptz,
                execution_lease_id uuid, execution_lease_at timestamptz,
                execution_lease_stale_ms integer
            );
        `);
    });
    afterEach(async () => {
        await client.query("rollback");
        vi.unstubAllEnvs();
    });

    it("judges a lease by the holding worker's stale window, not the API's", async () => {
        // The worker allows 15 minutes; its lease was refreshed 2 minutes ago.
        // The API is configured with a shorter window.
        vi.stubEnv("RUN_STALE_CLAIM_MS", "60000");
        await client.query(
            `insert into runs (id, team_id, project_id, status, execution_lease_id, execution_lease_at, execution_lease_stale_ms)
             values ($1, $2, $3, 'pending', $4, now() - interval '2 minutes', 900000)`,
            [input.runId, input.teamId, input.projectId, randomUUID()],
        );

        // A live pass: the cancel is left for the worker to act on.
        await expect(cancelRunPayload(client, input)).resolves.toMatchObject({
            status: "pending",
        });
    });

    it("falls back to the API's window for a lease stored without one", async () => {
        vi.stubEnv("RUN_STALE_CLAIM_MS", "60000");
        await client.query(
            `insert into runs (id, team_id, project_id, status, execution_lease_id, execution_lease_at)
             values ($1, $2, $3, 'pending', $4, now() - interval '2 minutes')`,
            [input.runId, input.teamId, input.projectId, randomUUID()],
        );

        await expect(cancelRunPayload(client, input)).resolves.toMatchObject({
            status: "cancelled",
        });
    });
});
