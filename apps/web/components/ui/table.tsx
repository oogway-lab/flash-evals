import * as React from "react";
import { cn } from "@/lib/cn";

export function Table({
    className,
    containerClassName,
    ...props
}: React.HTMLAttributes<HTMLTableElement> & {
    /** Classes for the scroll container, e.g. a max height for a sticky header. */
    containerClassName?: string;
}) {
    return (
        <div
            data-slot="table-container"
            className={cn("relative w-full overflow-auto", containerClassName)}
        >
            <table
                className={cn(
                    "w-full caption-bottom text-copy-14 tabular-nums",
                    className,
                )}
                {...props}
            />
        </div>
    );
}

export function TableHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
    return <thead className={cn("[&_tr]:border-b", className)} {...props} />;
}

export function TableBody({
    className,
    ...props
}: React.HTMLAttributes<HTMLTableSectionElement>) {
    return (
        <tbody
            className={cn("[&_tr:last-child]:border-0", className)}
            {...props}
        />
    );
}

export function TableRow({
    className,
    ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
    return (
        <tr
            className={cn(
                "border-b border-border transition-colors hover:bg-muted/60",
                className,
            )}
            {...props}
        />
    );
}

/**
 * `numeric` right-aligns a column (header and cells) so digits line up;
 * everything else is left-aligned text.
 */
export type TableAlign = "start" | "numeric";

export function TableHead({
    className,
    align = "start",
    ...props
}: Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "align"> & {
    align?: TableAlign;
}) {
    return (
        <th
            className={cn(
                "h-10 px-3 text-left align-middle text-label-12 text-muted-foreground [&:has([role=checkbox])]:pr-0",
                align === "numeric" && "text-right",
                className,
            )}
            {...props}
        />
    );
}

export function TableCell({
    className,
    align = "start",
    ...props
}: Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> & {
    align?: TableAlign;
}) {
    return (
        <td
            className={cn(
                "p-3 align-baseline [&:has([role=checkbox])]:pr-0",
                align === "numeric" && "text-right tabular-nums",
                className,
            )}
            {...props}
        />
    );
}
