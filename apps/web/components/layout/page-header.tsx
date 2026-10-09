import type { Route } from "next";
import Link from "next/link";
import { cn } from "@/lib/cn";

export function PageHeader({
    title,
    titleContent,
    description,
    meta,
    breadcrumbs,
    action,
    variant = "default",
}: {
    title: string;
    /** Replaces the plain `h1`, e.g. an inline-editable name. It must render the page's one `h1` (`text-heading-24`). */
    titleContent?: React.ReactNode;
    description?: string;
    /** A line under the title, e.g. an `IdLabel`. */
    meta?: React.ReactNode;
    breadcrumbs?: { label: string; href?: Route }[];
    action?: React.ReactNode;
    variant?: "default" | "hero";
}) {
    return (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 flex-col gap-2">
                {breadcrumbs && breadcrumbs.length > 0 && (
                    <nav className="flex items-center gap-1 text-copy-14 text-muted-foreground">
                        {breadcrumbs.map((crumb, i) => (
                            <span key={i} className="flex items-center gap-1">
                                {i > 0 && (
                                    <span
                                        className="text-muted-foreground"
                                        aria-hidden
                                    >
                                        /
                                    </span>
                                )}
                                {crumb.href ? (
                                    <Link
                                        href={crumb.href}
                                        className="hover:text-primary hover:underline"
                                    >
                                        {crumb.label}
                                    </Link>
                                ) : (
                                    <span
                                        className="text-on-surface"
                                        aria-current={
                                            i === breadcrumbs.length - 1
                                                ? "page"
                                                : undefined
                                        }
                                    >
                                        {crumb.label}
                                    </span>
                                )}
                            </span>
                        ))}
                    </nav>
                )}
                {titleContent ?? (
                    <h1
                        className={cn(
                            variant === "hero"
                                ? "text-heading-32 text-on-surface"
                                : "text-heading-24 text-on-surface",
                        )}
                    >
                        {title}
                    </h1>
                )}
                {meta}
                {description && (
                    <p className="text-copy-16 text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    );
}
