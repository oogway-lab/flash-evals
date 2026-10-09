import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Placeholder block for content that is still loading. Size it to match the
 * content it stands in for so nothing shifts when the real content arrives.
 * Hidden from assistive tech; announce loading on the region instead
 * (for example `aria-busy` on the container).
 */
export function Skeleton({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            aria-hidden="true"
            data-slot="skeleton"
            className={cn("animate-pulse rounded-sm bg-muted", className)}
            {...props}
        />
    );
}
