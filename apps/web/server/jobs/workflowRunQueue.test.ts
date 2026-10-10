import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    staleRuns: [] as Array<{ id: string }>,
    updatePayloads: [] as Array<Record<string, unknown>>,
    send: vi.fn(),
    work: vi.fn(),
    offWork: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    bossConstructions: 0,
    selectGate: undefined as Promise<Array<{ id: string }>> | undefined,
    selectStarted: vi.fn(),
    executeWorkflowRun: vi.fn(),
}));

vi.mock("pg-boss", () => ({
    default: class PgBossMock {
        constructor() {
            mocks.bossConstructions += 1;
        }
        on = vi.fn();
        start = vi.fn(async () => undefined);
        createQueue = vi.fn(async () => undefined);
        send = mocks.send;
        work = mocks.work;
        offWork = mocks.offWork;
        stop = mocks.stop;
    },
}));

vi.mock("../db/client", () => ({
    db: {
        selectDistinct: vi.fn(() => ({
            from: vi.fn(() => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn(async () => {
                        mocks.selectStarted();
                        if (mocks.selectGate) return await mocks.selectGate;
                        return mocks.staleRuns;
                    }),
                })),
            })),
        })),
        update: vi.fn(() => ({
            set: vi.fn((payload: Record<string, unknown>) => {
                mocks.updatePayloads.push(payload);
                return { where: vi.fn(async () => undefined) };
            }),
        })),
    },
}));

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}

vi.mock("../workflowRuns/executor", () => ({
    executeWorkflowRun: mocks.executeWorkflowRun,
}));

import {
    enqueueWorkflowRun,
    recoverOrphanedWorkflowRuns,
    startWorkflowRunWorker,
    stopWorkflowRunWorker,
} from "./workflowRunQueue";

describe("workflow run queue", () => {
    beforeEach(() => {
        vi.useRealTimers();
        process.env.DATABASE_URL = "postgres://test";
        mocks.staleRuns = [];
        mocks.updatePayloads.length = 0;
        mocks.send.mockReset();
        mocks.work.mockReset();
        mocks.offWork.mockReset();
        mocks.stop.mockReset();
        mocks.selectGate = undefined;
        mocks.selectStarted.mockReset();
        mocks.executeWorkflowRun.mockReset();
    });

    it("enqueues bounded retries with backoff", async () => {
        await enqueueWorkflowRun("run-1");

        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "run-1" },
            {
                retryLimit: 3,
                retryBackoff: true,
            },
        );
    });

    it("clears stale cell claims before re-enqueueing their runs", async () => {
        mocks.staleRuns = [{ id: "run-1" }];

        await recoverOrphanedWorkflowRuns();

        expect(mocks.updatePayloads).toContainEqual({
            status: "pending",
            claimedAt: null,
        });
        expect(mocks.updatePayloads).toContainEqual({ status: "pending" });
        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "run-1" },
            expect.any(Object),
        );
    });

    it("rethrows executor failures and terminalizes work after the final attempt", async () => {
        vi.useFakeTimers();
        let handler: ((jobs: Array<any>) => Promise<void>) | undefined;
        let rejectExecution: ((error: Error) => void) | undefined;
        mocks.work.mockImplementation(async (_queue, _options, callback) => {
            handler = callback;
        });
        mocks.executeWorkflowRun.mockImplementation(
            () =>
                new Promise((_, reject) => {
                    rejectExecution = reject;
                }),
        );
        await startWorkflowRunWorker();

        const execution = handler?.([
            {
                data: { workflowRunId: "run-1" },
                retryCount: 3,
                retryLimit: 3,
            },
        ]);
        await vi.advanceTimersByTimeAsync(300_000);
        expect(mocks.updatePayloads).toContainEqual({
            claimedAt: expect.any(Date),
        });

        rejectExecution?.(new Error("database unavailable"));
        await expect(execution).rejects.toThrow("database unavailable");
        expect(mocks.updatePayloads).toContainEqual(
            expect.objectContaining({
                status: "failed",
                error: "Workflow worker exhausted retries.",
            }),
        );

        mocks.staleRuns = [{ id: "run-recovered-after-cutoff" }];
        mocks.send.mockClear();
        await vi.advanceTimersByTimeAsync(300_000);
        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "run-recovered-after-cutoff" },
            expect.any(Object),
        );

        await expect(stopWorkflowRunWorker(1_500)).resolves.toEqual({
            remainingInFlight: 0,
        });
        expect(mocks.stop).toHaveBeenCalledWith({
            graceful: true,
            timeout: 1_500,
        });
    });

    it("quiesces before recovery and closes the same pg-boss instance", async () => {
        vi.useFakeTimers();
        await startWorkflowRunWorker();
        const constructionCount = mocks.bossConstructions;

        const recovery = deferred<Array<{ id: string }>>();
        const recoveryStarted = deferred<void>();
        mocks.selectGate = recovery.promise;
        mocks.selectStarted.mockImplementationOnce(() =>
            recoveryStarted.resolve(),
        );

        const sweep = vi.advanceTimersByTimeAsync(300_000);
        await recoveryStarted.promise;
        const stopping = stopWorkflowRunWorker(10_000);
        expect(mocks.offWork).toHaveBeenCalledWith("workflow-run");
        expect(mocks.stop).not.toHaveBeenCalled();

        recovery.resolve([{ id: "workflow-stale" }]);
        await sweep;
        await expect(stopping).resolves.toEqual({ remainingInFlight: 0 });

        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "workflow-stale" },
            expect.any(Object),
        );
        expect(mocks.bossConstructions).toBe(constructionCount);
        expect(mocks.stop).toHaveBeenCalledOnce();
        expect(mocks.offWork.mock.invocationCallOrder[0]).toBeLessThan(
            mocks.send.mock.invocationCallOrder[0]!,
        );
    });

    it("does not register a consumer when shutdown interrupts startup recovery", async () => {
        const constructionCount = mocks.bossConstructions;
        const recovery = deferred<Array<{ id: string }>>();
        const recoveryStarted = deferred<void>();
        mocks.selectGate = recovery.promise;
        mocks.selectStarted.mockImplementationOnce(() =>
            recoveryStarted.resolve(),
        );

        const starting = startWorkflowRunWorker();
        await recoveryStarted.promise;
        const stopping = stopWorkflowRunWorker(10_000);
        recovery.resolve([{ id: "workflow-startup-stale" }]);
        await Promise.all([starting, stopping]);

        expect(mocks.work).not.toHaveBeenCalled();
        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "workflow-startup-stale" },
            expect.any(Object),
        );
        expect(mocks.bossConstructions).toBe(constructionCount + 1);
        expect(mocks.stop).toHaveBeenCalledOnce();
    });
});
