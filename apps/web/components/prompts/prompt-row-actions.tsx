"use client";

import { useState } from "react";
import { deletePromptAction } from "@/app/actions";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
    ConfirmActionDialog,
    RowActionsMenu,
} from "@/components/ui/row-actions-menu";

/** The overflow menu for one prompt row. Delete asks for confirmation first. */
export function PromptRowActions({
    promptId,
    name,
}: {
    promptId: string;
    name: string;
}) {
    const [open, setOpen] = useState(false);

    return (
        <>
            <RowActionsMenu name={name}>
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setOpen(true)}
                >
                    Delete
                </DropdownMenuItem>
            </RowActionsMenu>

            <ConfirmActionDialog
                open={open}
                onOpenChange={setOpen}
                title="Delete prompt?"
                description={`${name} and its versions will be permanently deleted. Delete any runs that use this prompt first.`}
                confirmLabel="Delete"
                pendingLabel="Deleting…"
                action={deletePromptAction}
                fields={{ promptId }}
                successMessage={`Deleted “${name}”.`}
            />
        </>
    );
}
