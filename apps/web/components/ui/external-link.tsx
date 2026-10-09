import * as React from "react";
import { ExternalLink as ExternalLinkIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/** Marks a link that opens a new tab, visually and for screen readers. */
export function NewTabIcon() {
    return (
        <>
            <ExternalLinkIcon
                aria-hidden="true"
                data-slot="new-tab-icon"
                className="size-3.5 shrink-0"
            />
            <span className="sr-only"> (opens in a new tab)</span>
        </>
    );
}

/** An off-site link: new tab, `rel="noopener noreferrer"`, and the icon. */
export function ExternalLink({
    className,
    children,
    ...props
}: Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel">) {
    return (
        <a
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
                "inline-flex items-center gap-1 rounded-sm text-accent-text underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                className,
            )}
            {...props}
        >
            {children}
            <NewTabIcon />
        </a>
    );
}
