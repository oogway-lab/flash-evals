"use client";

import * as React from "react";
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

export function Sheet(props: SheetPrimitive.Root.Props) {
    return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

export function SheetTrigger(props: SheetPrimitive.Trigger.Props) {
    return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

export function SheetClose(props: SheetPrimitive.Close.Props) {
    return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

export function SheetContent({
    className,
    children,
    side = "right",
    ...props
}: SheetPrimitive.Popup.Props & {
    side?: "right" | "left";
}) {
    return (
        <SheetPrimitive.Portal>
            <SheetPrimitive.Backdrop
                data-slot="sheet-overlay"
                className="fixed inset-0 z-50 bg-scrim duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
            />
            <SheetPrimitive.Popup
                data-slot="sheet-content"
                data-side={side}
                className={cn(
                    "fixed z-50 flex h-full flex-col gap-4 border-border bg-neutral outline-none duration-200 ease-out data-open:animate-in data-closed:animate-out",
                    side === "right" &&
                        "inset-y-0 right-0 h-full w-full max-w-xl border-l data-closed:slide-out-to-right data-open:slide-in-from-right",
                    side === "left" &&
                        "inset-y-0 left-0 h-full w-full max-w-xl border-r data-closed:slide-out-to-left data-open:slide-in-from-left",
                    className,
                )}
                {...props}
            >
                {children}
                <SheetPrimitive.Close className="absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
                    <X className="h-4 w-4" />
                    <span className="sr-only">Close</span>
                </SheetPrimitive.Close>
            </SheetPrimitive.Popup>
        </SheetPrimitive.Portal>
    );
}

export function SheetHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="sheet-header"
            className={cn(
                "flex flex-col gap-2 border-b border-border p-6",
                className,
            )}
            {...props}
        />
    );
}

export function SheetTitle({
    className,
    ...props
}: SheetPrimitive.Title.Props) {
    return (
        <SheetPrimitive.Title
            data-slot="sheet-title"
            className={cn("text-heading-20 text-on-surface", className)}
            {...props}
        />
    );
}

export function SheetBody({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="sheet-body"
            className={cn("flex-1 overflow-y-auto p-6", className)}
            {...props}
        />
    );
}
