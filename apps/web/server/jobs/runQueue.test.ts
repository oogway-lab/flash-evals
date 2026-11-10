import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    runCells: [] as Array<{
        id: string;
        cellStatus: string;
        claimedAt: Date | null;
    }>,
    selectError: undefined as Error | undefined,
    updatePayloads: [] as Array<Record<string, unknown>>,
    send: vi.fn(),
    work: vi.fn(),
    offWork: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    bossConstructions: 0,
    selectGate: undefined as
        | Promise<
              Array<{ id: string; cellStatus: string; claimedAt: Date | null }>
          >
        | undefined,
    selectStarted: vi.fn(),
    createQueue: vi.fn(async () => undefined),
    updateQueue: vi.fn(async () => undefined),
    on: vi.fn(),
    executeRun: vi.fn(
        async (
            _runId: string,
            _options?: { leaseLost?: () => boolean },
        ): Promise<void> => undefined,
    ),
    leases: new Map<string, { id: string; at: number }>(),
    leaseSeq: 0,
    queueWaitingComparisonPipelines: vi.fn(async (_runId?: string) => 0),
    /** Pending runs whose lease went stale during setup. */
    stuckInSetup: [] as string[],
    clearedLeases: [] as string[],
}));

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

vi.mock("pg-boss", () => ({
    PgBoss: class PgBossMock {
        constructor() {
            mocks.bossConstructions += 1;
        }
        on = mocks.on;
        start = vi.fn(async () => undefined);
        createQueue = mocks.createQueue;
        updateQueue = mocks.updateQueue;
        send = mocks.send;
        work = mocks.work;
        offWork = mocks.offWork;
        stop = mocks.stop;
    },
}));

vi.mock("../db/client", () => ({
    db: {
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn(async () => {
                        mocks.selectStarted();
                        if (mocks.selectError) throw mocks.selectError;
                        if (mocks.selectGate) return await mocks.selectGate;
                        return mocks.runCells;
                    }),
                })),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn((payload: Record<string, unknown>) => {
                const isLeaseClear = "executionLeaseId" in payload;
                if (!isLeaseClear) mocks.updatePayloads.push(payload);
                return {
                    where: vi.fn(() =>
                        Object.assign(Promise.resolve(undefined), {
                            returning: vi.fn(async () => {
                                if (!isLeaseClear) return [];
                                const ids = mocks.stuckInSetup.splice(0);
                                mocks.clearedLeases.push(...ids);
                                return ids.map((id) => ({ id }));
                            }),
                        }),
                    ),
                };
            }),
        })),
    },
}));

vi.mock("../runs/executor", () => ({ executeRun: mocks.executeRun }));
vi.mock("./workflowRunQueue", () => ({
    queueWaitingComparisonPipelines: mocks.queueWaitingComparisonPipelines,
}));

// The run lease with the real rule: a lease is free once it is older than
// the stale window, and the heartbeat keeps a live pass's lease fresh.
vi.mock("./runExecutionLease", () => ({
    acquireRunExecutionLease: vi.fn(
        async (runId: string, staleAfterMs: number) => {
            const held = mocks.leases.get(runId);
            if (held && held.at >= Date.now() - staleAfterMs) return undefined;
            const id = `lease-${++mocks.leaseSeq}`;
            mocks.leases.set(runId, { id, at: Date.now() });
            return id;
        },
    ),
    refreshRunExecutionLease: vi.fn(async (runId: string, id: string) => {
        if (mocks.leases.get(runId)?.id !== id) return false;
        mocks.leases.set(runId, { id, at: Date.now() });
        return true;
    }),
    releaseRunExecutionLease: vi.fn(async (runId: string, id: string) => {
        if (mocks.leases.get(runId)?.id === id) mocks.leases.delete(runId);
    }),
}));

import { releaseRunExecutionLease } from "./runExecutionLease";
import {
    enqueueRun,
    recoverOrphanedRuns,
    startRunWorker,
    stopRunWorker,
} from "./runQueue";

const RUN_JOB_OPTIONS = { expireInSeconds: 86_400, retryLimit: 0 };

