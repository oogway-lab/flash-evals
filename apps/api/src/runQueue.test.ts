import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "./config.js";
import type { IDb } from "./db.js";

const mocks = vi.hoisted(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    send: vi.fn(),
    createQueue: vi.fn(),
    updateQueue: vi.fn(),
    on: vi.fn(),
}));
vi.mock("pg-boss", () => ({
    default: class {
        start = mocks.start;
        stop = mocks.stop;
        send = mocks.send;
        createQueue = mocks.createQueue;
        updateQueue = mocks.updateQueue;
        on = mocks.on;
    },
}));

const config = {
    databaseUrl: "postgresql://localhost/disposable",
} as IApiConfig;

describe("ordinary queue publication", () => {
    beforeEach(() => {
        vi.resetModules();
        vi.clearAllMocks();
        mocks.start.mockResolvedValue(undefined);
        mocks.stop.mockResolvedValue(undefined);
        mocks.createQueue.mockResolvedValue(undefined);
        mocks.updateQueue.mockResolvedValue(undefined);
        mocks.send.mockResolvedValue("job");
    });

    it("publishes workflow runs to a stately queue keyed by run so duplicates are dropped", async () => {
        const { enqueueWorkflowRun } = await import("./runQueue.js");
        await enqueueWorkflowRun(config, "wf-run");
        await enqueueWorkflowRun(config, "wf-run");
        const options = { name: "workflow-run", policy: "stately" };
        expect(mocks.createQueue).toHaveBeenCalledWith("workflow-run", options);
        expect(mocks.updateQueue).toHaveBeenCalledExactlyOnceWith(
            "workflow-run",
            options,
        );
        expect(mocks.send).toHaveBeenCalledWith(
            "workflow-run",
            { workflowRunId: "wf-run" },
            { singletonKey: "wf-run" },
        );
    });

    it("passes the durable job identity and caller transaction to pg-boss", async () => {
        const { enqueueRun } = await import("./runQueue.js");
        const query = vi.fn().mockResolvedValue({ rows: [{ id: "job" }] });
        await enqueueRun(config, "run", { db: { query } as IDb, jobId: "job" });
        const options = mocks.send.mock.calls[0]![2];
        expect(mocks.send).toHaveBeenCalledWith(
            "eval-run",
            { runId: "run" },
            expect.objectContaining({ id: "job" }),
        );
        await options.db.executeSql("insert queue job", ["run"]);
        expect(query).toHaveBeenCalledExactlyOnceWith("insert queue job", [
            "run",
        ]);
    });

    it("initializes a single boss for concurrent publishers and preserves legacy callers", async () => {
        const { enqueueRun } = await import("./runQueue.js");
        await Promise.all([
            enqueueRun(config, "one"),
            enqueueRun(config, "two"),
        ]);
        expect(mocks.start).toHaveBeenCalledTimes(1);
        expect(mocks.send).toHaveBeenCalledTimes(2);
    });

    it("does not acknowledge a rejected queue insertion", async () => {
        const { enqueueRun } = await import("./runQueue.js");
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.send.mockResolvedValue(null);
        await expect(enqueueRun(config, "run")).rejects.toThrow(
            "did not accept",
        );
        log.mockRestore();
    });

    it("can restart after queue initialization fails", async () => {
        const { enqueueRun } = await import("./runQueue.js");
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        mocks.start.mockRejectedValueOnce(new Error("unavailable"));
        await expect(enqueueRun(config, "run")).rejects.toThrow("unavailable");
        await expect(enqueueRun(config, "run")).resolves.toBeUndefined();
        expect(mocks.stop).toHaveBeenCalledTimes(1);
        expect(mocks.start).toHaveBeenCalledTimes(2);
        log.mockRestore();
    });
});
