import { formatCost } from "@mosaic/llm-core";

/** The one way Flash Evals renders a value that is missing or not applicable. */
export const MISSING_VALUE = "–";

// API values may be null (DB NULL) or undefined (absent); both render as
// the missing-value marker.
type Maybe<T> = T | null | undefined;

function orMissing<T>(value: Maybe<T>, format: (value: T) => string): string {
    return value === null || value === undefined
        ? MISSING_VALUE
        : format(value);
}

/** Scores to `digits` places (2 by default). */
export function fmtScore(s: Maybe<number>, digits = 2): string {
    return orMissing(s, (v) => v.toFixed(digits));
}

export function fmtLatency(ms: Maybe<number>): string {
    return orMissing(ms, (v) => `${Math.round(v)} ms`);
}

export function fmtTokens(tokens: Maybe<number>): string {
    return orMissing(tokens, (v) =>
        new Intl.NumberFormat("en", {
            notation: v >= 100_000 ? "compact" : "standard",
            maximumFractionDigits: v >= 100_000 ? 1 : 0,
        }).format(Math.round(v)),
    );
}

/** `formatCost` from llm-core, with Flash Evals's missing-value marker. */
export function fmtCost(costUsd: Maybe<number>): string {
    return orMissing(costUsd, formatCost);
}

/**
 * One cost formatter for a whole table column: every value shares the `$`
 * unit and the same number of decimals, so digits line up and no row mixes
 * `¢` with `$`. Precision follows the smallest non-zero value (two
 * significant digits, capped at six decimals). Standalone values keep
 * `fmtCost`.
 */
export function formatCostColumn(
    values: readonly Maybe<number>[],
): (costUsd: Maybe<number>) => string {
    let smallest: number | undefined;
    for (const value of values) {
        if (value === null || value === undefined || value <= 0) continue;
        if (smallest === undefined || value < smallest) smallest = value;
    }
    let decimals = 2;
    if (smallest !== undefined) {
        if (smallest < 0.1) decimals = 3;
        if (smallest < 0.01) decimals = 4;
        if (smallest < 0.001) decimals = 5;
        if (smallest < 0.0001) decimals = 6;
    }
    return (costUsd) =>
        orMissing(costUsd, (value) => `$${value.toFixed(decimals)}`);
}

/** Dates render in UTC and say so, e.g. "6/23/26, 4:09:50 PM UTC". */
export function fmtDate(d: Date | string): string {
    return `${new Intl.DateTimeFormat("en-US", {
        dateStyle: "short",
        timeStyle: "medium",
        timeZone: "UTC",
    }).format(new Date(d))} UTC`;
}

/** A date-only form in UTC, e.g. "Jul 6, 2026". */
export function fmtDateShort(d: Date | string): string {
    return new Intl.DateTimeFormat("en-US", {
        dateStyle: "medium",
        timeZone: "UTC",
    }).format(new Date(d));
}

const RELATIVE_FORMAT = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

const RELATIVE_UNITS: Array<{
    unit: Intl.RelativeTimeFormatUnit;
    seconds: number;
}> = [
    { unit: "year", seconds: 365 * 24 * 3600 },
    { unit: "month", seconds: 30 * 24 * 3600 },
    { unit: "day", seconds: 24 * 3600 },
    { unit: "hour", seconds: 3600 },
    { unit: "minute", seconds: 60 },
];

/**
 * "3 days ago", "yesterday", "in 2 hours", or "just now" within a minute.
 * `now` is a parameter so callers control (and tests fix) the clock.
 */
export function fmtRelativeTime(d: Date | string, now: number): string {
    const diffSeconds = Math.round((new Date(d).getTime() - now) / 1000);
    const abs = Math.abs(diffSeconds);
    if (abs < 60) return "just now";
    for (const { unit, seconds } of RELATIVE_UNITS) {
        if (abs >= seconds) {
            return RELATIVE_FORMAT.format(
                Math.trunc(diffSeconds / seconds),
                unit,
            );
        }
    }
    return "just now";
}

export function shortId(id: string, len = 8): string {
    return id.slice(0, len);
}

export function sumTokens(
    promptTokens: number | null | undefined,
    completionTokens: number | null | undefined,
): number | undefined {
    if (promptTokens == null || completionTokens == null) return undefined;
    return promptTokens + completionTokens;
}

export interface Delta {
    text: string;
    direction: "up" | "down" | "flat";
    good: boolean | undefined;
}

export function fmtDelta(
    value: number | undefined,
    baseline: number | undefined,
    lowerIsBetter = false,
): Delta {
    if (value === undefined || baseline === undefined) {
        return { text: MISSING_VALUE, direction: "flat", good: undefined };
    }
    const delta = value - baseline;
    const relative = baseline !== 0 ? delta / baseline : undefined;
    // Treat sub-0.5% (or sub-epsilon absolute) moves as parity.
    const isFlat =
        Math.abs(delta) < 1e-9 ||
        (relative !== undefined && Math.abs(relative) < 0.005);
    if (isFlat) return { text: "0%", direction: "flat", good: undefined };

    const text =
        relative !== undefined
            ? `${relative > 0 ? "+" : ""}${Math.round(relative * 100)}%`
            : `${delta > 0 ? "+" : ""}${delta.toFixed(2)}`;
    const direction = delta > 0 ? "up" : "down";
    const good = lowerIsBetter ? delta < 0 : delta > 0;
    return { text, direction, good };
}
