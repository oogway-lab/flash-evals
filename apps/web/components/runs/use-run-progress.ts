"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { IRunProgress, RunStatus } from "@mosaic/api-contract";

export interface IRunProgressSnapshot extends IRunProgress {
    status: RunStatus;
}

/**
 * `live` while polling normally, `reconnecting` after a failed poll,
 * `paused` while the tab is hidden, `idle` once the run is finished.
 */
export type RunProgressConnection = "live" | "reconnecting" | "paused" | "idle";

export const POLL_INTERVAL_MS = 3_000;
export const MAX_POLL_INTERVAL_MS = 30_000;
/** Minimum gap between `router.refresh()` calls while cells complete. */
export const REFRESH_INTERVAL_MS = 10_000;

export function isActiveRunStatus(status: RunStatus) {
    return status === "pending" || status === "running";
}

export function progressPercent(done: number, total: number) {
    return total > 0 ? Math.round((done / total) * 100) : 0;
}

/** Exponential backoff after consecutive failures, capped. */
export function nextPollDelay(failures: number, base = POLL_INTERVAL_MS) {
    return Math.min(base * 2 ** failures, MAX_POLL_INTERVAL_MS);
}

/** Cells that have finished, successfully or not (`done` excludes failures). */
export function settledCells(progress: IRunProgress) {
    return progress.done + progress.failed;
}

/**
 * Refresh the server-rendered tables when the run finishes, or at most every
 * `intervalMs` while cells keep settling, so results (failures included) fill
 * in during the run instead of all at once at the end.
 */
export function shouldRefresh({
    next,
    lastRefreshedSettled,
    lastRefreshAt,
    now,
    intervalMs = REFRESH_INTERVAL_MS,
}: {
    next: IRunProgressSnapshot;
    lastRefreshedSettled: number;
    lastRefreshAt: number;
    now: number;
    intervalMs?: number;
}) {
    if (!isActiveRunStatus(next.status)) return true;
    return (
        settledCells(next) > lastRefreshedSettled &&
        now - lastRefreshAt >= intervalMs
    );
}

/** Polling stops while the tab is hidden, so the label must say so. */
function visibleConnection(
    connection: RunProgressConnection,
): RunProgressConnection {
    if (connection === "idle") return connection;
    return typeof document !== "undefined" && document.hidden
        ? "paused"
        : connection;
}

export function isRunProgressSnapshot(
    value: unknown,
): value is IRunProgressSnapshot {
    if (!value || typeof value !== "object") return false;
    const o = value as Record<string, unknown>;
    return (
        typeof o.status === "string" &&
        typeof o.total === "number" &&
        typeof o.done === "number"
    );
}

function snapshotKey(s: IRunProgressSnapshot) {
    return `${s.status}:${s.done}:${s.total}:${s.failed}`;
}

/**
 * Polls a run progress endpoint while the run is active. Pauses while the tab
 * is hidden, backs off on errors, and refreshes the route as cells complete.
 */
export function useRunProgress(
    url: string,
    initial: IRunProgressSnapshot,
): { data: IRunProgressSnapshot; connection: RunProgressConnection } {
    const router = useRouter();
    const [data, setData] = useState(initial);
    const [connection, setConnection] = useState<RunProgressConnection>(
        isActiveRunStatus(initial.status) ? "live" : "idle",
    );

    // Re-sync when the server re-renders with newer props (e.g. after
    // router.refresh() or "Retry failed cells" restarting the run).
    const [syncedKey, setSyncedKey] = useState(snapshotKey(initial));
    if (snapshotKey(initial) !== syncedKey) {
        setSyncedKey(snapshotKey(initial));
        setData(initial);
        setConnection(
            visibleConnection(
                isActiveRunStatus(initial.status) ? "live" : "idle",
            ),
        );
    }

    const active = isActiveRunStatus(data.status);
    // `at: 0` lets the first completed cell refresh straight away.
    const refreshed = useRef({ settled: settledCells(initial), at: 0 });

    useEffect(() => {
        if (!active) return;

        let failures = 0;
        let timer: ReturnType<typeof setTimeout> | undefined;
        let stopped = false;
        let inFlight = false;
        const controller = new AbortController();

        const schedule = (delay: number) => {
            clearTimeout(timer);
            if (stopped || document.hidden) return;
            timer = setTimeout(() => void poll(), delay);
        };

        const poll = async () => {
            if (inFlight) return;
            inFlight = true;
            try {
                const response = await fetch(url, {
                    signal: controller.signal,
                    cache: "no-store",
                });
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const next: unknown = await response.json();
                if (!isRunProgressSnapshot(next)) {
                    throw new Error("Unexpected progress payload");
                }
                failures = 0;
                setData(next);
                setConnection(
                    visibleConnection(
                        isActiveRunStatus(next.status) ? "live" : "idle",
                    ),
                );

                const now = Date.now();
                if (
                    shouldRefresh({
                        next,
                        lastRefreshedSettled: refreshed.current.settled,
                        lastRefreshAt: refreshed.current.at,
                        now,
                    })
                ) {
                    refreshed.current = {
                        settled: settledCells(next),
                        at: now,
                    };
                    router.refresh();
                }
                if (!isActiveRunStatus(next.status)) return;
            } catch {
                if (controller.signal.aborted) return;
                failures += 1;
                setConnection(visibleConnection("reconnecting"));
            } finally {
                inFlight = false;
            }
            schedule(nextPollDelay(failures));
        };

        const onVisibilityChange = () => {
            if (document.hidden) {
                clearTimeout(timer);
                setConnection("paused");
            } else {
                setConnection(failures > 0 ? "reconnecting" : "live");
                void poll();
            }
        };

        document.addEventListener("visibilitychange", onVisibilityChange);
        if (document.hidden) setConnection("paused");
        else schedule(POLL_INTERVAL_MS);

        return () => {
            stopped = true;
            clearTimeout(timer);
            controller.abort();
            document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
        };
    }, [active, url, router]);

    return { data, connection };
}
