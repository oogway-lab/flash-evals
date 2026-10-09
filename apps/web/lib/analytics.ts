"use client";

type AnalyticsMetadata = Record<string, string | number | boolean | undefined>;

// `since` records the flag's introduction date so
// scripts/check-feature-flags.mjs can flag long-lived, never-enabled flags as
// stale. Update it if a flag is intentionally re-scoped.
export const WEB_FEATURE_FLAGS = {
    analyticsEvents: {
        env: "NEXT_PUBLIC_MOSAIC_FLAG_ANALYTICS_EVENTS",
        defaultValue: false,
        since: "2026-07-08",
    },
    errorTracking: {
        env: "NEXT_PUBLIC_MOSAIC_FLAG_ERROR_TRACKING",
        defaultValue: false,
        since: "2026-07-08",
    },
} as const;

// NOTE: Next.js only inlines `NEXT_PUBLIC_*` vars for statically written
// `process.env.NEXT_PUBLIC_X` member expressions, so these reads must stay
// literal even though WEB_FEATURE_FLAGS documents the same env names above.
const analyticsKey = process.env.NEXT_PUBLIC_MOSAIC_ANALYTICS_KEY;
const errorTrackingDsn = process.env.NEXT_PUBLIC_MOSAIC_ERROR_TRACKING_DSN;
const debugEnabled = process.env.NEXT_PUBLIC_MOSAIC_ANALYTICS_DEBUG === "true";
const analyticsEnabled = publicFlag(
    process.env.NEXT_PUBLIC_MOSAIC_FLAG_ANALYTICS_EVENTS,
);
const errorTrackingEnabled = publicFlag(
    process.env.NEXT_PUBLIC_MOSAIC_FLAG_ERROR_TRACKING,
);

export function trackProductEvent(
    event: string,
    metadata: AnalyticsMetadata = {},
): void {
    if (!analyticsEnabled || !analyticsKey) return;
    debugLog("analytics.event", { event, ...sanitize(metadata) });
}

export function captureClientException(
    error: unknown,
    metadata: AnalyticsMetadata = {},
): void {
    if (!errorTrackingEnabled || !errorTrackingDsn) return;
    debugLog("error_tracking.capture", {
        errorName: error instanceof Error ? error.name : "UnknownError",
        ...sanitize(metadata),
    });
}

function debugLog(event: string, metadata: AnalyticsMetadata): void {
    if (!debugEnabled) return;
    console.info(
        JSON.stringify({
            event,
            service: "mosaic-web",
            timestamp: new Date().toISOString(),
            ...metadata,
        }),
    );
}

function sanitize(metadata: AnalyticsMetadata): AnalyticsMetadata {
    return Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
    );
}

function publicFlag(raw: string | undefined): boolean {
    const value = raw?.trim().toLowerCase();
    return ["1", "true", "yes", "on"].includes(value ?? "");
}