describe("run queue stale claims", () => {
    beforeEach(() => {
        vi.useRealTimers();
        process.env.DATABASE_URL = "postgres://test";
        mocks.runCells = [];
        mocks.selectError = undefined;
        mocks.updatePayloads.length = 0;
        mocks.send.mockReset();
        mocks.work.mockReset();
        mocks.offWork.mockReset();
        mocks.stop.mockReset();
        mocks.selectGate = undefined;
        mocks.selectStarted.mockReset();
        mocks.executeRun.mockReset().mockResolvedValue(undefined);
        mocks.leases.clear();
        mocks.stuckInSetup = [];
        mocks.clearedLeases = [];
    });

    it("queues again a pending run whose worker died during setup", async () => {
        mocks.stuckInSetup = ["run-setup-died"];

        await recoverOrphanedRuns(1_000_000);

        expect(mocks.clearedLeases).toEqual(["run-setup-died"]);
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-setup-died" },
            RUN_JOB_OPTIONS,
        );
    });

    it("clears stale V1 cell claims before re-enqueueing their runs", async () => {
        mocks.runCells = [
            {
                id: "run-1",
                cellStatus: "running",
                claimedAt: new Date(0),
            },
        ];

        await recoverOrphanedRuns(1_000_000);

        expect(mocks.updatePayloads).toContainEqual({
            status: "pending",
            claimedAt: null,
        });
        expect(mocks.updatePayloads).toContainEqual({ status: "pending" });
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-1" },
            RUN_JOB_OPTIONS,
        );
    });

    it("does not mutate or enqueue runs without stale cells", async () => {
        mocks.runCells = [
            {
                id: "run-1",
                cellStatus: "running",
                claimedAt: new Date(500_000),
            },
        ];

        await recoverOrphanedRuns(1_000_000);

        expect(mocks.updatePayloads).toEqual([]);
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("re-enqueues a stranded running run before any cell was claimed", async () => {
        mocks.runCells = [
            { id: "run-1", cellStatus: "pending", claimedAt: null },
        ];

        await recoverOrphanedRuns(1_000_000);

        expect(mocks.updatePayloads).toContainEqual({ status: "pending" });
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-1" },
            RUN_JOB_OPTIONS,
        );
    });

    it("does not reclaim a run during live scoring", async () => {
        mocks.runCells = [
            {
                id: "run-1",
                cellStatus: "succeeded",
                claimedAt: new Date(500_000),
            },
        ];

        await recoverOrphanedRuns(1_000_000);

        expect(mocks.updatePayloads).toEqual([]);
        expect(mocks.send).not.toHaveBeenCalled();
    });

    it("recovers scoring after its heartbeat becomes stale", async () => {
        mocks.runCells = [
            {
                id: "run-1",
                cellStatus: "succeeded",
                claimedAt: new Date(0),
            },
        ];

        await recoverOrphanedRuns(1_000_000);

        expect(mocks.updatePayloads).toContainEqual({ status: "pending" });
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-1" },
            RUN_JOB_OPTIONS,
        );
    });

    it("can retry worker startup after recovery fails", async () => {
        mocks.selectError = new Error("database unavailable");
        await expect(startRunWorker()).rejects.toThrow("database unavailable");

        mocks.selectError = undefined;
        vi.useFakeTimers();
        await startRunWorker();
        mocks.runCells = [
            { id: "run-2", cellStatus: "running", claimedAt: null },
        ];
        await vi.advanceTimersByTimeAsync(300_000);

        expect(mocks.work).toHaveBeenCalledOnce();
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-2" },
            RUN_JOB_OPTIONS,
        );

        await expect(stopRunWorker(1_500)).resolves.toEqual({
            remainingInFlight: 0,
        });
        expect(mocks.stop).toHaveBeenCalledWith({
            graceful: true,
            timeout: 1_500,
        });
    });

    it("quiesces before a recovery sweep and closes the same pg-boss instance", async () => {
        vi.useFakeTimers();
        await startRunWorker();
        const constructionCount = mocks.bossConstructions;

        let releaseRecovery!: (
            rows: Array<{
                id: string;
                cellStatus: string;
                claimedAt: Date | null;
            }>,
        ) => void;
        let signalRecoveryStarted!: () => void;
        const recoveryStarted = new Promise<void>((resolve) => {
            signalRecoveryStarted = resolve;
        });
        mocks.selectGate = new Promise((resolve) => {
            releaseRecovery = resolve;
        });
        mocks.selectStarted.mockImplementationOnce(signalRecoveryStarted);

        const sweep = vi.advanceTimersByTimeAsync(300_000);
        await recoveryStarted;

        const stopping = stopRunWorker(10_000);
        expect(mocks.offWork).toHaveBeenCalledWith("eval-run");
        expect(mocks.stop).not.toHaveBeenCalled();

        releaseRecovery([
            { id: "run-stale", cellStatus: "running", claimedAt: new Date(0) },
        ]);
        await sweep;
        await expect(stopping).resolves.toEqual({ remainingInFlight: 0 });

        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-stale" },
            RUN_JOB_OPTIONS,
        );
        expect(mocks.bossConstructions).toBe(constructionCount);
        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(mocks.offWork.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.send.mock.invocationCallOrder[0]!,
        );
    });

    it("does not register a consumer when shutdown interrupts startup recovery", async () => {
        const constructionCount = mocks.bossConstructions;
        const recovery = deferred<
            Array<{
                id: string;
                cellStatus: string;
                claimedAt: Date | null;
            }>
        >();
        const recoveryStarted = deferred<void>();
        mocks.selectGate = recovery.promise;
        mocks.selectStarted.mockImplementationOnce(() =>
            recoveryStarted.resolve(),
        );

        const starting = startRunWorker();
        await recoveryStarted.promise;
        const stopping = stopRunWorker(10_000);
        recovery.resolve([
            { id: "run-startup-stale", cellStatus: "running", claimedAt: null },
        ]);
        await Promise.all([starting, stopping]);

        expect(mocks.work).not.toHaveBeenCalled();
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-startup-stale" },
            RUN_JOB_OPTIONS,
        );
        expect(mocks.bossConstructions).toBe(constructionCount + 1);
        expect(mocks.stop).toHaveBeenCalledOnce();
    });

    it("marks a run that failed before starting any cell failed, with the redacted error", async () => {
        await startRunWorker();
        const handler = mocks.work.mock.calls[0]?.[2] as (
            jobs: Array<Record<string, unknown>>,
        ) => Promise<void>;
        mocks.executeRun.mockRejectedValueOnce(
            new Error("Provider key sk-proj-aaaaaaaaaaaaaaaaaaaa was rejected"),
        );
        mocks.updatePayloads.length = 0;

        await handler([
            {
                id: "job-1",
                data: { runId: "run-setup" },
                retryCount: 0,
                retryLimit: 0,
            },
        ]);

        const failed = mocks.updatePayloads.find(
            (payload) => payload.status === "failed",
        );
        expect(failed?.error).toContain("was rejected");
        expect(failed?.error).not.toContain("sk-proj-aaaaaaaaaaaaaaaaaaaa");
        await stopRunWorker(1_500);
    });

    it("queues a setup comparison's waiting pipeline runs once an eval run's job ends", async () => {
        await startRunWorker();
        const handler = mocks.work.mock.calls[0]?.[2] as (
            jobs: Array<Record<string, unknown>>,
        ) => Promise<void>;
        mocks.queueWaitingComparisonPipelines.mockClear();

        await handler([
            {
                id: "job-1",
                data: { runId: "run-eval" },
                retryCount: 0,
                retryLimit: 0,
            },
        ]);

        expect(mocks.queueWaitingComparisonPipelines).toHaveBeenCalledWith(
            "run-eval",
        );
        await stopRunWorker(1_500);
    });

    it("sends eval-run jobs with a 24-hour expiry and no pg-boss retries", async () => {
        await enqueueRun("run-1");

        expect(mocks.createQueue).toHaveBeenCalledWith(
            "eval-run",
            RUN_JOB_OPTIONS,
        );
        // An existing queue created with pg-boss's defaults is updated too.
        expect(mocks.updateQueue).toHaveBeenCalledWith(
            "eval-run",
            RUN_JOB_OPTIONS,
        );
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-1" },
            RUN_JOB_OPTIONS,
        );
        expect(mocks.on).toHaveBeenCalledWith("warning", expect.any(Function));
    });

    it("does not execute a run twice when its job outlives the old 15-minute expiry", async () => {
        vi.useFakeTimers();
        await startRunWorker();
        const handler = mocks.work.mock.calls[0]?.[2] as (
            jobs: Array<Record<string, unknown>>,
        ) => Promise<void>;
        const firstPass = deferred<void>();
        mocks.executeRun.mockImplementationOnce(() => firstPass.promise);
        const job = (id: string) => ({
            id,
            data: { runId: "run-long" },
            retryCount: 0,
            retryLimit: 0,
        });

        const first = handler([job("job-1")]);
        await vi.advanceTimersByTimeAsync(0);
        expect(mocks.executeRun).toHaveBeenCalledOnce();

        // Twenty minutes in, pg-boss (or a duplicate publication) hands the
        // same run to the worker again while the first pass still runs.
        await vi.advanceTimersByTimeAsync(20 * 60_000);
        mocks.send.mockClear();
        await handler([job("job-2")]);

        expect(mocks.executeRun).toHaveBeenCalledOnce();
        // The duplicate is deferred, not dropped, so a dead first pass is
        // still resumed once its lease goes stale.
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run-long" },
            { ...RUN_JOB_OPTIONS, startAfter: 60 },
        );

        firstPass.resolve();
        await first;
        expect(mocks.leases.has("run-long")).toBe(false);

        // Once the first pass is done, a later job may run again.
        await handler([job("job-3")]);
        expect(mocks.executeRun).toHaveBeenCalledTimes(2);
        await stopRunWorker(1_500);
    });

    it("releases the run lease before queueing waiting pipelines", async () => {
        await startRunWorker();
        const handler = mocks.work.mock.calls[0]?.[2] as (
            jobs: Array<Record<string, unknown>>,
        ) => Promise<void>;
        vi.mocked(releaseRunExecutionLease).mockClear();
        mocks.queueWaitingComparisonPipelines.mockClear();

        await handler([
            {
                id: "job-1",
                data: { runId: "run-done" },
                retryCount: 0,
                retryLimit: 0,
            },
        ]);

        expect(
            vi.mocked(releaseRunExecutionLease).mock.invocationCallOrder[0],
        ).toBeLessThan(
            mocks.queueWaitingComparisonPipelines.mock.invocationCallOrder[0]!,
        );
        await stopRunWorker(1_500);
    });

    it("tells the pass when another pass took its lease over", async () => {
        vi.useFakeTimers();
        await startRunWorker();
        const handler = mocks.work.mock.calls[0]?.[2] as (
            jobs: Array<Record<string, unknown>>,
        ) => Promise<void>;
        const pass = deferred<void>();
        let leaseLost: (() => boolean) | undefined;
        mocks.executeRun.mockImplementationOnce(
            async (_runId: string, options?: { leaseLost?: () => boolean }) => {
                leaseLost = options?.leaseLost;
                await pass.promise;
            },
        );
        const running = handler([
            {
                id: "job-1",
                data: { runId: "run-taken" },
                retryCount: 0,
                retryLimit: 0,
            },
        ]);
        await vi.advanceTimersByTimeAsync(0);
        expect(leaseLost?.()).toBe(false);

        // Another pass took the lease over.
        mocks.leases.set("run-taken", { id: "lease-other", at: Date.now() });
        await vi.advanceTimersByTimeAsync(300_000);
        expect(leaseLost?.()).toBe(true);

        pass.resolve();
        await running;
        // The other pass's lease is left alone.
        expect(mocks.leases.get("run-taken")?.id).toBe("lease-other");
        await stopRunWorker(1_500);
    });
});
