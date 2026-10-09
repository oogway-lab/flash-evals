import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * The one heading for a page section (`h2`, `text-heading-20`) or a
 * subsection (`as="h3"`, `text-heading-16`), with an optional description and
 * an actions slot on the right. Use it instead of styling headings by hand.
 */
export function SectionTitle({
    as: Tag = "h2",
    id,
    description,
    actions,
    className,
    children,
}: {
    as?: "h2" | "h3";
    id?: string;
    description?: React.ReactNode;
    actions?: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    const heading = (
        <Tag
            id={id}
            data-slot="section-title"
            className={cn(
                Tag === "h2" ? "text-heading-20" : "text-heading-16",
                "text-on-surface",
                !description && !actions && className,
            )}
        >
            {children}
        </Tag>
    );
    if (!description && !actions) return heading;
    return (
        <div
            data-slot="section-title-group"
            className={cn(
                "flex flex-wrap items-start justify-between gap-x-4 gap-y-2",
                className,
            )}
        >
            <div className="flex min-w-0 flex-col gap-1">
                {heading}
                {description && (
                    <p className="text-copy-14 text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            {actions && (
                <div className="flex shrink-0 items-center gap-2">
                    {actions}
                </div>
            )}
        </div>
    );
}
