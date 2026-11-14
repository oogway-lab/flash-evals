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
} from "vitest";
import { assertTeamSpendUnderCap } from "./runLimits.js";

// Session-local tables exercise the real cap SQL without touching application data.
const databaseUrl = process.env.FLASH_EVALS_TEST_DATABASE_URL;
describe.skipIf(!databaseUrl)("team daily spend cap (PostgreSQL)", () => {
    const client = new pg.Client({ connectionString: databaseUrl });
    const teamId = randomUUID();
    beforeAll(async () => {
        await client.connect();
    });
    afterAll(async () => {
        await client.end();
    });
    beforeEach(async () => {
        await client.query("begin");
        await client.query(`
            create temporary table spend_ledger (team_id uuid, source_table text, source_id uuid, kind text, amount_usd float8, paid_at timestamptz);
        `);
    });
    afterEach(async () => {
        await client.query("rollback");
    });

    it("counts a re-judge today without the cell's spend from days ago", async () => {
        const cellId = randomUUID();
        // A cell's $40 paid three days ago; a $0.05 re-judge today.
        await client.query(
            `insert into spend_ledger values
                ($1, 'run_cells', $2, 'call', 40, now() - interval '3 days'),
                ($1, 'run_cells', $2, 'judge', 0.05, now())`,
            [teamId, cellId],
        );

        await expect(
            assertTeamSpendUnderCap(client, teamId, 10),
        ).resolves.toBeUndefined();
        await expect(
            assertTeamSpendUnderCap(client, teamId, 0.05),
        ).rejects.toThrow("has spent $0.05 in the last 24 hours");
    });
});
