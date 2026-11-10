import { describe, expect, it, vi } from "vitest";

const updates = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../db/client", () => ({
    db: {
        update: vi.fn(() => ({
            set: vi.fn((payload: Record<string, unknown>) => {
                updates.push(payload);
                return { where: vi.fn(async () => undefined) };
            }),
        })),
    },
}));

import { createRunStopGuard, finishStoppedRun } from "./runStop";

describe("run stop guard", () => {
    it("reads the run at most once per poll interval and keeps a stop", async () => {
        let now = 0;
        let cancelRequested = false;
        const read = vi.fn(async () => ({ cancelRequested }));
        const guard = createRunStopGuard("run-1", {
            pollMs: 2_000,
            now: () => now,
            read,
        });

        expect(await guard.check()).toBeUndefined();
        cancelRequested = true;
        now = 1_000;
        // Within the interval: no new read, so the cancel is not seen yet.
        expect(await guard.check()).toBeUndefined();
        expect(read).toHaveBeenCalledTimes(1);

        now = 2_500;
        expect(await guard.check()).toBe("cancelled");
        cancelRequested = false;
        now = 10_000;
        expect(await guard.check()).toBe("cancelled");
        expect(guard.reason).toBe("cancelled");
        expect(read).toHaveBeenCalledTimes(2);
    });

    it("shares one read between cells that check at the same time", async () => {
        let resolveRead!: (value: { cancelRequested: boolean }) => void;
        const read = vi.fn(
            () =>
                new Promise<{ cancelRequested: boolean }>((resolve) => {
                    resolveRead = resolve;
                }),
        );
        const guard = createRunStopGuard("run-1", { pollMs: 0, read });

        const checks = [guard.check(), guard.check(), guard.check()];
        resolveRead({ cancelRequested: true });

        await expect(Promise.all(checks)).resolves.toEqual([
            "cancelled",
            "cancelled",
            "cancelled",
        ]);
        expect(read).toHaveBeenCalledOnce();
    });

    it("stops at the spend limit, and only reads spend when there is one", async () => {
        let spent = 0.4;
        const readSpend = vi.fn(async () => spent);
        const read = async () => ({ cancelRequested: false });
        const limited = createRunStopGuard("run-1", {
            maxCostUsd: 0.5,
            pollMs: 0,
            read,
            readSpend,
        });
        expect(await limited.check()).toBeUndefined();
        spent = 0.5;
        expect(await limited.check()).toBe("spend_cap");

        const unlimited = createRunStopGuard("run-2", {
            pollMs: 0,
            read,
            readSpend,
        });
        expect(await unlimited.check()).toBeUndefined();
        expect(readSpend).toHaveBeenCalledTimes(2);
    });

    it("counts unrecorded and in-flight spend against the limit", async () => {
        // Spend is read once and stays stale (a long poll interval).
        const guard = createRunStopGuard("run-1", {
            maxCostUsd: 1,
            pollMs: 60_000,
            now: () => 0,
            read: async () => ({ cancelRequested: false }),
            readSpend: async () => 0,
        });
        for (let cell = 0; cell < 3; cell += 1) {
            expect(await guard.check()).toBeUndefined();
            guard.started();
        }
        // One cell paid 0.30; two are still running, likely as much each.
        guard.finished(0.3);
        expect(await guard.check()).toBeUndefined(); // 0.3 + 2 x 0.3
        guard.started();
        expect(await guard.check()).toBe("spend_cap"); // 0.3 + 3 x 0.3
    });

    it("prefers a cancel request over the spend limit", async () => {
        const guard = createRunStopGuard("run-1", {
            maxCostUsd: 0.5,
            read: async () => ({ cancelRequested: true }),
            readSpend: async () => 10,
        });
        expect(await guard.check()).toBe("cancelled");
    });

    it("finishes a stopped run as cancelled and leaves unstarted cells pending", async () => {
        updates.length = 0;

        await finishStoppedRun("run-1", "cancelled");

        expect(updates).toEqual([
            { status: "pending", claimedAt: null },
            { status: "cancelled", stopReason: "cancelled" },
        ]);
    });
});
