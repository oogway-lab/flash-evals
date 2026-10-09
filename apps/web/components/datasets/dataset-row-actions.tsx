"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import type { IDatasetListRow } from "@mosaic/api-contract";
import type { IActionState } from "@/app/actions";
import {
    archiveDatasetAction,
    deleteDatasetAction,
    duplicateDatasetAction,
    restoreDatasetAction,
} from "@/app/actions";
import { withSuccessToast } from "@/components/layout/use-action-toast";
import {
    DropdownMenuItem,
    DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
    ConfirmActionDialog,
    RowActionsMenu,
} from "@/components/ui/row-actions-menu";

const initialState: IActionState = {};

/** Surfaces a failed row action as a toast; the menu has no room for inline errors. */
function useErrorToast(state: IActionState) {
    useEffect(() => {
        if (state.formError) toast.error(state.formError);
    }, [state]);
}

function datasetIdData(datasetId: string) {
    const data = new FormData();
    data.set("datasetId", datasetId);
    return data;
}

/**
 * One overflow menu per dataset row. Duplicate and restore run straight from
 * the menu; archive and delete ask for confirmation first.
 */
export function DatasetRowActions({ dataset }: { dataset: IDatasetListRow }) {
    const [archiveOpen, setArchiveOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [duplicateState, duplicateFormAction, duplicating] = useActionState(
        withSuccessToast(
            duplicateDatasetAction,
            `Duplicated “${dataset.name}”.`,
        ),
        initialState,
    );
    const [restoreState, restoreFormAction, restoring] = useActionState(
        withSuccessToast(restoreDatasetAction, `Restored “${dataset.name}”.`),
        initialState,
    );

    useErrorToast(duplicateState);
    useErrorToast(restoreState);

    return (
        <>
            <RowActionsMenu
                name={dataset.name}
                loading={duplicating || restoring}
                loadingText="Working…"
            >
                {dataset.archived ? (
                    <DropdownMenuItem
                        onClick={() =>
                            startTransition(() =>
                                restoreFormAction(datasetIdData(dataset.id)),
                            )
                        }
                    >
                        Restore
                    </DropdownMenuItem>
                ) : (
                    <>
                        <DropdownMenuItem
                            onClick={() =>
                                startTransition(() =>
                                    duplicateFormAction(
                                        datasetIdData(dataset.id),
                                    ),
                                )
                            }
                        >
                            Duplicate
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => setArchiveOpen(true)}>
                            Archive
                        </DropdownMenuItem>
                    </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleteOpen(true)}
                >
                    Delete
                </DropdownMenuItem>
            </RowActionsMenu>

            <ConfirmActionDialog
                open={archiveOpen}
                onOpenChange={setArchiveOpen}
                title="Archive dataset?"
                description={`${dataset.name} will be hidden from run setup. You can restore it from the archived view.`}
                confirmLabel="Archive"
                pendingLabel="Archiving…"
                action={archiveDatasetAction}
                fields={{ datasetId: dataset.id }}
            />
            <ConfirmActionDialog
                open={deleteOpen}
                onOpenChange={setDeleteOpen}
                title="Delete dataset?"
                description={`${dataset.name} and its items will be permanently deleted. Delete any runs that use this dataset first.`}
                confirmLabel="Delete"
                pendingLabel="Deleting…"
                action={deleteDatasetAction}
                fields={{ datasetId: dataset.id }}
                successMessage={`Deleted “${dataset.name}”.`}
            />
        </>
    );
}
