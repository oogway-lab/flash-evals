import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type * as RunStop from "./runStop";

const databaseUrl = process.env.FLASH_EVALS_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

integration("run spend for the per-run limit", () => {
    let pool: Pool;
    let schema: string;
    let runStop: typeof RunStop;
    let originalDatabaseUrl: string | undefined;

    beforeAll(async () => {
        if (!databaseUrl) return;
        if (!new URL(databaseUrl).pathname.includes("test"))
            throw new Error(
                "FLASH_EVALS_TEST_DATABASE_URL must point to a disposable database with 'test' in its name.",
            );
        pool = new Pool({ connectionString: databaseUrl, max: 1 });
        schema = `run_spend_${randomUUID().replace(/-/g, "")}`;
        await pool.query(`create schema ${schema}`);
        await pool.query(`
            create table ${schema}.run_cells (
                id uuid primary key,
                run_id uuid not null,
                status text not null,
                cost_usd double precision,
                judge_cost_usd double precision,
                incurred_cost_usd double precision
            );
        `);
        const url = new URL(databaseUrl);
        url.searchParams.set("options", `-csearch_path=${schema},public`);
        originalDatabaseUrl = process.env.DATABASE_URL;
        process.env.DATABASE_URL = url.toString();
        runStop = await import("./runStop");
    });

    afterAll(async () => {
        const { closeDatabasePool } = await import("../db/client");
        await closeDatabasePool();
        if (pool) {
            await pool.query(`drop schema if exists ${schema} cascade`);
            await pool.end();
        }
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = originalDatabaseUrl;
    });

    it("counts paid model calls and every judge call, not cache hits", async () => {
        const runId = randomUUID();
        const rows: Array<[string, number | null, number | null]> = [
            ["succeeded", 0.5, 0.1],
            ["failed", 0.2, null],
            // A cache hit: its model cost was paid by an earlier run, but
            // judging it here was paid now.
            ["cached", 0.5, 0.05],
            ["pending", null, null],
        ];
        for (const [status, cost, judgeCost] of rows)
            await pool.query(
                `insert into ${schema}.run_cells (id, run_id, status, cost_usd, judge_cost_usd)
                 values ($1, $2, $3, $4, $5)`,
                [randomUUID(), runId, status, cost, judgeCost],
            );
        await pool.query(
            `insert into ${schema}.run_cells (id, run_id, status, cost_usd)
             values ($1, $2, 'succeeded', 9)`,
            [randomUUID(), randomUUID()],
        );

        await expect(runStop.readRunSpendUsd(runId)).resolves.toBeCloseTo(0.85);
        await expect(runStop.readRunSpendUsd(randomUUID())).resolves.toBe(0);
    });

    it("counts what a cell paid when that is recorded, not its list cost", async () => {
        const runId = randomUUID();
        // A transcript reused from the cache: list cost 0.4, paid nothing.
        await pool.query(
            `insert into ${schema}.run_cells (id, run_id, status, cost_usd, incurred_cost_usd)
             values ($1, $2, 'succeeded', 0.4, 0), ($3, $2, 'cached', 0.3, 0.02)`,
            [randomUUID(), runId, randomUUID()],
        );

        await expect(runStop.readRunSpendUsd(runId)).resolves.toBeCloseTo(0.02);
    });
});
