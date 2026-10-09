"use client";

import * as React from "react";
import { Hint } from "@/components/ui/hint";
import { cn } from "@/lib/cn";
import { Num } from "@/components/ui/num";
import {
    MISSING_VALUE,
    fmtDate,
    fmtDateShort,
    fmtRelativeTime,
} from "@/lib/format";

// One shared minute tick re-renders every mounted RelativeTime.
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | undefined;

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    timer ??= setInterval(() => {
        for (const notify of listeners) notify();
    }, 60_000);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && timer !== undefined) {
            clearInterval(timer);
            timer = undefined;
        }
    };
}

/**
 * A timestamp in a list or table: relative text ("3 days ago") in a
 * `<time dateTime>`, with the exact UTC time in a tooltip for mouse users and
 * as visually hidden text for screen readers. It is deliberately not a tab
 * stop: a table of timestamps would otherwise add one stop per row, and the
 * exact time is already in the text a screen reader reads.
 *
 * Relative text depends on "now", which differs between server and browser,
 * so it would cause a hydration mismatch. The server and the hydrating
 * client therefore render the same exact date (`getServerSnapshot`), and the
 * relative text takes over right after hydration and refreshes every minute.
 */
export function RelativeTime({
    value,
    className,
}: {
    value: Date | string;
    className?: string;
}) {
    const parsed = new Date(value);
    const valid = !Number.isNaN(parsed.getTime());
    const iso = valid ? parsed.toISOString() : "";
    const text = React.useSyncExternalStore(
        subscribe,
        () => (valid ? fmtRelativeTime(iso, Date.now()) : MISSING_VALUE),
        () => (valid ? fmtDateShort(iso) : MISSING_VALUE),
    );
    if (!valid) return <Num className={className}>{MISSING_VALUE}</Num>;
    const exact = fmtDate(iso);
    return (
        <Hint content={exact}>
            <time dateTime={iso} className={cn("whitespace-nowrap", className)}>
                {text}
                <span className="sr-only"> ({exact})</span>
            </time>
        </Hint>
    );
}
