"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

export const TRANSIENT_STATUS_MS = 4_000;

/**
 * Shows a success message in a fixed-height `role="status"` slot, then clears
 * it. `token` changes on every new success (e.g. the action result object);
 * pass `dismissed` to clear early, e.g. once the user edits again. The slot
 * keeps its height either way so nothing below it moves.
 */
export function TransientStatus({
    token,
    dismissed = false,
    children,
    className,
}: {
    token: unknown;
    dismissed?: boolean;
    children: React.ReactNode;
    className?: string;
}) {
    const [visibleFor, setVisibleFor] = React.useState<unknown>();
    const [seen, setSeen] = React.useState(token);
    // A new token means a new success: show it (adjusting state during render).
    if (token !== seen) {
        setSeen(token);
        setVisibleFor(token);
    }
    React.useEffect(() => {
        if (visibleFor === undefined) return;
        const timer = setTimeout(
            () => setVisibleFor(undefined),
            TRANSIENT_STATUS_MS,
        );
        return () => clearTimeout(timer);
    }, [visibleFor]);

    const visible = visibleFor !== undefined && !dismissed;
    return (
        <p
            role="status"
            className={cn("min-h-5 text-copy-14 text-eval-success", className)}
        >
            {visible ? children : null}
        </p>
    );
}
