import * as React from "react";
import { cn } from "@/lib/cn";
import { MISSING_VALUE } from "@/lib/format";

/**
 * A formatted number in Geist Sans. Digits are tabular so columns line up and
 * live counts don't jitter. (Geist Mono is for IDs and code, never numbers.)
 * The missing-value marker renders dimmed and reads as "not available".
 */
export function Num({
    className,
    children,
    ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
    const missing = children === MISSING_VALUE;
    return (
        <span
            data-slot="num"
            className={cn(
                "tabular-nums",
                missing && "text-muted-foreground",
                className,
            )}
            {...props}
        >
            {missing ? (
                <>
                    <span aria-hidden="true">{MISSING_VALUE}</span>
                    <span className="sr-only">not available</span>
                </>
            ) : (
                children
            )}
        </span>
    );
}
