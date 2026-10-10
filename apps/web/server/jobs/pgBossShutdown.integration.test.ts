import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import PgBoss from "pg-boss";
import {
    afterAll,
    afterEach,
    beforeAll,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;

function deferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

async function waitFor(
    predicate: () => Promise<boolean>,
    timeoutMs = 5_000,
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error("Timed out waiting for the queue state.");
}

integration("pg-boss shutdown and durable replay", () => {
    let pool: Pool;
    let worker: PgBoss;
    let publisher: PgBoss;
    let queueName: string;
    let testKey: string;

    beforeAll(async () => {
        if (!databaseUrl) return;
        const databaseName = new URL(databaseUrl).pathname.slice(1);
        if (!databaseName.includes("test")) {
            throw new Error(
                "MOSAIC_TEST_DATABASE_URL must point to a disposable database with 'test' in its name.",
            );
        }
        pool = new Pool({ connectionString: databaseUrl, max: 2 });
        await pool.query(`
            create table if not exists worker_shutdown_claims (
                task_key text primary key,
                status text not null,
                result_count integer not null default 0
            )
        `);
    });

    afterEach(async () => {
        if (!databaseUrl || !pool) return;
        await worker
            ?.stop({ graceful: true, timeout: 1_000 })
            .catch(() => undefined);
        await publisher?.deleteQueue(queueName).catch(() => undefined);
        await publisher?.stop().catch(() => undefined);
        await pool.query(
            "delete from worker_shutdown_claims where task_key = $1",
            [testKey],
        );
    });

    afterAll(async () => {
        await pool?.end();
    });

    async function setupQueue(): Promise<void> {
        queueName = `pilot-${randomUUID().replace(/-/g, "")}`;
        testKey = randomUUID();
        worker = new PgBoss({ connectionString: databaseUrl!, max: 1 });
        publisher = new PgBoss({ connectionString: databaseUrl!, max: 1 });
        worker.on("error", () => undefined);
        publisher.on("error", () => undefined);
        await worker.start();
        await publisher.start();
        await worker.createQueue(queueName);
        await publisher.createQueue(queueName);
    }

    async function executeClaimedTask(
        taskKey: string,
        paidProvider: () => Promise<void>,
    ): Promise<void> {
        const claimed = await pool.query(
            `update worker_shutdown_claims
             set status = 'running'
             where task_key = $1 and status = 'pending'
             returning task_key`,
            [taskKey],
        );
        if (claimed.rowCount === 0) return;
        await paidProvider();
        await pool.query(
            `update worker_shutdown_claims
             set status = 'succeeded', result_count = result_count + 1
             where task_key = $1 and status = 'running'`,
            [taskKey],
        );
    }

    it("stops polling, drains active work, and leaves newly queued work for restart", async () => {
        await setupQueue();
        const secondKey = randomUUID();
        await pool.query(
            "insert into worker_shutdown_claims (task_key, status) values ($1, 'pending'), ($2, 'pending')",
            [testKey, secondKey],
        );

        const providerStarted = deferred();
        const releaseProvider = deferred();
        const paidProvider = vi.fn(async () => {
            providerStarted.resolve();
            await releaseProvider.promise;
        });
        await worker.work<{ taskKey: string }>(
            queueName,
            { batchSize: 1, pollingIntervalSeconds: 0.5 },
            async (jobs) => {
                for (const job of jobs)
                    await executeClaimedTask(job.data.taskKey, paidProvider);
            },
        );
        const firstJobId = await publisher.send(
            queueName,
            { taskKey: testKey },
            { retryLimit: 0 },
        );
        expect(firstJobId).toBeTruthy();
        await providerStarted.promise;

        const stopping = worker.stop({ graceful: true, timeout: 5_000 });
        await new Promise((resolve) => setTimeout(resolve, 100));
        const queuedJobId = await publisher.send(
            queueName,
            { taskKey: secondKey },
            { retryLimit: 0 },
        );
        releaseProvider.resolve();
        await stopping;

        expect(
            (await publisher.getJobById(queueName, firstJobId!))?.state,
        ).toBe("completed");
        expect(
            (await publisher.getJobById(queueName, queuedJobId!))?.state,
        ).toBe("created");
        expect(paidProvider).toHaveBeenCalledOnce();

        worker = new PgBoss({ connectionString: databaseUrl!, max: 1 });
        worker.on("error", () => undefined);
        await worker.start();
        await worker.work<{ taskKey: string }>(
            queueName,
            { batchSize: 1, pollingIntervalSeconds: 0.5 },
            async (jobs) => {
                for (const job of jobs)
                    await executeClaimedTask(job.data.taskKey, paidProvider);
            },
        );
        await waitFor(async () => {
            const job = await publisher.getJobById(queueName, queuedJobId!);
            return job?.state === "completed";
        });
        const result = await pool.query<{
            status: string;
            result_count: number;
        }>(
            "select status, result_count from worker_shutdown_claims where task_key = $1",
            [testKey],
        );
        expect(result.rows[0]).toEqual({
            status: "succeeded",
            result_count: 1,
        });
        expect(paidProvider).toHaveBeenCalledTimes(2);
    });

    it("releases a timed-out queue job for replay without reclaiming a live cell", async () => {
        await setupQueue();
        await pool.query(
            "insert into worker_shutdown_claims (task_key, status) values ($1, 'pending')",
            [testKey],
        );
        const providerStarted = deferred();
        const processWasStopped = deferred();
        const paidProvider = vi.fn(async () => {
            providerStarted.resolve();
            await processWasStopped.promise;
        });
        await worker.work<{ taskKey: string }>(
            queueName,
            { batchSize: 1, pollingIntervalSeconds: 0.5 },
            async (jobs) => {
                for (const job of jobs)
                    await executeClaimedTask(job.data.taskKey, paidProvider);
            },
        );
        const jobId = await publisher.send(
            queueName,
            { taskKey: testKey },
            { retryLimit: 1, retryDelay: 0 },
        );
        expect(jobId).toBeTruthy();
        await providerStarted.promise;

        await worker.stop({ graceful: true, timeout: 1_000 });
        const timedOut = await publisher.getJobById(queueName, jobId!);
        expect(timedOut?.state).toBe("retry");
        expect(timedOut?.retryCount).toBe(0);

        worker = new PgBoss({ connectionString: databaseUrl!, max: 1 });
        worker.on("error", () => undefined);
        await worker.start();
        await worker.work<{ taskKey: string }>(
            queueName,
            { batchSize: 1, pollingIntervalSeconds: 0.5 },
            async (jobs) => {
                for (const job of jobs)
                    await executeClaimedTask(job.data.taskKey, paidProvider);
            },
        );
        await waitFor(async () => {
            const job = await publisher.getJobById(queueName, jobId!);
            return job?.state === "completed";
        });
        expect(
            (await publisher.getJobById(queueName, jobId!))?.retryCount,
        ).toBe(1);

        const stranded = await pool.query<{
            status: string;
            result_count: number;
        }>(
            "select status, result_count from worker_shutdown_claims where task_key = $1",
            [testKey],
        );
        expect(stranded.rows[0]).toEqual({
            status: "running",
            result_count: 0,
        });
        expect(paidProvider).toHaveBeenCalledOnce();

        // The stale-claim requeue intentionally makes the ambiguous external
        // attempt eligible again. Exactly-once provider billing is not implied.
        await pool.query(
            "update worker_shutdown_claims set status = 'pending' where task_key = $1",
            [testKey],
        );
        const recoveredJobId = await publisher.send(
            queueName,
            { taskKey: testKey },
            { retryLimit: 0 },
        );
        processWasStopped.resolve();
        await waitFor(async () => {
            const job = await publisher.getJobById(queueName, recoveredJobId!);
            const state = await pool.query<{
                status: string;
                result_count: number;
            }>(
                "select status, result_count from worker_shutdown_claims where task_key = $1",
                [testKey],
            );
            return (
                job?.state === "completed" &&
                state.rows[0]?.status === "succeeded"
            );
        });
        const recovered = await pool.query<{
            status: string;
            result_count: number;
        }>(
            "select status, result_count from worker_shutdown_claims where task_key = $1",
            [testKey],
        );
        expect(recovered.rows[0]).toEqual({
            status: "succeeded",
            result_count: 1,
        });
        expect(paidProvider).toHaveBeenCalledTimes(2);
    });
});
