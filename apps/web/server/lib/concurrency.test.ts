import { describe, it, expect } from "vitest";
import {
    mapPool,
    forEachPool,
    createSemaphore,
    positiveIntegerSetting,
} from "./concurrency";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mapPool", () => {
    it("returns an empty array for empty input without invoking the worker", async () => {
        let called = false;
        const result = await mapPool<number, number>([], 4, async (n) => {
            called = true;
            return n;
        });
        expect(result).toEqual([]);
        expect(called).toBe(false);
    });

    it("preserves input order even when later items resolve first", async () => {
        const result = await mapPool([30, 20, 10], 3, async (ms) => {
            await new Promise((r) => setTimeout(r, ms));
            return ms;
        });
        expect(result).toEqual([30, 20, 10]);
    });

    it("never runs more than `limit` workers concurrently", async () => {
        let active = 0;
        let maxActive = 0;
        await mapPool(
            Array.from({ length: 10 }, (_, i) => i),
            3,
            async (n) => {
                active++;
                maxActive = Math.max(maxActive, active);
                await tick();
                active--;
                return n;
            },
        );
        expect(maxActive).toBeLessThanOrEqual(3);
        expect(maxActive).toBeGreaterThan(1);
    });

    it("falls back to a single lane when limit <= 0", async () => {
        let active = 0;
        let maxActive = 0;
        const result = await mapPool([1, 2, 3], 0, async (n) => {
            active++;
            maxActive = Math.max(maxActive, active);
            await tick();
            active--;
            return n * 2;
        });
        expect(result).toEqual([2, 4, 6]);
        expect(maxActive).toBe(1);
    });

    it("falls back to a single lane when limit is NaN", async () => {
        const result = await mapPool([1, 2], Number.NaN, async (n) => n);
        expect(result).toEqual([1, 2]);
    });

    it("propagates a worker rejection", async () => {
        await expect(
            mapPool([1, 2, 3], 2, async (n) => {
                if (n === 2) throw new Error("boom");
                return n;
            }),
        ).rejects.toThrow("boom");
    });
});

describe("forEachPool", () => {
    it("is a no-op for empty input", async () => {
        let called = false;
        await forEachPool<number>([], 4, async () => {
            called = true;
        });
        expect(called).toBe(false);
    });

    it("invokes the worker for every item exactly once", async () => {
        const seen: number[] = [];
        await forEachPool([1, 2, 3, 4], 2, async (n) => {
            seen.push(n);
        });
        expect(seen.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    });

    it("propagates a worker rejection", async () => {
        await expect(
            forEachPool([1, 2], 2, async (n) => {
                if (n === 1) throw new Error("kaboom");
            }),
        ).rejects.toThrow("kaboom");
    });
});

describe("positiveIntegerSetting", () => {
    it("falls back on unset, empty, partial or fractional values", () => {
        for (const value of [undefined, "", " ", "0", "-2", "10abc", "2.5"])
            expect(positiveIntegerSetting(value, 5), String(value)).toBe(5);
        expect(positiveIntegerSetting(" 8 ", 5)).toBe(8);
    });
});

describe("createSemaphore", () => {
    it("lets waiting callers in, in order, before new ones when the limit is raised", async () => {
        let limit = 1;
        const semaphore = createSemaphore(() => limit);
        const order: string[] = [];
        const first = await semaphore.acquire();
        const waiting = ["a", "b"].map((name) =>
            semaphore.acquire().then((release) => {
                order.push(name);
                return release;
            }),
        );
        await Promise.resolve();
        limit = 2;
        const late = semaphore.acquire().then((release) => {
            order.push("late");
            return release;
        });
        await tick();
        // The raised limit admits the first waiter, not the newcomer.
        expect(order).toEqual(["a"]);
        first();
        (await waiting[0]!)();
        await tick();
        expect(order).toEqual(["a", "b", "late"]);
        (await waiting[1]!)();
        (await late)();
    });
});
