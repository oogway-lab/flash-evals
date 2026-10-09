"use client";

import * as React from "react";
import { Radio as RadioPrimitive } from "@base-ui/react/radio";
import { RadioGroup as RadioGroupPrimitive } from "@base-ui/react/radio-group";
import { cn } from "@/lib/cn";

/**
 * Radio group with roving focus: Tab enters, arrow keys move and select.
 * Give it `name` (and `defaultValue`/`required`) to submit with a form; Base
 * UI then renders the hidden input for the checked option.
 */
export function RadioGroup({ className, ...props }: RadioGroupPrimitive.Props) {
    return (
        <RadioGroupPrimitive
            data-slot="radio-group"
            className={cn("grid gap-3", className)}
            {...props}
        />
    );
}

function RadioDot() {
    return (
        <span
            aria-hidden="true"
            className="flex size-4 shrink-0 items-center justify-center rounded-full border border-border bg-background group-data-checked:border-primary"
        >
            <RadioPrimitive.Indicator className="size-2 rounded-full bg-primary" />
        </span>
    );
}

/**
 * A selectable option. With a `description` it is a card; without one it is
 * a compact pill. Hover changes the surface; the selected option shows a
 * filled dot and a stronger border.
 */
export function RadioCard({
    value,
    title,
    description,
    className,
    ...props
}: Omit<RadioPrimitive.Root.Props, "title" | "children" | "className"> & {
    className?: string;
    title: React.ReactNode;
    description?: React.ReactNode;
}) {
    const compact = description === undefined;
    return (
        <RadioPrimitive.Root
            value={value}
            data-slot="radio-card"
            className={cn(
                "group flex rounded-sm border border-border bg-neutral text-left transition-colors hover:bg-muted/60",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "data-checked:border-on-surface/40 data-checked:bg-surface",
                "data-disabled:cursor-not-allowed data-disabled:opacity-50",
                compact
                    ? "inline-flex items-center gap-2 px-3 py-2"
                    : "w-full items-start gap-3 p-4",
                className,
            )}
            {...props}
        >
            <span className={cn(!compact && "mt-0.5")}>
                <RadioDot />
            </span>
            {compact ? (
                <span className="text-label-14 text-on-surface">{title}</span>
            ) : (
                <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-label-14 text-on-surface">
                        {title}
                    </span>
                    <span className="text-copy-14 text-muted-foreground">
                        {description}
                    </span>
                </span>
            )}
        </RadioPrimitive.Root>
    );
}
