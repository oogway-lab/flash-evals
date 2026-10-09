// `since` records the flag's introduction date so
// scripts/check-feature-flags.mjs can flag long-lived, never-enabled flags as
// stale. Update it if a flag is intentionally re-scoped.
export const API_FEATURE_FLAGS = {
    analyticsEvents: {
        env: "MOSAIC_FLAG_ANALYTICS_EVENTS",
        defaultValue: false,
        since: "2026-07-08",
    },
    errorTracking: {
        env: "MOSAIC_FLAG_ERROR_TRACKING",
        defaultValue: false,
        since: "2026-07-08",
    },
    profiling: {
        env: "MOSAIC_FLAG_PROFILING",
        defaultValue: false,
        since: "2026-07-08",
    },
} as const;

export type ApiFeatureFlag = keyof typeof API_FEATURE_FLAGS;
export type ApiFeatureFlags = Record<ApiFeatureFlag, boolean>;

type Env = Record<string, string | undefined>;

export function resolveApiFeatureFlags(env: Env): ApiFeatureFlags {
    return Object.fromEntries(
        Object.entries(API_FEATURE_FLAGS).map(([name, flag]) => [
            name,
            parseFlag(env[flag.env], flag.defaultValue),
        ]),
    ) as ApiFeatureFlags;
}

function parseFlag(raw: string | undefined, defaultValue: boolean): boolean {
    const value = raw?.trim().toLowerCase();
    if (!value) return defaultValue;
    if (["1", "true", "yes", "on"].includes(value)) return true;
    if (["0", "false", "no", "off"].includes(value)) return false;
    return defaultValue;
}
