"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** How often an active comparison's page reloads its server data. */
export const COMPARISON_REFRESH_MS = 5_000;

/**
 * Reloads the page's server data every few seconds while `active`, and
 * only while the tab is visible. Renders nothing.
 */
export function AutoRefresh({
    active,
    intervalMs = COMPARISON_REFRESH_MS,
}: {
    active: boolean;
    intervalMs?: number;
}) {
    const router = useRouter();
    useEffect(() => {
        if (!active) return undefined;
        const timer = setInterval(() => {
            if (document.visibilityState === "visible") router.refresh();
        }, intervalMs);
        return () => clearInterval(timer);
    }, [active, intervalMs, router]);
    return null;
}
