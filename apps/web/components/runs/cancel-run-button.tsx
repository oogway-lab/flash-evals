"use client";

import { useState } from "react";
import { cancelRunAction, cancelWorkflowRunAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/row-actions-menu";

/**
 * Stops a pending or running run after a confirmation. The worker lets calls
 * already sent finish and does not start any more cells (pipeline steps).
 */
export function CancelRunButton({
    runId,
    workflowId,
}: {
    runId: string;
    /** Set for a pipeline run; omitted for an eval run. */
    workflowId?: string;
}) {
    const [open, setOpen] = useState(false);
    const units = workflowId ? "steps" : "cells";
    return (
        <>
            <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(true)}
            >
                Cancel run
            </Button>
            <ConfirmActionDialog
                open={open}
                onOpenChange={setOpen}
                title="Cancel this run?"
                description={`No new ${units} will start. Calls already sent will finish and are still charged. ${workflowId ? "Steps" : "Cells"} that didn't start are marked not run, and you can resume the run later.`}
                confirmLabel="Cancel run"
                cancelLabel="Keep running"
                pendingLabel="Cancelling…"
                action={workflowId ? cancelWorkflowRunAction : cancelRunAction}
                fields={workflowId ? { runId, workflowId } : { runId }}
                successMessage="Stopping the run. Calls already sent will finish."
            />
        </>
    );
}
