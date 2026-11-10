"use client";

import { useState } from "react";
import { cancelSetupComparisonAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/row-actions-menu";

/** Stops every run in a comparison after a confirmation. */
export function CancelComparisonButton({
    setupComparisonId,
}: {
    setupComparisonId: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(true)}
            >
                Cancel comparison
            </Button>
            <ConfirmActionDialog
                open={open}
                onOpenChange={setOpen}
                title="Cancel this comparison?"
                description="Every run in it stops starting new calls. Calls already sent finish and are still charged. Work that didn't start is marked not run."
                confirmLabel="Cancel comparison"
                cancelLabel="Keep running"
                pendingLabel="Cancelling…"
                action={cancelSetupComparisonAction}
                fields={{ setupComparisonId }}
                successMessage="Stopping the comparison. Calls already sent will finish."
            />
        </>
    );
}
