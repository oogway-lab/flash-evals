"use client";

import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { RunStatusBadge } from "@/components/ui/status-badge";
import { RunStatusNotice } from "@/components/runs/run-status-notice";
import {
    isActiveRunStatus,
    progressPercent,
    useRunProgress,
    type IRunProgressSnapshot,
    type RunProgressConnection,
} from "@/components/runs/use-run-progress";

const connectionLabels: Record<
    Exclude<RunProgressConnection, "idle">,
    string
> = {
    live: "Updating live",
    reconnecting: "Reconnecting…",
    paused: "Updates paused",
};

/**
 * Live progress for a run or workflow run. Polls `progressUrl` while the run
 * is active and refreshes the page's result tables as cells complete. Says
 * when the run is stopping, was stopped, failed before it started, or waits
 * for a worker that hasn't taken it.
 */
export function RunProgressCard({
    progressUrl,
    initial,
    maxCostUsd,
    retryAction,
    className,
}: {
    progressUrl: string;
    initial: IRunProgressSnapshot;
    /** The run's spend limit, named when the run stopped at it. */
    maxCostUsd?: number;
    /** Offered when the run waits for a worker that hasn't taken it. */
    retryAction?: React.ReactNode;
    className?: string;
}) {
    const { data, connection } = useRunProgress(progressUrl, initial);
    const active = isActiveRunStatus(data.status);
    const percent = progressPercent(data.done, data.total);

    return (
        <Card className={className}>
            <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                    <RunStatusBadge
                        status={data.status}
                        stopReason={data.stopReason}
                    />
                    {active && connection !== "idle" && (
                        <span className="flex items-center gap-2 text-copy-14 text-muted-foreground">
                            {connection === "reconnecting" && (
                                <Spinner size="sm" />
                            )}
                            {connectionLabels[connection]}
                        </span>
                    )}
                </div>
                <Progress
                    aria-label="Run progress"
                    value={percent}
                    indeterminate={active && data.total === 0}
                />
                <p
                    aria-live="polite"
                    className="text-copy-14 tabular-nums text-muted-foreground"
                >
                    {data.done} / {data.total} cells complete · {percent}%
                    {data.failed > 0 && ` · ${data.failed} failed`}
                </p>
                <RunStatusNotice
                    data={data}
                    maxCostUsd={maxCostUsd}
                    retryAction={retryAction}
                />
            </CardContent>
        </Card>
    );
}
