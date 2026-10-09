"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * A tooltip on a single trigger element, replacing native `title=`. The
 * child should be focusable (button, link, or `tabIndex={0}`) so keyboard
 * users can reach the hint too. A non-focusable trigger is fine only when the
 * same information is also present as `sr-only` text (as `RelativeTime` does),
 * since then nothing is lost to keyboard or screen reader users.
 *
 * Base UI tooltips are visual-only and don't link the popup to the trigger
 * (Radix did, via `aria-describedby`). The hint is often the only
 * description, so while it is open the trigger is wired to it here.
 */
export function Hint({
    content,
    side,
    children,
}: {
    content: React.ReactNode;
    side?: React.ComponentProps<typeof TooltipContent>["side"];
    children: React.ReactElement;
}) {
    const contentId = React.useId();
    const [open, setOpen] = React.useState(false);
    return (
        <Tooltip open={open} onOpenChange={setOpen}>
            <TooltipTrigger
                render={children}
                aria-describedby={open ? contentId : undefined}
            />
            <TooltipContent id={contentId} side={side}>
                {content}
            </TooltipContent>
        </Tooltip>
    );
}

/**
 * Plain text with a hint: a dotted underline marks it, and it takes focus so
 * the hint is reachable from the keyboard.
 */
export function HintText({
    hint,
    className,
    children,
}: {
    hint: React.ReactNode;
    className?: string;
    children: React.ReactNode;
}) {
    return (
        <Hint content={hint}>
            <span
                tabIndex={0}
                data-slot="hint-text"
                className={cn(
                    "cursor-help rounded-sm underline decoration-dotted decoration-muted-foreground/60 underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    className,
                )}
            >
                {children}
            </span>
        </Hint>
    );
}
