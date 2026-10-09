"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

const LINE_CLAMP: Record<2 | 3 | 4, string> = {
    2: "line-clamp-2",
    3: "line-clamp-3",
    4: "line-clamp-4",
};

/**
 * Text clamped to a few lines, with a "Show more" toggle that only appears
 * when the text actually overflows.
 */
export function ClampedText({
    lines = 3,
    className,
    children,
}: {
    lines?: 2 | 3 | 4;
    className?: string;
    children: React.ReactNode;
}) {
    const ref = React.useRef<HTMLParagraphElement>(null);
    const id = React.useId();
    const [expanded, setExpanded] = React.useState(false);
    const [overflows, setOverflows] = React.useState(false);

    React.useLayoutEffect(() => {
        const el = ref.current;
        if (!el || expanded) return;
        const measure = () =>
            setOverflows(el.scrollHeight > el.clientHeight + 1);
        measure();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [expanded, children]);

    return (
        <div data-slot="clamped-text">
            <p
                ref={ref}
                id={id}
                className={cn(
                    "wrap-break-word",
                    !expanded && LINE_CLAMP[lines],
                    className,
                )}
            >
                {children}
            </p>
            {(overflows || expanded) && (
                <Button
                    type="button"
                    variant="link"
                    size="sm"
                    className="text-label-12"
                    aria-expanded={expanded}
                    aria-controls={id}
                    onClick={() => setExpanded((v) => !v)}
                >
                    {expanded ? "Show less" : "Show more"}
                </Button>
            )}
        </div>
    );
}
