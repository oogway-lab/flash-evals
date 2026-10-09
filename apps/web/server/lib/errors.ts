import { MosaicApiError } from "@mosaic/api-contract";

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
    if (err instanceof MosaicApiError) return true;
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
    const message = err.message.trim() || err.name;
    const cause = causeMessage((err as Error & { cause?: unknown }).cause);
    if (!cause || cause === message) return message;
    return `${message}: ${cause}`;
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
