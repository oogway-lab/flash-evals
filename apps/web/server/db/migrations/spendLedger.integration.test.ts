import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.FLASH_EVALS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

const MIGRATION_PATH = path.join(
    process.cwd(),
    "server/db/migrations/0081_spend_ledger.sql",
);

integration("spend ledger migration (0081)", () => {
    let pool: Pool;
    let schema: string;
    const team = randomUUID();
    const run = randomUUID();
    const workflowRun = randomUUID();
    const oldCell = randomUUID();

    beforeAll(async () => {
        if (!databaseUrl) return;
        if (!new URL(databaseUrl).pathname.includes("test"))
            throw new Error(
                "FLASH_EVALS_TEST_DATABASE_URL must point to a disposable database with 'test' in its name.",
            );
        schema = `spend_ledger_${randomUUID().replace(/-/g, "")}`;
        const url = new URL(databaseUrl);
        url.searchParams.set("options", `-csearch_path=${schema}`);
        pool = new Pool({ connectionString: url.toString(), max: 1 });
        await pool.query(`create schema ${schema}`);
        // Only the columns the migration reads.
        await pool.query(`
            create table teams (id uuid primary key);
            create table runs (
                id uuid primary key, team_id uuid not null,
                created_at timestamptz not null default now()
            );
            create table run_cells (
                id uuid primary key, run_id uuid not null,
                status text not null default 'pending',
                cost_usd double precision, judge_cost_usd double precision,
                incurred_cost_usd double precision
            );
            create table workflow_runs (
                id uuid primary key, team_id uuid not null,
                created_at timestamptz not null default now()
            );
            create table workflow_run_cells (
                id uuid primary key, workflow_run_id uuid not null,
                cost_usd double precision, judge_cost_usd double precision
            );
            create table workflow_run_answers (
                id uuid primary key, workflow_run_id uuid not null,
                judge_cost_usd double precision
            );
            create table workflow_run_items (
                id uuid primary key, workflow_run_id uuid not null,
                incurred_cost_usd double precision
            );
        `);
        await pool.query("insert into teams (id) values ($1)", [team]);
        await pool.query(
            `insert into runs (id, team_id, created_at)
            values ($1, $2, now() - interval '3 days')`,
            [run, team],
        );
        await pool.query(
            "insert into workflow_runs (id, team_id) values ($1, $2)",
            [workflowRun, team],
        );
        // Spend from before the ledger: $40 in a run started three days ago.
        await pool.query(
            `insert into run_cells (id, run_id, status, cost_usd, incurred_cost_usd)
            values ($1, $2, 'succeeded', 40, 40)`,
            [oldCell, run],
        );
        const migration = (await readFile(MIGRATION_PATH, "utf8"))
            .split('"public".')
            .join("");
        for (const statement of migration.split("--> statement-breakpoint"))
            if (statement.trim()) await pool.query(statement);
    });

    afterAll(async () => {
        if (!pool) return;
        await pool.query(`drop schema if exists ${schema} cascade`);
        await pool.end();
    });

    async function paidToday(): Promise<number> {
        const result = await pool.query<{ spent: number }>(
            `select coalesce(sum(amount_usd), 0)::float8 as spent
            from spend_ledger
            where team_id = $1 and paid_at > now() - interval '24 hours'`,
            [team],
        );
        return result.rows[0]!.spent;
    }

    it("dates earlier spend as it was paid", async () => {
        const result = await pool.query(
            `select amount_usd, paid_at < now() - interval '2 days' as old
            from spend_ledger where source_id = $1`,
            [oldCell],
        );
        expect(result.rows).toEqual([{ amount_usd: 40, old: true }]);
    });

    it("counts only what a later pass adds, when it is paid", async () => {
        // A re-judge today adds $0.05 to a cell whose $40 was paid earlier.
        await pool.query(
            "update run_cells set judge_cost_usd = coalesce(judge_cost_usd, 0) + 0.05 where id = $1",
            [oldCell],
        );
        // An update that does not add spend records nothing.
        await pool.query(
            "update run_cells set status = 'cached' where id = $1",
            [oldCell],
        );
        expect(await paidToday()).toBeCloseTo(0.05);
    });

    it("records pipeline steps, judges and shared transcription", async () => {
        const before = await paidToday();
        const cell = randomUUID();
        await pool.query(
            "insert into workflow_run_cells (id, workflow_run_id) values ($1, $2)",
            [cell, workflowRun],
        );
        await pool.query(
            "update workflow_run_cells set cost_usd = 0.2, judge_cost_usd = 0.01 where id = $1",
            [cell],
        );
        // Lowered (a skipped step's 0): nothing to record.
        await pool.query(
            "update workflow_run_cells set cost_usd = 0 where id = $1",
            [cell],
        );
        await pool.query(
            `insert into workflow_run_answers (id, workflow_run_id, judge_cost_usd)
            values ($1, $2, 0.03)`,
            [randomUUID(), workflowRun],
        );
        const item = randomUUID();
        await pool.query(
            `insert into workflow_run_items (id, workflow_run_id, incurred_cost_usd)
            values ($1, $2, 0.1)`,
            [item, workflowRun],
        );
        await pool.query(
            "update workflow_run_items set incurred_cost_usd = 0.15 where id = $1",
            [item],
        );
        expect((await paidToday()) - before).toBeCloseTo(0.39);
    });
});
