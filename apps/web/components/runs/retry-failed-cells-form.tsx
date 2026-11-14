"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
    retryRunAction,
    retryWorkflowRunAction,
    type IActionState,
} from "@/app/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/layout/use-action-toast";

type RetryVariant = "failed" | "resume" | "stuck" | "rejudge";

const RETRY_TEXT: Record<
    RetryVariant,
    { label: string; pending: string; done: string }
> = {
    failed: {
        label: "Retry failed cells",
        pending: "Retrying…",
        done: "Retry queued. Failed cells will run again.",
    },
    // A cancelled run: the same retry runs the cells that did not run.
    resume: {
        label: "Resume run",
        pending: "Resuming…",
        done: "Run resumed. Cells that did not run will run now.",
    },
    // A pending run no worker has taken: queue it again.
    stuck: {
        label: "Retry run",
        pending: "Retrying…",
        done: "Run queued again.",
    },
    // A completed pipeline run whose judge failed on some answers.
    rejudge: {
        label: "Re-judge answers",
        pending: "Re-judging…",
        done: "Re-judging queued. Answers whose judge failed will be judged again.",
    },
};

/** The button text: a re-judge names how many answers it judges again. */
export function retryLabel(variant: RetryVariant, count?: number): string {
    if (variant !== "rejudge" || count === undefined)
        return RETRY_TEXT[variant].label;
    return `Re-judge ${count} ${count === 1 ? "answer" : "answers"}`;
}

export function RetryFailedCellsForm({
    runId,
    workflowId,
    variant = "failed",
    count,
}: {
    runId: string;
    /** Set for workflow runs; omitted for eval runs. */
    workflowId?: string;
    variant?: RetryVariant;
    /** For a re-judge: how many answers it judges again. */
    count?: number;
}) {
    const [state, formAction] = useActionState<IActionState, FormData>(
        workflowId ? retryWorkflowRunAction : retryRunAction,
        {},
    );
    const text = RETRY_TEXT[variant];
    useActionToast(state, text.done);
    return (
        <form
            action={formAction}
            className="flex flex-col gap-2 sm:items-start"
        >
            <input type="hidden" name="runId" value={runId} />
            {workflowId && (
                <input type="hidden" name="workflowId" value={workflowId} />
            )}
            <RetryButton
                label={retryLabel(variant, count)}
                pendingLabel={text.pending}
            />
            {state.formError && (
                <Alert variant="destructive" className="sm:max-w-xs">
                    {state.formError}
                </Alert>
            )}
        </form>
    );
}

function RetryButton({
    label,
    pendingLabel,
}: {
    label: string;
    pendingLabel: string;
}) {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            variant="secondary"
            loading={pending}
            loadingText={pendingLabel}
        >
            {label}
        </Button>
    );
}
