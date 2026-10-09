"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import type { IActionState } from "@/app/actions";
import { archiveDatasetAction, restoreDatasetAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { useActionToast } from "@/components/layout/use-action-toast";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
    ConfirmActionDialog,
    RowActionsMenu,
} from "@/components/ui/row-actions-menu";

const initialState: IActionState = {};

function RestoreSubmitButton() {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            variant="secondary"
            loading={pending}
            loadingText="Restoring…"
        >
            Restore
        </Button>
    );
}

/**
 * Dataset-level actions in the page header. An archived dataset shows one
 * visible Restore button; an active one keeps Archive in an overflow menu
 * behind a confirmation.
 */
export function DatasetActionsMenu({
    datasetId,
    datasetName,
    archived,
}: {
    datasetId: string;
    datasetName: string;
    archived: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [restoreState, restoreFormAction] = useActionState(
        restoreDatasetAction,
        initialState,
    );

    useActionToast(restoreState, "Dataset restored.");

    if (archived) {
        return (
            <form action={restoreFormAction} className="flex flex-col gap-2">
                <input type="hidden" name="datasetId" value={datasetId} />
                {restoreState.formError && (
                    <p role="alert" className="text-copy-14 text-error">
                        {restoreState.formError}
                    </p>
                )}
                <RestoreSubmitButton />
            </form>
        );
    }

    return (
        <>
            <RowActionsMenu
                name={datasetName}
                variant="secondary"
                compact={false}
            >
                <DropdownMenuItem onClick={() => setOpen(true)}>
                    Archive
                </DropdownMenuItem>
            </RowActionsMenu>

            <ConfirmActionDialog
                open={open}
                onOpenChange={setOpen}
                title="Archive dataset?"
                description="It will be hidden from the list and run setup. You can restore it anytime."
                confirmLabel="Archive"
                pendingLabel="Archiving…"
                action={archiveDatasetAction}
                fields={{ datasetId }}
            />
        </>
    );
}
