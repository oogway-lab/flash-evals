"use client";

import * as React from "react";
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export function AlertDialog(props: AlertDialogPrimitive.Root.Props) {
    return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />;
}

/**
 * Renders a `<button>`. To use your own button, compose with `render`:
 * `<AlertDialogTrigger render={<Button variant="ghost" />}>Delete</AlertDialogTrigger>`.
 */
export function AlertDialogTrigger(props: AlertDialogPrimitive.Trigger.Props) {
    return (
        <AlertDialogPrimitive.Trigger
            data-slot="alert-dialog-trigger"
            {...props}
        />
    );
}

export function AlertDialogPortal(props: AlertDialogPrimitive.Portal.Props) {
    return (
        <AlertDialogPrimitive.Portal
            data-slot="alert-dialog-portal"
            {...props}
        />
    );
}

export function AlertDialogOverlay({
    className,
    ...props
}: AlertDialogPrimitive.Backdrop.Props) {
    return (
        <AlertDialogPrimitive.Backdrop
            data-slot="alert-dialog-overlay"
            className={cn(
                "fixed inset-0 z-50 bg-scrim duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
                className,
            )}
            {...props}
        />
    );
}

export function AlertDialogContent({
    className,
    ...props
}: AlertDialogPrimitive.Popup.Props) {
    return (
        <AlertDialogPortal>
            <AlertDialogOverlay />
            <AlertDialogPrimitive.Popup
                data-slot="alert-dialog-content"
                className={cn(
                    "fixed left-1/2 top-1/2 z-50 grid w-full max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-neutral p-6 outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95 sm:rounded-md",
                    className,
                )}
                {...props}
            />
        </AlertDialogPortal>
    );
}

export function AlertDialogHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="alert-dialog-header"
            className={cn(
                "flex flex-col gap-2 text-center sm:text-left",
                className,
            )}
            {...props}
        />
    );
}

/** Cancel first, then the action; right-aligned from `sm` up. */
export function AlertDialogFooter({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="alert-dialog-footer"
            className={cn(
                "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
                className,
            )}
            {...props}
        />
    );
}

export function AlertDialogTitle({
    className,
    ...props
}: AlertDialogPrimitive.Title.Props) {
    return (
        <AlertDialogPrimitive.Title
            data-slot="alert-dialog-title"
            className={cn("text-heading-20 leading-none", className)}
            {...props}
        />
    );
}

export function AlertDialogDescription({
    className,
    ...props
}: AlertDialogPrimitive.Description.Props) {
    return (
        <AlertDialogPrimitive.Description
            data-slot="alert-dialog-description"
            className={cn("text-copy-14 text-muted-foreground", className)}
            {...props}
        />
    );
}

/**
 * The confirming action: closes the dialog on click, like the Radix action
 * it replaces. Destructive by default, since that is what this dialog is for.
 */
export function AlertDialogAction({
    className,
    variant = "destructive",
    ...props
}: Omit<AlertDialogPrimitive.Close.Props, "className"> & {
    className?: string;
    variant?: "default" | "destructive";
}) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-action"
            render={<Button variant={variant} className={className} />}
            {...props}
        />
    );
}

export function AlertDialogCancel({
    className,
    ...props
}: Omit<AlertDialogPrimitive.Close.Props, "className"> & {
    className?: string;
}) {
    return (
        <AlertDialogPrimitive.Close
            data-slot="alert-dialog-cancel"
            render={<Button variant="secondary" className={className} />}
            {...props}
        />
    );
}
