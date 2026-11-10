import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
    /** Rows a "still pending" update returns: the run never started. */
    pendingRows: [] as Array<{ id: string }>,
    /** Pipeline runs waiting for their comparison's finished eval run. */
    waitingRuns: [] as Array<{ id: string }>,
    /** The join condition of the waiting-pipelines query. */
    waitingJoin: undefined as unknown,
}));

function tableName(table: object): string | undefined {
    const symbol = Object.getOwnPropertySymbols(table).find(
        (candidate) => candidate.toString() === "Symbol(drizzle:Name)",
    );
    return symbol ? (table as Record<symbol, string>)[symbol] : undefined;
}

vi.mock("pg-boss", () => ({
    PgBoss: class PgBossMock {
        constructor() {
            mocks.bossConstructions += 1;
        }
        on = vi.fn();
        start = vi.fn(async () => undefined);
        createQueue = vi.fn(async () => undefined);
        updateQueue = vi.fn(async () => undefined);
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
                innerJoin: vi.fn((table: object, on: unknown) => ({
                    where: vi.fn(async () => {
                        // The comparison query joins eval runs; the stale
                        // claim query joins cells.
                        if (tableName(table) === "runs") {
                            mocks.waitingJoin = on;
                            return mocks.waitingRuns;
                        }
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
                return {
                    where: vi.fn(() =>
                        Object.assign(Promise.resolve(undefined), {
                            returning: vi.fn(async () => mocks.pendingRows),
                        }),
                    ),
                };
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
    queueWaitingComparisonPipelines,
    recoverOrphanedWorkflowRuns,
    startWorkflowRunWorker,
    stopWorkflowRunWorker,
} from "./workflowRunQueue";

describe("workflow run queue", () => {
    beforeEach(() => {
        vi.useRealTimers();
        process.env.DATABASE_URL = "postgres://test";
        mocks.staleRuns = [];
        mocks.waitingRuns = [];
        mocks.updatePayloads.length = 0;
        mocks.send.mockReset();
        mocks.work.mockReset();
        mocks.offWork.mockReset();
        mocks.stop.mockReset();
        mocks.selectGate = undefined;
        mocks.selectStarted.mockReset();
        mocks.executeWorkflowRun.mockReset();
        mocks.pendingRows = [];
    });

    it("enqueues bounded retries with backoff", async () => {
        await enqueueWorkflowRun("run-1");

        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "run-1" },
            {
                expireInSeconds: 86_400,
                retryLimit: 3,
                retryBackoff: true,
                singletonKey: "run-1",
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

    it("queues comparison pipeline runs once their eval run has finished", async () => {
        mocks.waitingRuns = [{ id: "pipeline-run-1" }];

        await expect(
            queueWaitingComparisonPipelines("eval-run-1"),
        ).resolves.toBe(1);

        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "pipeline-run-1" },
            expect.objectContaining({ singletonKey: "pipeline-run-1" }),
        );
        // Their status is left alone: the next pass scores and ends them.
        expect(mocks.updatePayloads).toEqual([]);
    });

    it("finds waiting pipeline runs by the eval run they compare with, in a setup comparison or not", async () => {
        await queueWaitingComparisonPipelines("eval-run-1");

        const { sql } = new PgDialect().sqlToQuery(mocks.waitingJoin as SQL);
        expect(sql).toContain(
            `"runs"."id"::text = "workflow_runs"."config_snapshot" #>> '{comparison,runId}'`,
        );
        expect(sql).not.toContain("setup_comparison_id");
    });

    it("recovery also queues comparison pipeline runs left waiting", async () => {
        mocks.waitingRuns = [{ id: "pipeline-run-1" }];

        await recoverOrphanedWorkflowRuns();

        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "pipeline-run-1" },
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

    it("fails a run whose setup threw with the redacted error, without retrying it", async () => {
        let handler: ((jobs: Array<any>) => Promise<void>) | undefined;
        mocks.work.mockImplementation(async (_queue, _options, callback) => {
            handler = callback;
        });
        mocks.pendingRows = [{ id: "run-1" }];
        mocks.executeWorkflowRun.mockRejectedValue(
            new Error(
                "Provider key sk-abcdefghijklmnopqrstuvwxyz123456 is invalid",
            ),
        );
        await startWorkflowRunWorker();

        await expect(
            handler?.([
                {
                    data: { workflowRunId: "run-1" },
                    retryCount: 0,
                    retryLimit: 3,
                },
            ]),
        ).resolves.toBeUndefined();

        const failed = mocks.updatePayloads.find(
            (payload) => payload.status === "failed",
        );
        expect(failed?.error).toEqual(expect.stringContaining("is invalid"));
        expect(failed?.error).not.toContain("abcdefghijklmnopqrstuvwxyz");
        await stopWorkflowRunWorker(1_000);
    });

    it("leaves a run that had started to the job's retries", async () => {
        let handler: ((jobs: Array<any>) => Promise<void>) | undefined;
        mocks.work.mockImplementation(async (_queue, _options, callback) => {
            handler = callback;
        });
        mocks.pendingRows = [];
        mocks.executeWorkflowRun.mockRejectedValue(new Error("step failed"));
        await startWorkflowRunWorker();

        await expect(
            handler?.([
                {
                    data: { workflowRunId: "run-1" },
                    retryCount: 0,
                    retryLimit: 3,
                },
            ]),
        ).rejects.toThrow("step failed");
        await stopWorkflowRunWorker(1_000);
    });
});
