import { isRecord } from "./objects";

/**
 * Delay a provider asked for, from `retryAfterMs` or a `Retry-After` header
 * (seconds or an HTTP date). Accepts both fetch `Headers` and plain records.
 */
export function retryAfterMs(error: unknown): number | undefined {
    if (!isRecord(error)) return undefined;
    const direct = error.retryAfterMs;
    if (typeof direct === "number" && Number.isFinite(direct) && direct >= 0)
        return direct;
    const headers = error.headers;
    const value =
        headers instanceof Headers
            ? headers.get("retry-after")
            : isRecord(headers)
              ? headers["retry-after"]
              : undefined;
    if (typeof value !== "string") return undefined;
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(value);
    return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}
