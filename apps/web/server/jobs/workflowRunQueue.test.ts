import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    staleRuns: [] as Array<{ id: string }>,
    updatePayloads: [] as Array<Record<string, unknown>>,
    send: vi.fn(),
    work: vi.fn(),
    executeWorkflowRun: vi.fn(),
}));

vi.mock("pg-boss", () => ({
    default: class PgBossMock {
        on = vi.fn();
        start = vi.fn(async () => undefined);
        createQueue = vi.fn(async () => undefined);
        send = mocks.send;
        work = mocks.work;
    },
}));

vi.mock("../db/client", () => ({
    db: {
        selectDistinct: vi.fn(() => ({
            from: vi.fn(() => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn(async () => mocks.staleRuns),
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

vi.mock("../workflowRuns/executor", () => ({
    executeWorkflowRun: mocks.executeWorkflowRun,
}));

import {
    enqueueWorkflowRun,
    recoverOrphanedWorkflowRuns,
    startWorkflowRunWorker,
} from "./workflowRunQueue";

describe("workflow run queue", () => {
    beforeEach(() => {
        vi.useRealTimers();
        process.env.DATABASE_URL = "postgres://test";
        mocks.staleRuns = [];
        mocks.updatePayloads.length = 0;
        mocks.send.mockReset();
        mocks.work.mockReset();
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
                error: "Workflow worker exhausted retries: database unavailable",
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
    });
});
