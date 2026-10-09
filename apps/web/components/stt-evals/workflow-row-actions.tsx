"use client";

import { useState } from "react";
import type { IActionState } from "@/app/actions/types";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
    ConfirmActionDialog,
    RowActionsMenu,
} from "@/components/ui/row-actions-menu";

/** Overflow menu for a pipeline row: the destructive action lives here. */
export function WorkflowRowActions({
    workflowId,
    workflowName,
    deleteAction,
}: {
    workflowId: string;
    workflowName: string;
    deleteAction: (formData: FormData) => Promise<IActionState>;
}) {
    const [deleteOpen, setDeleteOpen] = useState(false);

    return (
        <>
            <RowActionsMenu name={workflowName}>
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                >
                    Delete pipeline
                </DropdownMenuItem>
            </RowActionsMenu>
            <ConfirmActionDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title={`Delete “${workflowName}”?`}
                description="It will no longer appear in Pipelines. Its existing runs are kept."
                confirmLabel="Delete pipeline"
                pendingLabel="Deleting…"
                action={(_prev, formData) => deleteAction(formData)}
                fields={{ workflowId }}
            />
        </>
    );
}
