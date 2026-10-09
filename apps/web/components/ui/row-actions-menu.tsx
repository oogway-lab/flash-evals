"use client";

import * as React from "react";
import { MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import type { IActionState } from "@/app/actions/types";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
    ConfirmDialog,
    type IConfirmDialogProps,
} from "@/components/ui/confirm-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/cn";

export interface IRowActionsMenuProps {
    /** What the actions apply to; the trigger reads "More actions for <name>". */
    name: string;
    /** `ghost` for table rows and cards; `secondary` for a page header. */
    variant?: ButtonProps["variant"];
    /** A compact 32px trigger for dense rows; `false` for the 40px control. */
    compact?: boolean;
    /** Shows a spinner on the trigger while a menu action runs. */
    loading?: boolean;
    loadingText?: string;
    /** The menu items (`DropdownMenuItem`, `DropdownMenuSeparator`). */
    children: React.ReactNode;
}

/**
 * The overflow menu every row, card, and page header uses for secondary
 * actions: an icon-only trigger with an accessible name, and a menu panel
 * aligned to its end. Pair a destructive item with `ConfirmActionDialog`.
 */
export function RowActionsMenu({
    name,
    variant = "ghost",
    compact = true,
    loading,
    loadingText,
    children,
}: IRowActionsMenuProps) {
    return (
        <DropdownMenu>
            <DropdownMenuTrigger
                render={
                    <Button
                        type="button"
                        variant={variant}
                        size="icon"
                        className={cn(compact && "size-8")}
                        aria-label={`More actions for ${name}`}
                        loading={loading}
                        loadingText={loadingText}
                    />
                }
            >
                <MoreHorizontal className="size-4" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">{children}</DropdownMenuContent>
        </DropdownMenu>
    );
}

const GENERIC_ERROR = "Something went wrong. Please try again.";

export interface IConfirmActionDialogProps extends Omit<
    IConfirmDialogProps,
    "onConfirm" | "trigger"
> {
    /** The server action to run on confirm. */
    action: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    /** Form fields sent to the action, e.g. `{ datasetId }`. */
    fields: Record<string, string>;
    /** Toast shown once the action succeeds. */
    successMessage?: string;
}

/**
 * A `ConfirmDialog` bound to a server action. It closes when the action
 * succeeds and keeps the dialog open with the action's error otherwise. Each
 * confirmation is its own call (no state kept between runs), so a second
 * success closes the dialog just like the first.
 */
export function ConfirmActionDialog({
    action,
    fields,
    successMessage,
    ...dialogProps
}: IConfirmActionDialogProps) {
    return (
        <ConfirmDialog
            {...dialogProps}
            onConfirm={async () => {
                const data = new FormData();
                for (const [key, value] of Object.entries(fields)) {
                    data.set(key, value);
                }
                const result = await action({}, data);
                if (!result.ok) return result.formError ?? GENERIC_ERROR;
                if (successMessage) toast.success(successMessage);
            }}
        />
    );
}
