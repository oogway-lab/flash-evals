import pg from "pg";
import { describe, expect, it } from "vitest";

const databaseUrl = process.env.MOSAIC_ROUTING_INTEGRATION_DATABASE_URL;

describe.skipIf(!databaseUrl)("routing persistence concurrency", () => {
    it("serializes same-key run creation across separate connections", async () => {
        const pool = new pg.Pool({ connectionString: databaseUrl });
        const schema = `routing_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        await pool.query(`create schema ${schema}`);
        await pool.query(`create table ${schema}.workflow_runs (
            id bigint generated always as identity primary key,
            project_id uuid not null,
            workflow_id uuid not null,
            idempotency_key text not null,
            idempotency_fingerprint text not null,
            unique (project_id, workflow_id, idempotency_key)
        )`);
        const clients = [await pool.connect(), await pool.connect()];
        try {
            await Promise.all(
                clients.map((client) =>
                    client.query(`set search_path to ${schema}`),
                ),
            );
            await Promise.all(clients.map((client) => client.query("begin")));
            const lock = `select pg_advisory_xact_lock(hashtextextended($1, 0))`;
            const first = clients[0]!.query(lock, ["project/workflow/key"]);
            await new Promise((resolve) => setTimeout(resolve, 20));
            let secondAcquired = false;
            const second = clients[1]!
                .query(lock, ["project/workflow/key"])
                .then(() => {
                    secondAcquired = true;
                });
            await first;
            await clients[0]!.query(
                `insert into workflow_runs (project_id, workflow_id, idempotency_key, idempotency_fingerprint)
                 values ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', 'key', 'fingerprint')`,
            );
            await clients[0]!.query("commit");
            await second;
            expect(secondAcquired).toBe(true);
            const rows = await pool.query(
                `select count(*)::int as count from ${schema}.workflow_runs`,
            );
            expect(rows.rows[0]?.count).toBe(1);
            await clients[1]!.query("commit");
        } finally {
            for (const client of clients) client.release();
            await pool.query(`drop schema ${schema} cascade`);
            await pool.end();
        }
    });

    it("keeps exact-reuse uniqueness scoped to the project", async () => {
        const pool = new pg.Pool({ connectionString: databaseUrl });
        const schema = `reuse_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
        await pool.query(`create schema ${schema}`);
        await pool.query(`create table ${schema}.workflow_exact_reuse (
            project_id uuid not null,
            fingerprint text not null,
            response jsonb not null,
            unique (project_id, fingerprint)
        )`);
        const clients = [await pool.connect(), await pool.connect()];
        try {
            await Promise.all(
                clients.map((client) =>
                    client.query(`set search_path to ${schema}`),
                ),
            );
            const inserts = clients.map((client) =>
                client.query(
                    `insert into workflow_exact_reuse (project_id, fingerprint, response)
                 values ('00000000-0000-4000-8000-000000000001', 'same', '{}'::jsonb)
                 on conflict (project_id, fingerprint) do nothing`,
                ),
            );
            await Promise.all(inserts);
            const result = await pool.query(
                `select count(*)::int as count from ${schema}.workflow_exact_reuse`,
            );
            expect(result.rows[0]?.count).toBe(1);
        } finally {
            for (const client of clients) client.release();
            await pool.query(`drop schema ${schema} cascade`);
            await pool.end();
        }
    });
});
