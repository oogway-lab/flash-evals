import type { Route } from "next";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { SectionTitle } from "@/components/layout/section-title";

export interface IReadinessMeta {
    hasSchema: boolean;
    itemCount: number;
}

export function firstMissingReadinessItem(
    meta: IReadinessMeta,
): string | undefined {
    if (!meta.hasSchema) return "Define an output schema.";
    if (meta.itemCount < 1) return "Add at least one item.";
    return undefined;
}

export function ReadinessChecklist({
    meta,
    itemsHref,
    className,
}: {
    meta: IReadinessMeta;
    itemsHref: Route;
    className?: string;
}) {
    const items = [
        {
            label: "Output schema defined",
            ok: meta.hasSchema,
            href: undefined,
            action: undefined,
        },
        {
            label: "At least one item added",
            ok: meta.itemCount > 0,
            href: itemsHref,
            action: "Add item",
        },
    ];

    return (
        <div className={cn("flex flex-col gap-3", className)}>
            <SectionTitle as="h3">Dataset readiness</SectionTitle>
            <ul className="flex flex-col gap-2">
                {items.map((item) => (
                    <li
                        key={item.label}
                        className="flex items-center gap-2 text-copy-14"
                    >
                        {item.ok ? (
                            <Check className="size-4 shrink-0 text-eval-success" />
                        ) : (
                            <X className="size-4 shrink-0 text-error" />
                        )}
                        <span
                            className={cn(
                                "flex-1 text-on-surface",
                                !item.ok && "text-muted-foreground",
                            )}
                        >
                            {item.label}
                        </span>
                        {!item.ok && item.href && item.action && (
                            <Link
                                href={item.href}
                                className="text-label-12 text-primary underline-offset-4 hover:underline"
                            >
                                {item.action}
                            </Link>
                        )}
                    </li>
                ))}
            </ul>
        </div>
    );
}
