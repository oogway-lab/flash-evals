import process from "node:process";
import pg from "pg";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");

const pool = new Pool({ connectionString: databaseUrl });
try {
    // Build the replacement indexes outside a transaction so large production
    // tables do not hold a table-wide write lock during index construction.
    await pool.query(
        `create unique index concurrently if not exists workflow_runs_project_id_id_uq
         on workflow_runs (project_id, id)`,
    );
    await pool.query(
        `create unique index concurrently if not exists workflow_runs_project_workflow_idempotency_uq
         on workflow_runs (project_id, workflow_id, idempotency_key)`,
    );
    await pool.query("begin");
    await pool.query(
        `alter table workflow_runs
         drop constraint if exists workflow_runs_project_id_id_unique`,
    );
    await pool.query(
        `alter table workflow_runs
         add constraint workflow_runs_project_id_id_unique
         unique using index workflow_runs_project_id_id_uq`,
    );
    await pool.query(
        `alter table workflow_runs
         drop constraint if exists workflow_runs_project_workflow_idempotency_unique`,
    );
    await pool.query(
        `alter table workflow_runs
         add constraint workflow_runs_project_workflow_idempotency_unique
         unique using index workflow_runs_project_workflow_idempotency_uq`,
    );
    await pool.query("commit");
} catch (error) {
    await pool.query("rollback").catch(() => undefined);
    throw error;
} finally {
    await pool.end();
}
