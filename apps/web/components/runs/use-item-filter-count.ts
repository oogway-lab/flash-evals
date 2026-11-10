"use client";

import { useEffect, useState } from "react";
import type { IActiveItemFilter, ItemFilterCount } from "./comparison-state";

/** Counts a dataset's items whose stored answer has `equals` at `path`. */
export type CountItemFilterAction = (
    datasetId: string,
    path: string,
    equals: string,
) => Promise<{ ok: true; matching: number } | { ok: false; error: string }>;

/** Wait after typing before counting. */
const COUNT_DELAY_MS = 300;

/**
 * How many of the dataset's items the label filter keeps, counted by the
 * API with the rule run creation uses. Undefined without a filter or an
 * action; "loading" until the count for the current filter arrives.
 */
export function useItemFilterCount(
    action: CountItemFilterAction | undefined,
    datasetId: string,
    filter: IActiveItemFilter | undefined,
): ItemFilterCount | undefined {
    const key =
        action && filter && datasetId
            ? JSON.stringify([datasetId, filter.path, filter.equals])
            : undefined;
    const [result, setResult] = useState<{
        key: string;
        count: ItemFilterCount;
    }>();
    useEffect(() => {
        if (!key || !action) return;
        const [id, path, equals] = JSON.parse(key) as [string, string, string];
        let current = true;
        const timer = setTimeout(() => {
            action(id, path, equals)
                .then((response) => {
                    if (!current) return;
                    setResult({
                        key,
                        count: response.ok
                            ? { status: "done", matching: response.matching }
                            : { status: "error", error: response.error },
                    });
                })
                .catch(() => {
                    if (current)
                        setResult({
                            key,
                            count: {
                                status: "error",
                                error: "the count failed",
                            },
                        });
                });
        }, COUNT_DELAY_MS);
        return () => {
            current = false;
            clearTimeout(timer);
        };
    }, [action, key]);
    if (!key) return undefined;
    return result?.key === key ? result.count : { status: "loading" };
}
