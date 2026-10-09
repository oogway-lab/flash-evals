import type * as React from "react";
import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";
import { SectionTitle } from "@/components/layout/section-title";

export function EmptyState({
    title,
    description,
    actionLabel,
    actionHref,
    action,
    variant = "default",
}: {
    title: string;
    description: string;
    actionLabel?: string;
    actionHref?: Route;
    /** Custom action node, e.g. a "Clear filter" button. Takes precedence over `actionHref`. */
    action?: React.ReactNode;
    /**
     * `plain`: no box, for an empty state that already sits inside a card.
     * `filter-empty`: the same, for a filter or search that matched nothing.
     * `inline`: a compact, left-aligned note for empty fields and lists.
     */
    variant?: "default" | "blocker" | "filter-empty" | "plain" | "inline";
}) {
    const isFilterEmpty = variant === "filter-empty";
    const isUnboxed = isFilterEmpty || variant === "plain";
    const isInline = variant === "inline";
    const linkAction =
        actionLabel && actionHref ? (
            <Link
                href={actionHref}
                className={buttonVariants({
                    variant: isFilterEmpty ? "secondary" : "default",
                })}
            >
                {actionLabel}
            </Link>
        ) : undefined;
    const resolvedAction = action ?? linkAction;

    return (
        <div
            data-variant={variant}
            className={cn(
                "flex flex-col items-center justify-center gap-1 text-center",
                isUnboxed
                    ? "px-6 py-10"
                    : isInline
                      ? "items-start rounded-sm border border-dashed border-border px-3 py-3 text-left"
                      : "rounded-sm border border-dashed border-border bg-card px-6 py-12",
                variant === "blocker" && "items-start text-left",
            )}
        >
            <SectionTitle as="h3">{title}</SectionTitle>
            <p className="max-w-sm text-copy-14 text-muted-foreground">
                {description}
            </p>
            {resolvedAction && (
                <div
                    className={cn(
                        "flex flex-wrap items-center gap-2 pt-3",
                        isFilterEmpty && "justify-center",
                    )}
                >
                    {resolvedAction}
                </div>
            )}
        </div>
    );
}
