import { FlashEvalsApiError } from "@flash-evals/api-contract";

export const GENERIC_CLIENT_ERROR_MESSAGE =
    "Something went wrong. Please try again.";

/**
 * An error whose message is written for the person using the app and is safe
 * to return from a server action as-is (validation failures, "not found").
 */
export class UserFacingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "UserFacingError";
    }
}

// Domain errors defined elsewhere in the web app whose messages are fixed,
// user-written strings. Matched by name so this module stays free of imports
// from the auth and dataset layers.
const USER_FACING_ERROR_NAMES = new Set([
    "UnauthorizedError",
    "ForbiddenError",
    "DeleteItemBlockedError",
    "DuplicateItemSourceNameError",
]);

/**
 * Message for a server action result. Only errors meant for the user pass
 * through; anything else (database, storage, network, configuration) is
 * logged here and replaced, so driver text, response bodies, and env-var names
 * never reach the browser.
 */
export function clientErrorMessage(err: unknown): string {
    if (isUserFacingError(err)) return err.message.trim() || err.name;
    console.error("Unhandled server action error:", err);
    return GENERIC_CLIENT_ERROR_MESSAGE;
}

function isUserFacingError(err: unknown): err is Error {
    if (!(err instanceof Error)) return false;
    // The API already returns a generic message for its own internal faults.
    if (err instanceof FlashEvalsApiError) return true;
    if (err instanceof UserFacingError) return true;
    return USER_FACING_ERROR_NAMES.has(err.name);
}

/**
 * Full detail, including the cause chain. For logs and persisted worker
 * failure reasons only; use `clientErrorMessage` for anything sent to the
 * browser.
 */
export function errorMessage(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    const databaseMessage = databaseQueryErrorMessage(err);
    if (databaseMessage) return databaseMessage;
    const message = err.message.trim() || err.name;
    const cause = causeMessage((err as Error & { cause?: unknown }).cause);
    if (!cause || cause === message) return message;
    return `${message}: ${cause}`;
}

/**
 * Drizzle wraps every failed query (a driver error, a connection that could
 * not be had, a dropped connection) as "Failed query: <SQL>\nparams: <values>"
 * with the real reason as its cause. Stored as is, the reason sat after the
 * whole statement and its parameters (which can hold a full transcript), so it
 * was cut off wherever the message was shown. Lead with the reason instead,
 * keep the start of the statement, and leave the parameters out.
 */
function databaseQueryErrorMessage(err: Error): string | undefined {
    const query = (err as Error & { query?: unknown }).query;
    if (typeof query !== "string" || !err.message.startsWith("Failed query:"))
        return undefined;
    const cause = (err as Error & { cause?: unknown }).cause;
    const reason =
        cause instanceof Error
            ? withCode(cause, errorMessage(cause))
            : (causeMessage(cause) ?? "no reason reported by the driver");
    return `Database query failed: ${reason} (query: ${shortQuery(query)})`;
}

function withCode(err: Error, message: string): string {
    const code = (err as Error & { code?: unknown }).code;
    return typeof code === "string" && code && !message.startsWith(code)
        ? `${code} ${message}`
        : message;
}

const QUERY_PREVIEW_CHARS = 120;

function shortQuery(query: string): string {
    const flat = query.replace(/\s+/g, " ").trim();
    return flat.length > QUERY_PREVIEW_CHARS
        ? `${flat.slice(0, QUERY_PREVIEW_CHARS)}…`
        : flat;
}

function causeMessage(cause: unknown): string | undefined {
    if (!cause) return undefined;
    if (cause instanceof Error) return cause.message.trim() || cause.name;
    if (isRecord(cause)) {
        const code = typeof cause.code === "string" ? cause.code : undefined;
        const message =
            typeof cause.message === "string" && cause.message.trim()
                ? cause.message.trim()
                : undefined;
        if (code && message) return `${code} ${message}`;
        return message ?? code;
    }
    const text = String(cause).trim();
    return text || undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
