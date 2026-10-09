"use client";

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs";
import { cn } from "@/lib/cn";

/** Owns the gap between the tab list and its panel. */
export function Tabs({ className, ...props }: TabsPrimitive.Root.Props) {
    return (
        <TabsPrimitive.Root
            data-slot="tabs"
            className={cn("flex flex-col gap-4", className)}
            {...props}
        />
    );
}

/**
 * Arrow keys move focus and select, like the Radix tabs this replaces
 * (Base UI defaults `activateOnFocus` to false).
 */
export function TabsList({
    className,
    activateOnFocus = true,
    ...props
}: TabsPrimitive.List.Props) {
    return (
        <TabsPrimitive.List
            data-slot="tabs-list"
            activateOnFocus={activateOnFocus}
            className={cn(
                "inline-flex h-10 items-center justify-center rounded-sm border border-border bg-muted p-1 text-muted-foreground",
                className,
            )}
            {...props}
        />
    );
}

export function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
    return (
        <TabsPrimitive.Tab
            data-slot="tabs-trigger"
            className={cn(
                "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-label-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 data-active:border data-active:border-border data-active:bg-neutral data-active:text-on-surface",
                className,
            )}
            {...props}
        />
    );
}

export function TabsContent({
    className,
    ...props
}: TabsPrimitive.Panel.Props) {
    return (
        <TabsPrimitive.Panel
            data-slot="tabs-content"
            className={cn("focus-visible:outline-none", className)}
            {...props}
        />
    );
}
