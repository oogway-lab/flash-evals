import * as React from "react";
import { cn } from "@/lib/cn";

/** A `<dl>` of metrics. Lay it out with grid classes. */
export function MetricList({
    className,
    ...props
}: React.HTMLAttributes<HTMLDListElement>) {
    return (
        <dl
            data-slot="metric-list"
            className={cn("grid gap-2 text-copy-14", className)}
            {...props}
        />
    );
}

/**
 * One labelled value inside a `MetricList`. Values are Geist Sans with
 * tabular digits; pass `mono` only when the value is an identifier or code.
 * By default it sits on an inset surface; `plain` drops the surface for tiles
 * that already sit inside a card.
 */
export function Metric({
    label,
    value,
    plain = false,
    mono = false,
    className,
}: {
    label: React.ReactNode;
    value: React.ReactNode;
    plain?: boolean;
    mono?: boolean;
    className?: string;
}) {
    return (
        <div
            data-slot="metric"
            className={cn(
                "flex flex-col gap-1",
                !plain && "rounded-sm bg-surface p-3",
                className,
            )}
        >
            <dt className="text-label-12 text-muted-foreground">{label}</dt>
            <dd
                className={cn(
                    "wrap-break-word tabular-nums text-on-surface",
                    mono && "text-mono-13",
                )}
            >
                {value}
            </dd>
        </div>
    );
}
