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
        select: vi.fn(() => ({
            from: vi.fn(() => ({
                innerJoin: vi.fn(() => ({
                    where: vi.fn(async () => {
                        if (mocks.selectError) throw mocks.selectError;
                        return mocks.runCells;
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

vi.mock("../runs/executor", () => ({ executeRun: vi.fn() }));

import { recoverOrphanedRuns, startRunWorker } from "./runQueue";

describe("run queue stale claims", () => {
    beforeEach(() => {
        vi.useRealTimers();
        process.env.DATABASE_URL = "postgres://test";
        mocks.runCells = [];
        mocks.selectError = undefined;
        mocks.updatePayloads.length = 0;
        mocks.send.mockReset();
        mocks.work.mockReset();
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
        expect(mocks.send).toHaveBeenCalledWith("eval-run", { runId: "run-1" });
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
        expect(mocks.send).toHaveBeenCalledWith("eval-run", { runId: "run-1" });
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
        expect(mocks.send).toHaveBeenCalledWith("eval-run", { runId: "run-1" });
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
        expect(mocks.send).toHaveBeenCalledWith("eval-run", { runId: "run-2" });
    });
});
