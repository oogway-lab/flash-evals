import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A page's root. It owns the vertical rhythm (`gap-10`) between the
 * `PageHeader` and the page's sections, so children never add their own
 * top or bottom margins.
 */
export function Page({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            data-slot="page"
            className={cn("flex flex-col gap-10", className)}
            {...props}
        />
    );
}
