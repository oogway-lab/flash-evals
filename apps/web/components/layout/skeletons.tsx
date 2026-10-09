import * as React from "react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";

// Skeleton compositions for route `loading.tsx` files and Suspense fallbacks.
// Heights follow the line heights of the type tokens they stand in for
// (text-copy-14 → h-5, text-heading-24 → h-8, text-heading-20 → h-7,
// text-heading-16 → h-6, 40px controls → h-10) so the page does not jump when real content replaces
// them.

/**
 * Root for a loading page or section: marks the region busy and announces
 * "Loading <label>" to assistive tech. The skeleton blocks themselves are
 * `aria-hidden`. Like `Page`, it owns the `gap-10` rhythm between its
 * children; pass `className="gap-4"` for a section.
 */
export function LoadingRegion({
    label,
    className,
    children,
}: {
    label: string;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <div
            aria-busy="true"
            data-slot="loading-region"
            className={cn("flex flex-col gap-10", className)}
        >
            <span role="status" className="sr-only">
                Loading {label}
            </span>
            {children}
        </div>
    );
}

/** Mirrors `PageHeader`. */
export function PageHeaderSkeleton({
    breadcrumbs = false,
    description = false,
    action = false,
    actionClassName = "h-10 w-32",
    variant = "default",
}: {
    breadcrumbs?: boolean;
    description?: boolean;
    action?: boolean;
    /** Size of the action block, e.g. full width on mobile. */
    actionClassName?: string;
    variant?: "default" | "hero";
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
                {breadcrumbs && <Skeleton className="h-5 w-40" />}
                <Skeleton
                    className={
                        variant === "hero"
                            ? "h-10 w-72 max-w-full"
                            : "h-8 w-56 max-w-full"
                    }
                />
                {description && (
                    <div className="flex flex-col gap-1">
                        <Skeleton className="h-6 w-96 max-w-full" />
                        {/* descriptions wrap to a second line on phones */}
                        <Skeleton className="h-5 w-2/3 sm:hidden" />
                    </div>
                )}
            </div>
            {action && <Skeleton className={cn("shrink-0", actionClassName)} />}
        </div>
    );
}

/**
 * A table with a header row and `rows` body rows. Sits in a `Card` by default
 * because list tables across the app do.
 */
export function TableSkeleton({
    columns,
    rows = 5,
    card = true,
    action = false,
    className,
}: {
    columns: number;
    rows?: number;
    card?: boolean;
    /** The last column holds a 40px row action, which sets the row height. */
    action?: boolean;
    className?: string;
}) {
    const table = (
        <Table>
            <TableHeader>
                <TableRow className="hover:bg-transparent">
                    {Array.from({ length: columns }).map((_, column) => (
                        <TableHead key={column}>
                            <Skeleton className="h-4 w-16" />
                        </TableHead>
                    ))}
                </TableRow>
            </TableHeader>
            <TableBody>
                {Array.from({ length: rows }).map((_, row) => (
                    <TableRow key={row} className="hover:bg-transparent">
                        {Array.from({ length: columns }).map((_, column) =>
                            action && column === columns - 1 ? (
                                <TableCell key={column}>
                                    <Skeleton className="ml-auto size-10" />
                                </TableCell>
                            ) : (
                                <TableCell key={column}>
                                    <Skeleton
                                        className={cn(
                                            "h-5",
                                            column === 0 ? "w-32" : "w-20",
                                        )}
                                    />
                                </TableCell>
                            ),
                        )}
                    </TableRow>
                ))}
            </TableBody>
        </Table>
    );

    if (!card) return <div className={className}>{table}</div>;
    return <Card className={className}>{table}</Card>;
}

/** A `Card` with a title, a description and `lines` body lines. */
export function CardSkeleton({
    lines = 2,
    icon = false,
    description = true,
    action = false,
    titleClassName = "h-6 w-32",
    className,
    children,
}: {
    lines?: number;
    /** A 20px icon above the title, as on workspace and project cards. */
    icon?: boolean;
    description?: boolean;
    /** A full-width 40px button pinned to the bottom of the card. */
    action?: boolean;
    /** Size of the title block, e.g. taller for an inline-editable name. */
    titleClassName?: string;
    className?: string;
    /** Replaces the body lines, e.g. with a `FormSkeleton`. */
    children?: React.ReactNode;
}) {
    return (
        <Card className={cn(action && "flex h-full flex-col", className)}>
            <CardHeader className={icon ? "gap-3" : undefined}>
                {icon && <Skeleton className="size-5" />}
                <Skeleton className={titleClassName} />
                {description && <Skeleton className="h-5 w-48 max-w-full" />}
            </CardHeader>
            {children ? (
                <CardContent>{children}</CardContent>
            ) : lines > 0 ? (
                <CardContent className="space-y-2">
                    {Array.from({ length: lines }).map((_, line) => (
                        <Skeleton
                            key={line}
                            className={cn(
                                "h-5",
                                line === lines - 1 ? "w-2/3" : "w-full",
                            )}
                        />
                    ))}
                </CardContent>
            ) : null}
            {action && (
                <CardContent className="mt-auto pt-6">
                    <Skeleton className="h-10 w-full" />
                </CardContent>
            )}
        </Card>
    );
}

/** `count` cards in the same grid classes the real page uses. */
export function CardGridSkeleton({
    count = 6,
    className = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
    ...card
}: {
    count?: number;
    className?: string;
} & Omit<React.ComponentProps<typeof CardSkeleton>, "className" | "children">) {
    return (
        <div className={className}>
            {Array.from({ length: count }).map((_, index) => (
                <CardSkeleton key={index} {...card} />
            ))}
        </div>
    );
}

/**
 * A section heading with an optional description line. `size` follows the
 * heading's type token: `section` for `SectionTitle` (`text-heading-20`),
 * `subsection` for `text-heading-16`.
 */
export function SectionHeadingSkeleton({
    size = "section",
    description = false,
    className,
}: {
    size?: "section" | "subsection";
    description?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col gap-1", className)}>
            <Skeleton
                className={size === "section" ? "h-7 w-40" : "h-6 w-32"}
            />
            {description && <Skeleton className="h-5 w-80 max-w-full" />}
        </div>
    );
}

/** Label and 40px control pairs, optionally ending in a submit button. */
export function FormSkeleton({
    fields = 3,
    submit = true,
    className,
}: {
    fields?: number;
    submit?: boolean;
    className?: string;
}) {
    return (
        <div className={cn("flex flex-col gap-6", className)}>
            {Array.from({ length: fields }).map((_, field) => (
                <div key={field} className="flex flex-col gap-2">
                    <Skeleton className="h-5 w-28" />
                    <Skeleton className="h-10 w-full" />
                </div>
            ))}
            {submit && <Skeleton className="h-10 w-32" />}
        </div>
    );
}
