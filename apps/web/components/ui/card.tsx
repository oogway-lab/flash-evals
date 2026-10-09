import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * A real, self-contained group. `variant="inset"` is a region inside a card
 * (or on the canvas): surface fill, no border, so a bordered box never sits
 * inside another bordered box.
 */
export function Card({
    className,
    variant = "default",
    ...props
}: React.HTMLAttributes<HTMLDivElement> & {
    variant?: "default" | "inset";
}) {
    return (
        <div
            data-slot="card"
            data-variant={variant}
            className={cn(
                "rounded-sm text-card-foreground",
                variant === "inset"
                    ? "bg-surface"
                    : "border border-border bg-card",
                className,
            )}
            {...props}
        />
    );
}

export function CardHeader({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("flex flex-col gap-1 p-4 pb-0", className)}
            {...props}
        />
    );
}

/** `h3` by default; pass `as="h2"` when the card is a top-level section. */
export function CardTitle({
    as: Tag = "h3",
    className,
    ...props
}: React.HTMLAttributes<HTMLHeadingElement> & { as?: "h2" | "h3" }) {
    return (
        <Tag
            data-slot="card-title"
            className={cn("text-heading-16", className)}
            {...props}
        />
    );
}

export function CardDescription({
    className,
    ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
    return (
        <p
            className={cn("text-copy-14 text-muted-foreground", className)}
            {...props}
        />
    );
}

export function CardContent({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn("p-4", className)} {...props} />;
}

export function CardFooter({
    className,
    ...props
}: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn("flex items-center gap-2 p-4 pt-0", className)}
            {...props}
        />
    );
}
