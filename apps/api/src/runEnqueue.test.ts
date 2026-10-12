import { describe, expect, it, vi } from "vitest";
import type { IApiConfig } from "./config.js";
import type { IDb, ITransactionalDb } from "./db.js";
import { publishRunEnqueue, replayPendingRunEnqueues } from "./runEnqueue.js";

const config = {} as IApiConfig;
const pending = { runId: "run", jobId: "job", status: "pending_enqueue" };

function transactionalDb(query: ReturnType<typeof vi.fn>): ITransactionalDb {
    return {
        query: query as unknown as IDb["query"],
        transaction: async (run) =>
            run({ query: query as unknown as IDb["query"] }),
    };
}

describe("ordinary run enqueue outbox", () => {
    it("uses the locked transaction for publication and acknowledgment", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rows: [pending] })
            .mockResolvedValue({ rows: [] });
        const enqueue = vi.fn().mockResolvedValue(undefined);
        await expect(
            publishRunEnqueue(transactionalDb(query), config, "run", enqueue),
        ).resolves.toEqual({ runId: "run", enqueueStatus: "queued" });
        expect(query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("for update skip locked"),
            ["run"],
        );
        expect(enqueue).toHaveBeenCalledExactlyOnceWith(config, "run", {
            db: { query },
            jobId: "job",
        });
        expect(query).toHaveBeenLastCalledWith(
            expect.stringContaining("set status='queued'"),
            ["run"],
        );
    });

    it("returns the recoverable ID and sanitized backoff after publication failure", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rows: [pending] })
            .mockResolvedValue({ rows: [] });
        const enqueue = vi
            .fn()
            .mockRejectedValue(new Error("secret connection credential"));
        const result = await publishRunEnqueue(
            transactionalDb(query),
            config,
            "run",
            enqueue,
        );
        expect(result).toEqual({
            runId: "run",
            enqueueStatus: "pending_enqueue",
        });
        expect(JSON.stringify(query.mock.calls)).not.toContain("secret");
        expect(query).toHaveBeenLastCalledWith(
            expect.stringContaining("Queue publication failed"),
            ["run"],
        );
    });

    it("still returns the durable identity when recovery metadata cannot be updated", async () => {
        const query = vi
            .fn()
            .mockRejectedValue(new Error("database unavailable"));
        const log = vi.spyOn(console, "error").mockImplementation(() => {});
        await expect(
            publishRunEnqueue(transactionalDb(query), config, "run", vi.fn()),
        ).resolves.toEqual({ runId: "run", enqueueStatus: "pending_enqueue" });
        log.mockRestore();
    });

    it("does not republish queued or currently locked/backed-off work", async () => {
        for (const status of ["queued", "pending_enqueue"]) {
            const query = vi
                .fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ status }] });
            const enqueue = vi.fn();
            await expect(
                publishRunEnqueue(
                    transactionalDb(query),
                    config,
                    "run",
                    enqueue,
                ),
            ).resolves.toMatchObject({ enqueueStatus: status });
            expect(enqueue).not.toHaveBeenCalled();
        }
    });

    it.each(["running", "completed", "partial", "failed"])(
        "does not advertise deferred publication for historical work already %s",
        async (status) => {
            const query = vi
                .fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [{ status }] });
            const enqueue = vi.fn();
            await expect(
                publishRunEnqueue(
                    transactionalDb(query),
                    config,
                    "run",
                    enqueue,
                ),
            ).resolves.toEqual({ runId: "run", enqueueStatus: "queued" });
            expect(enqueue).not.toHaveBeenCalled();
        },
    );

    it.each(["pending", "unexpected", undefined])(
        "does not claim queued publication for unresolved historical status %s",
        async (status) => {
            const query = vi
                .fn()
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({ rows: [] })
                .mockResolvedValueOnce({
                    rows: status === undefined ? [] : [{ status }],
                });
            const enqueue = vi.fn();
            await expect(
                publishRunEnqueue(
                    transactionalDb(query),
                    config,
                    "run",
                    enqueue,
                ),
            ).resolves.toEqual({
                runId: "run",
                enqueueStatus: "pending_enqueue",
            });
            expect(enqueue).not.toHaveBeenCalled();
        },
    );

    it("rolls back a successful job insertion when acknowledgment fails", async () => {
        let jobs = 0;
        const query = vi.fn(async (sql: string) => {
            if (sql.includes("for update skip locked"))
                return { rows: [pending] };
            if (sql.includes("set status='queued'"))
                throw new Error("acknowledgment failed");
            return { rows: [] };
        });
        const db = transactionalDb(query);
        db.transaction = async (run) => {
            const before = jobs;
            try {
                return await run({ query: query as unknown as IDb["query"] });
            } catch (error) {
                jobs = before;
                throw error;
            }
        };
        const enqueue = vi.fn(async () => {
            jobs += 1;
        });
        await expect(
            publishRunEnqueue(db, config, "run", enqueue),
        ).resolves.toMatchObject({ enqueueStatus: "pending_enqueue" });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(jobs).toBe(0);
    });

    it("lets only one concurrent publisher claim a pending generation", async () => {
        let locked = false;
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => {
            entered = resolve;
        });
        const blocked = new Promise<void>((resolve) => {
            release = resolve;
        });
        const query = vi.fn(async (sql: string) => {
            if (sql.includes("for update skip locked")) {
                if (locked) return { rows: [] };
                locked = true;
                return { rows: [pending] };
            }
            return { rows: [{ status: "pending_enqueue" }] };
        });
        const enqueue = vi.fn(async () => {
            entered();
            await blocked;
        });
        const db = transactionalDb(query);
        const first = publishRunEnqueue(db, config, "run", enqueue);
        await started;
        await expect(
            publishRunEnqueue(db, config, "run", enqueue),
        ).resolves.toMatchObject({ enqueueStatus: "pending_enqueue" });
        release();
        await expect(first).resolves.toMatchObject({ enqueueStatus: "queued" });
        expect(enqueue).toHaveBeenCalledTimes(1);
    });

    it("replays only due records through the transaction publisher", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({ rows: [{ runId: "run" }] })
            .mockResolvedValueOnce({ rows: [pending] })
            .mockResolvedValue({ rows: [] });
        const enqueue = vi.fn().mockResolvedValue(undefined);
        await expect(
            replayPendingRunEnqueues(transactionalDb(query), config, enqueue),
        ).resolves.toEqual([{ runId: "run", enqueueStatus: "queued" }]);
        expect(query).toHaveBeenNthCalledWith(
            1,
            expect.stringContaining("available_at <= now()"),
            [100],
        );
    });
});
