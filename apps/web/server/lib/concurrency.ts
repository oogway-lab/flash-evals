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
 * A counting semaphore. `limit` is read on each acquire so it can follow
 * configuration; the returned release function is idempotent.
 */
export function createSemaphore(limit: () => number): {
    acquire(): Promise<() => void>;
} {
    let active = 0;
    const waiters: Array<() => void> = [];
    return {
        async acquire() {
            if (active >= Math.max(1, limit())) {
                await new Promise<void>((resolve) => waiters.push(resolve));
            } else {
                active += 1;
            }
            let released = false;
            return () => {
                if (released) return;
                released = true;
                const next = waiters.shift();
                if (next) next();
                else active -= 1;
            };
        },
    };
}
