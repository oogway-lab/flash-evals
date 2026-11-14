"use client";

import { useEffect, useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { fmtCost } from "@/lib/format";
import {
    settledCells,
    type IRunProgressSnapshot,
} from "@/components/runs/use-run-progress";

/** How long a run may wait for a worker before the page says so. */
export const STUCK_PENDING_MS = 60_000;

/** Cells a stopped run never ran (they are left pending). */
export function notRunCells(data: IRunProgressSnapshot): number {
    return Math.max(0, data.total - settledCells(data));
}

interface IRunNotice {
    title: string;
    description: string;
    /** Offer the page's retry action with this notice. */
    retry?: boolean;
    variant?: "default" | "warning" | "destructive";
}

function stopNotice(
    data: IRunProgressSnapshot,
    maxCostUsd: number | undefined,
): IRunNotice | undefined {
    const active = data.status === "pending" || data.status === "running";
    if (active && data.stopReason)
        return {
            title: "Stopping",
            description:
                "No new cells will start. Calls already sent will finish, then the run stops.",
        };
    if (data.status !== "cancelled") return undefined;
    const notRun = notRunCells(data);
    const cells = `${notRun} ${notRun === 1 ? "cell" : "cells"} did not run.`;
    if (data.stopReason === "spend_cap")
        return {
            title: "Stopped at the spend limit",
            description: `The run's costs reached its ${maxCostUsd !== undefined ? `${fmtCost(maxCostUsd)} ` : ""}limit, so no new cells started.${notRun > 0 ? ` ${cells}` : ""} Start a new run with a higher limit to finish them.`,
        };
    return {
        title: "Cancelled",
        description:
            notRun > 0
                ? `${cells} Resume the run to run ${notRun === 1 ? "it" : "them"}.`
                : "Every cell had finished when the run stopped.",
    };
}

/**
 * A pending run with nothing done for over a minute: the queue publication
 * has not gone through, or no worker has taken the run.
 */
function waitingNotice(
    data: IRunProgressSnapshot,
    now: number,
): IRunNotice | undefined {
    if (data.status !== "pending" || data.stopReason || !data.pendingSince)
        return undefined;
    if (settledCells(data) > 0) return undefined;
    const since = Date.parse(data.pendingSince);
    if (!Number.isFinite(since) || now - since < STUCK_PENDING_MS)
        return undefined;
    if (data.enqueueStatus === "pending_enqueue")
        return {
            title: "This run hasn't been queued yet",
            description:
                "Flash Evals keeps trying to put it in the queue. If this lasts, check the API's logs.",
            variant: "warning",
        };
    return {
        title: "The worker hasn't picked this run up. Is it running?",
        description:
            "Runs wait in a queue until a worker starts them. Start the worker (bun run worker) or check its logs; this run starts as soon as a worker takes it. If the worker is running and the run still waits, retry it.",
        retry: true,
        variant: "warning",
    };
}

/**
 * What the run is doing when that is not plain progress: winding down after
 * a cancel, stopped before running every cell, failed before it started, or
 * waiting for a worker that hasn't taken it.
 */
export function describeRunNotice(
    data: IRunProgressSnapshot,
    maxCostUsd?: number,
    now = Date.now(),
): IRunNotice | undefined {
    const stopped = stopNotice(data, maxCostUsd);
    if (stopped) return stopped;
    if (data.status === "failed" && data.error)
        return {
            title: "The run failed before any cell started",
            description: data.error,
            variant: "destructive",
        };
    return waitingNotice(data, now);
}

/** The current time, refreshed while `active` so time-based notices appear. */
function useNow(active: boolean, intervalMs = 10_000): number {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setNow(Date.now()), intervalMs);
        return () => clearInterval(timer);
    }, [active, intervalMs]);
    return now;
}

export function RunStatusNotice({
    data,
    maxCostUsd,
    retryAction,
}: {
    data: IRunProgressSnapshot;
    maxCostUsd?: number;
    /** The page's retry control, shown with a notice that offers it. */
    retryAction?: React.ReactNode;
}) {
    const now = useNow(data.status === "pending");
    const notice = describeRunNotice(data, maxCostUsd, now);
    if (!notice) return undefined;
    return (
        <Alert
            role={notice.variant === "destructive" ? "alert" : "status"}
            variant={notice.variant}
        >
            <AlertTitle>{notice.title}</AlertTitle>
            <AlertDescription className="flex flex-col gap-3">
                <span>{notice.description}</span>
                {notice.retry && retryAction}
            </AlertDescription>
        </Alert>
    );
}
