async function runPool<T>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    if (items.length === 0) return;
    let next = 0;
    // Ensure at least one lane even if misconfigured (EVAL_CONCURRENCY=0 or negative)
    const effectiveLimit = limit > 0 ? limit : 1;
    const lanes = Math.min(effectiveLimit, items.length);
    await Promise.all(
        Array.from({ length: lanes }, async () => {
            while (next < items.length) {
                const i = next++;
                await worker(items[i], i);
            }
        }),
    );
}

export async function mapPool<T, R>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<R>,
): Promise<R[]> {
    if (items.length === 0) return [];
    const results = new Array<R>(items.length);
    await runPool(items, limit, async (item, i) => {
        results[i] = await worker(item);
    });
    return results;
}

export async function forEachPool<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>,
): Promise<void> {
    await runPool(items, limit, async (item) => {
        await worker(item);
    });
}

/**
 * A whole positive number read from the environment, or `fallback` when the
 * value is unset, empty or not a whole positive number.
 */
export function positiveIntegerSetting(
    value: string | undefined,
    fallback: number,
): number {
    const trimmed = value?.trim() ?? "";
    if (!/^\d+$/.test(trimmed)) return fallback;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * A first-in, first-out counting semaphore. `limit` is read on each acquire
 * and release so it can follow configuration; when it is raised, waiting
 * callers are let in, in order, before any new one. The returned release
 * function is idempotent.
 */
export function createSemaphore(limit: () => number): {
    acquire(): Promise<() => void>;
} {
    let active = 0;
    const waiters: Array<() => void> = [];
    const admitWaiting = () => {
        while (waiters.length > 0 && active < Math.max(1, limit())) {
            active += 1;
            waiters.shift()?.();
        }
    };
    return {
        async acquire() {
            if (waiters.length === 0 && active < Math.max(1, limit())) {
                active += 1;
            } else {
                const admitted = new Promise<void>((resolve) =>
                    waiters.push(resolve),
                );
                // A raised limit may already have room for those waiting.
                admitWaiting();
                await admitted;
            }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                active -= 1;
                admitWaiting();
            };
        },
    };
}
