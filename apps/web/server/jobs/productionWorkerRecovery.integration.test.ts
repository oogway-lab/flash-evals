import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import type * as RunQueue from "./runQueue";
import type * as WorkflowRunQueue from "./workflowRunQueue";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
    executeRun: vi.fn(async (_runId: string): Promise<void> => undefined),
    executeWorkflowRun: vi.fn(
        async (_runId: string): Promise<void> => undefined,
    ),
}));

vi.mock("../runs/executor", () => ({ executeRun: mocks.executeRun }));
vi.mock("../workflowRuns/executor", () => ({
    executeWorkflowRun: mocks.executeWorkflowRun,
}));

const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

integration("production worker wrappers recover real stale cells", () => {
    let pool: Pool;
    let schema: string;
    let originalDatabaseUrl: string | undefined;
    let originalRunLease: string | undefined;
    let originalWorkflowLease: string | undefined;
    let runQueue: typeof RunQueue | undefined;
    let workflowRunQueue: typeof WorkflowRunQueue | undefined;
    let evalRunId: string | undefined;
    let workflowRunId: string | undefined;

    beforeAll(async () => {
        if (!databaseUrl) return;
        const databaseName = new URL(databaseUrl).pathname.slice(1);
        if (!databaseName.includes("test")) {
            throw new Error(
                "MOSAIC_TEST_DATABASE_URL must point to a disposable database with 'test' in its name.",
            );
        }
        originalDatabaseUrl = process.env.DATABASE_URL;
        originalRunLease = process.env.RUN_STALE_CLAIM_MS;
        originalWorkflowLease = process.env.WORKFLOW_STALE_CLAIM_MS;
        process.env.RUN_STALE_CLAIM_MS = "60000";
        process.env.WORKFLOW_STALE_CLAIM_MS = "60000";
        pool = new Pool({ connectionString: databaseUrl, max: 2 });
        schema = `worker_recovery_${randomUUID().replace(/-/g, "")}`;
        await pool.query(`create schema ${schema}`);
        await pool.query(`
            create table ${schema}.runs (
                id uuid primary key,
                status text not null
            );
            create table ${schema}.run_cells (
                id uuid primary key,
                run_id uuid not null,
                status text not null,
                claimed_at timestamptz
            );
            create table ${schema}.workflow_runs (
                id uuid primary key,
                status text not null
            );
            create table ${schema}.workflow_run_cells (
                id uuid primary key,
                workflow_run_id uuid not null,
                status text not null,
                claimed_at timestamptz
            );
        `);

        const applicationUrl = new URL(databaseUrl);
        applicationUrl.searchParams.set(
            "options",
            `-csearch_path=${schema},public`,
        );
        process.env.DATABASE_URL = applicationUrl.toString();
        runQueue = await import("./runQueue");
        workflowRunQueue = await import("./workflowRunQueue");
    });

    afterEach(async () => {
        await runQueue?.stopRunWorker(1_500).catch(() => undefined);
        await workflowRunQueue
            ?.stopWorkflowRunWorker(1_500)
            .catch(() => undefined);
        if (!pool) return;

        if (evalRunId) {
            await pool.query(
                `delete from pgboss.job where name = 'eval-run' and data->>'runId' = $1`,
                [evalRunId],
            );
            await pool.query(
                `delete from ${schema}.run_cells where run_id = $1`,
                [evalRunId],
            );
            await pool.query(`delete from ${schema}.runs where id = $1`, [
                evalRunId,
            ]);
        }
        if (workflowRunId) {
            await pool.query(
                `delete from pgboss.job where name = 'workflow-run' and data->>'workflowRunId' = $1`,
                [workflowRunId],
            );
            await pool.query(
                `delete from ${schema}.workflow_run_cells where workflow_run_id = $1`,
                [workflowRunId],
            );
            await pool.query(
                `delete from ${schema}.workflow_runs where id = $1`,
                [workflowRunId],
            );
        }
        evalRunId = undefined;
        workflowRunId = undefined;
        mocks.executeRun.mockReset().mockResolvedValue(undefined);
        mocks.executeWorkflowRun.mockReset().mockResolvedValue(undefined);
    });

    afterAll(async () => {
        await runQueue?.stopRunWorker(1_000).catch(() => undefined);
        await workflowRunQueue
            ?.stopWorkflowRunWorker(1_000)
            .catch(() => undefined);
        const { closeDatabasePool } = await import("../db/client");
        await closeDatabasePool();
        if (pool) {
            await pool.query(`drop schema if exists ${schema} cascade`);
            await pool.end();
        }
        if (originalDatabaseUrl === undefined) {
            delete process.env.DATABASE_URL;
        } else {
            process.env.DATABASE_URL = originalDatabaseUrl;
        }
        if (originalRunLease === undefined) {
            delete process.env.RUN_STALE_CLAIM_MS;
        } else {
            process.env.RUN_STALE_CLAIM_MS = originalRunLease;
        }
        if (originalWorkflowLease === undefined) {
            delete process.env.WORKFLOW_STALE_CLAIM_MS;
        } else {
            process.env.WORKFLOW_STALE_CLAIM_MS = originalWorkflowLease;
        }
    });

    it("replays one stale eval cell through the production queue after restart", async () => {
        if (!runQueue) throw new Error("The eval queue module did not load.");
        evalRunId = randomUUID();
        const runCellId = randomUUID();
        await pool.query(
            `insert into ${schema}.runs (id, status) values ($1, 'running')`,
            [evalRunId],
        );
        await pool.query(
            `insert into ${schema}.run_cells (id, run_id, status, claimed_at)
             values ($1, $2, 'running', now() - interval '1 day')`,
            [runCellId, evalRunId],
        );

        const providerStarted = deferred<void>();
        const releaseProvider = deferred<void>();
        const paidProvider = vi.fn(async () => {
            providerStarted.resolve();
            await releaseProvider.promise;
        });
        mocks.executeRun.mockImplementation(async (runId) => {
            await pool.query(
                `update ${schema}.run_cells set status = 'running', claimed_at = now() where run_id = $1`,
                [runId],
            );
            await paidProvider();
            await pool.query(
                `update ${schema}.run_cells set status = 'succeeded', claimed_at = null where run_id = $1`,
                [runId],
            );
            await pool.query(
                `update ${schema}.runs set status = 'completed' where id = $1`,
                [runId],
            );
        });

        await runQueue.startRunWorker();
        await providerStarted.promise;
        const recovered = await pool.query<{
            count: number;
            status: string;
            claimed_at: Date;
        }>(
            `select count(*) over ()::int as count, status, claimed_at
             from ${schema}.run_cells where id = $1`,
            [runCellId],
        );
        expect(recovered.rows[0]).toMatchObject({
            count: 1,
            status: "running",
        });
        expect(recovered.rows[0]?.claimed_at.getTime()).toBeGreaterThan(
            Date.now() - 10_000,
        );
        const jobs = await pool.query<{ count: number }>(
            `select count(*)::int as count from pgboss.job
             where name = 'eval-run' and data->>'runId' = $1`,
            [evalRunId],
        );
        expect(jobs.rows[0]?.count).toBe(1);

        const stopping = runQueue.stopRunWorker(5_000);
        releaseProvider.resolve();
        await stopping;
        const completed = await pool.query<{ status: string }>(
            `select status from ${schema}.runs where id = $1`,
            [evalRunId],
        );
        expect(completed.rows[0]?.status).toBe("completed");
        expect(paidProvider).toHaveBeenCalledOnce();

        await runQueue.startRunWorker();
        const afterRestart = await pool.query<{ count: number }>(
            `select count(*)::int as count from pgboss.job
             where name = 'eval-run' and data->>'runId' = $1`,
            [evalRunId],
        );
        expect(afterRestart.rows[0]?.count).toBe(1);
        expect(paidProvider).toHaveBeenCalledOnce();
    });

    it("replays one stale workflow cell through the production queue after restart", async () => {
        if (!workflowRunQueue)
            throw new Error("The workflow queue module did not load.");
        workflowRunId = randomUUID();
        const workflowCellId = randomUUID();
        await pool.query(
            `insert into ${schema}.workflow_runs (id, status) values ($1, 'running')`,
            [workflowRunId],
        );
        await pool.query(
            `insert into ${schema}.workflow_run_cells (id, workflow_run_id, status, claimed_at)
             values ($1, $2, 'running', now() - interval '1 day')`,
            [workflowCellId, workflowRunId],
        );

        const providerStarted = deferred<void>();
        const releaseProvider = deferred<void>();
        const paidProvider = vi.fn(async () => {
            providerStarted.resolve();
            await releaseProvider.promise;
        });
        mocks.executeWorkflowRun.mockImplementation(async (runId) => {
            await pool.query(
                `update ${schema}.workflow_run_cells set status = 'running', claimed_at = now() where workflow_run_id = $1`,
                [runId],
            );
            await paidProvider();
            await pool.query(
                `update ${schema}.workflow_run_cells set status = 'succeeded', claimed_at = null where workflow_run_id = $1`,
                [runId],
            );
            await pool.query(
                `update ${schema}.workflow_runs set status = 'completed' where id = $1`,
                [runId],
            );
        });

        await workflowRunQueue.startWorkflowRunWorker();
        await providerStarted.promise;
        const recovered = await pool.query<{
            count: number;
            status: string;
            claimed_at: Date;
        }>(
            `select count(*) over ()::int as count, status, claimed_at
             from ${schema}.workflow_run_cells where id = $1`,
            [workflowCellId],
        );
        expect(recovered.rows[0]).toMatchObject({
            count: 1,
            status: "running",
        });
        expect(recovered.rows[0]?.claimed_at.getTime()).toBeGreaterThan(
            Date.now() - 10_000,
        );
        const jobs = await pool.query<{ count: number }>(
            `select count(*)::int as count from pgboss.job
             where name = 'workflow-run' and data->>'workflowRunId' = $1`,
            [workflowRunId],
        );
        expect(jobs.rows[0]?.count).toBe(1);

        const stopping = workflowRunQueue.stopWorkflowRunWorker(5_000);
        releaseProvider.resolve();
        await stopping;
        const completed = await pool.query<{ status: string }>(
            `select status from ${schema}.workflow_runs where id = $1`,
            [workflowRunId],
        );
        expect(completed.rows[0]?.status).toBe("completed");
        expect(paidProvider).toHaveBeenCalledOnce();

        await workflowRunQueue.startWorkflowRunWorker();
        const afterRestart = await pool.query<{ count: number }>(
            `select count(*)::int as count from pgboss.job
             where name = 'workflow-run' and data->>'workflowRunId' = $1`,
            [workflowRunId],
        );
        expect(afterRestart.rows[0]?.count).toBe(1);
        expect(paidProvider).toHaveBeenCalledOnce();
    });
});
