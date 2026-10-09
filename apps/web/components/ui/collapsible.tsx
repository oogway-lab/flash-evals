"use client";

import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export function Collapsible(props: CollapsiblePrimitive.Root.Props) {
    return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

/**
 * Trigger with a leading chevron that rotates a quarter turn when open.
 * With `render`, the element renders as-is (no chevron, no styling).
 */
export function CollapsibleTrigger({
    className,
    children,
    render,
    ...props
}: Omit<CollapsiblePrimitive.Trigger.Props, "className"> & {
    className?: string;
}) {
    if (render !== undefined) {
        return (
            <CollapsiblePrimitive.Trigger
                data-slot="collapsible-trigger"
                render={render}
                className={className}
                {...props}
            >
                {children}
            </CollapsiblePrimitive.Trigger>
        );
    }
    return (
        <CollapsiblePrimitive.Trigger
            data-slot="collapsible-trigger"
            className={cn(
                "group inline-flex items-center gap-2 rounded-sm text-label-14 text-on-surface transition-colors hover:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
                className,
            )}
            {...props}
        >
            <ChevronRight
                aria-hidden="true"
                data-slot="collapsible-chevron"
                className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[panel-open]:rotate-90"
            />
            {children}
        </CollapsiblePrimitive.Trigger>
    );
}

/**
 * Unmounted while closed. Pass `keepMounted` to keep the content in the DOM
 * (hidden) so fields inside still submit with their form.
 */
export function CollapsibleContent(props: CollapsiblePrimitive.Panel.Props) {
    return (
        <CollapsiblePrimitive.Panel
            data-slot="collapsible-content"
            {...props}
        />
    );
}
