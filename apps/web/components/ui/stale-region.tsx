import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Content that stays on screen while a replacement loads: dimmed and marked
 * `aria-busy` when `stale`, so the layout holds instead of collapsing to a
 * spinner. Announce the loading itself with a separate status element.
 */
export function StaleRegion({
    stale,
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement> & { stale: boolean }) {
    return (
        <div
            data-slot="stale-region"
            aria-busy={stale || undefined}
            className={cn(
                "transition-opacity",
                stale && "opacity-60",
                className,
            )}
            {...props}
        />
    );
}
