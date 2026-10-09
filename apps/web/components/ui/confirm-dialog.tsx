"use client";

import * as React from "react";
import {
    AlertDialog,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export interface IConfirmDialogProps {
    /**
     * Element that opens the dialog, rendered as the dialog's trigger (so it
     * should be a button); omit when controlling `open` directly.
     */
    trigger?: React.ReactElement;
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    /** Extra body content between the description and the actions. */
    children?: React.ReactNode;
    /** Accessible label while confirming, e.g. "Deleting…". */
    pendingLabel?: string;
    /**
     * Runs on confirm. Return (or resolve to) an error message to keep the
     * dialog open and show it; anything else closes the dialog.
     */
    onConfirm: () =>
        string | undefined | void | Promise<string | undefined | void>;
}

/**
 * Confirmation for destructive actions: Cancel then the destructive action,
 * right-aligned. The action stays in the dialog while it runs and reports a
 * failure in place instead of closing.
 */
export function ConfirmDialog({
    trigger,
    open: openProp,
    onOpenChange,
    title,
    description,
    confirmLabel,
    children,
    pendingLabel,
    onConfirm,
}: IConfirmDialogProps) {
    const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
    const [pending, setPending] = React.useState(false);
    const [error, setError] = React.useState<string>();
    const open = openProp ?? uncontrolledOpen;

    function setOpen(next: boolean) {
        if (pending) return;
        if (!next) setError(undefined);
        if (openProp === undefined) setUncontrolledOpen(next);
        onOpenChange?.(next);
    }

    async function confirm() {
        setPending(true);
        setError(undefined);
        try {
            const result = await onConfirm();
            if (typeof result === "string" && result) {
                setError(result);
                return;
            }
        } catch {
            setError("Something went wrong. Please try again.");
            return;
        } finally {
            setPending(false);
        }
        if (openProp === undefined) setUncontrolledOpen(false);
        onOpenChange?.(false);
    }

    return (
        <AlertDialog open={open} onOpenChange={setOpen}>
            {trigger && <AlertDialogTrigger render={trigger} />}
            <AlertDialogContent>
                <AlertDialogHeader>
                    <AlertDialogTitle>{title}</AlertDialogTitle>
                    <AlertDialogDescription>
                        {description}
                    </AlertDialogDescription>
                </AlertDialogHeader>
                {children}
                {error && (
                    <p role="alert" className="text-copy-14 text-error">
                        {error}
                    </p>
                )}
                <AlertDialogFooter>
                    <AlertDialogCancel disabled={pending}>
                        Cancel
                    </AlertDialogCancel>
                    <Button
                        type="button"
                        variant="destructive"
                        loading={pending}
                        loadingText={pendingLabel}
                        onClick={() => void confirm()}
                    >
                        {confirmLabel}
                    </Button>
                </AlertDialogFooter>
            </AlertDialogContent>
        </AlertDialog>
    );
}
