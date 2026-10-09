import { describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "./config.js";
import type { IDb, ITransactionalDb } from "./db.js";
import {
    publishWorkflowRunEnqueue,
    replayPendingWorkflowRunEnqueues,
} from "./workflowRunEnqueue.js";

const config = {} as IApiConfig;

function transactionalDb(query: ReturnType<typeof vi.fn>): ITransactionalDb {
    return {
        query: query as unknown as IDb["query"],
        transaction: async (run) =>
            run({ query: query as unknown as IDb["query"] }),
    };
}

describe("workflow run enqueue outbox", () => {
    it("publishes after commit and marks both durable records queued", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({
                rows: [{ workflowRunId: "run-1", status: "pending_enqueue" }],
            })
            .mockResolvedValue({ rows: [] });
        const enqueue = vi.fn().mockResolvedValue(undefined);

        await expect(
            publishWorkflowRunEnqueue(
                transactionalDb(query),
                config,
                "run-1",
                enqueue,
            ),
        ).resolves.toEqual({
            workflowRunId: "run-1",
            enqueueStatus: "queued",
        });

        expect(enqueue).toHaveBeenCalledExactlyOnceWith(config, "run-1");
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("set status = 'queued'"),
            ["run-1"],
        );
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining("set enqueue_status = 'queued'"),
            ["run-1"],
        );
    });

    it("keeps a durable pending record when queue publication fails", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({
                rows: [{ workflowRunId: "run-1", status: "pending_enqueue" }],
            })
            .mockResolvedValue({ rows: [] });

        await expect(
            publishWorkflowRunEnqueue(
                transactionalDb(query),
                config,
                "run-1",
                vi.fn().mockRejectedValue(new Error("secret in error")),
            ),
        ).resolves.toEqual({
            workflowRunId: "run-1",
            enqueueStatus: "pending_enqueue",
        });

        const calls = JSON.stringify(query.mock.calls);
        expect(calls).toContain("Queue publication failed");
        expect(calls).not.toContain("secret in error");
        expect(calls).toContain("publish_attempts = publish_attempts + 1");
    });

    it("does not republish an outbox row already marked queued", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rows: [] })
            .mockResolvedValueOnce({
                rows: [{ workflowRunId: "run-1", status: "queued" }],
            });
        const enqueue = vi.fn();

        await expect(
            publishWorkflowRunEnqueue(
                transactionalDb(query),
                config,
                "run-1",
                enqueue,
            ),
        ).resolves.toMatchObject({ enqueueStatus: "queued" });

        expect(enqueue).not.toHaveBeenCalled();
    });

    it("allows only one publisher to claim the same due row", async () => {
        let claimed = false;
        const query = vi.fn(async (sql: string) => {
            if (sql.includes("set status = 'publishing'") && !claimed) {
                claimed = true;
                return {
                    rows: [
                        {
                            workflowRunId: "run-1",
                            status: "publishing",
                        },
                    ],
                };
            }
            return { rows: [] };
        });
        const enqueue = vi.fn().mockResolvedValue(undefined);
        const db = transactionalDb(query);

        await Promise.all([
            publishWorkflowRunEnqueue(db, config, "run-1", enqueue),
            publishWorkflowRunEnqueue(db, config, "run-1", enqueue),
        ]);

        expect(enqueue).toHaveBeenCalledExactlyOnceWith(config, "run-1");
    });

    it("replays only due pending rows through the idempotent publisher", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({
                rows: [{ workflowRunId: "run-1" }, { workflowRunId: "run-2" }],
            })
            .mockResolvedValueOnce({
                rows: [{ workflowRunId: "run-1", status: "pending_enqueue" }],
            })
            .mockResolvedValue({ rows: [] });
        const enqueue = vi.fn().mockResolvedValue(undefined);

        const result = await replayPendingWorkflowRunEnqueues(
            transactionalDb(query),
            config,
            enqueue,
        );

        expect(result).toEqual([
            { workflowRunId: "run-1", enqueueStatus: "queued" },
            { workflowRunId: "run-2", enqueueStatus: "pending_enqueue" },
        ]);
        expect(enqueue).toHaveBeenCalledExactlyOnceWith(config, "run-1");
        expect(query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("available_at <= now()"),
            [100],
        );
    });
});
