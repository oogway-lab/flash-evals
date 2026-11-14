import type { Route } from "next";
import Link from "next/link";
import type { RunStatus, RunStopReason } from "@flash-evals/api-contract";
import { CancelRunButton } from "@/components/runs/cancel-run-button";
import { RetryFailedCellsForm } from "@/components/runs/retry-failed-cells-form";
import { buttonVariants } from "@/components/ui/button";

/** Which run actions apply, from the run's status. */
export function runHeaderActionsFor({
    status,
    stopReason,
    answersToRejudge,
}: {
    status: RunStatus;
    stopReason?: RunStopReason;
    /** Final answers whose judge failed (completed pipeline runs). */
    answersToRejudge?: number;
}): {
    canCancel: boolean;
    canRetry: boolean;
    canResume: boolean;
    /** Answers a re-judge would judge again; 0 when it isn't offered. */
    rejudge: number;
} {
    const active = status === "pending" || status === "running";
    return {
        canCancel: active && !stopReason,
        canRetry: status === "partial" || status === "failed",
        canResume: status === "cancelled" && stopReason !== "spend_cap",
        rejudge:
            status === "completed" && (answersToRejudge ?? 0) > 0
                ? answersToRejudge!
                : 0,
    };
}

/**
 * The run page's actions: rerun with changes, cancel while the run is
 * active, retry failed cells, resume a cancelled run, or judge again the
 * answers of a completed pipeline run whose judge failed. Pipeline runs pass
 * `workflowId` and have no rerun link.
 */
export function RunHeaderActions({
    runId,
    workflowId,
    status,
    stopReason,
    answersToRejudge,
    reRunHref,
}: {
    runId: string;
    workflowId?: string;
    status: RunStatus;
    stopReason?: RunStopReason;
    /** Final answers whose judge failed, on a completed pipeline run. */
    answersToRejudge?: number;
    reRunHref?: Route;
}) {
    const { canCancel, canRetry, canResume, rejudge } = runHeaderActionsFor({
        status,
        stopReason,
        answersToRejudge,
    });
    // A finished pipeline run has no actions; leave no empty slot.
    if (!reRunHref && !canCancel && !canRetry && !canResume && !rejudge)
        return null;
    return (
        <div className="flex flex-col items-stretch gap-2 sm:flex-row">
            {reRunHref && (
                <Link href={reRunHref} className={buttonVariants()}>
                    Rerun
                </Link>
            )}
            {canCancel && (
                <CancelRunButton runId={runId} workflowId={workflowId} />
            )}
            {canRetry && (
                <RetryFailedCellsForm runId={runId} workflowId={workflowId} />
            )}
            {canResume && (
                <RetryFailedCellsForm
                    runId={runId}
                    workflowId={workflowId}
                    variant="resume"
                />
            )}
            {rejudge > 0 && (
                <RetryFailedCellsForm
                    runId={runId}
                    workflowId={workflowId}
                    variant="rejudge"
                    count={rejudge}
                />
            )}
        </div>
    );
}
