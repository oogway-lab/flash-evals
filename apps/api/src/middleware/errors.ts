import { ConfigError } from "../config.js";
import { ApiError, ApiRateLimitedError } from "../errors.js";
import { ApiUnauthorizedError } from "./auth.js";

export interface IErrorPayload {
    error: string;
    message: string;
    path?: string;
    remediation?: string;
}

export function errorResponse(
    err: unknown,
    originHeaders: HeadersInit = {},
): Response {
    const { status, payload } = errorPayload(err);
    const headers = new Headers(originHeaders);
    if (err instanceof ApiRateLimitedError) {
        headers.set("retry-after", String(err.retryAfterSeconds));
    }
    return Response.json(payload, { status, headers });
}

export function errorPayload(err: unknown): {
    status: number;
    payload: IErrorPayload;
} {
    if (err instanceof ApiUnauthorizedError) {
        return {
            status: 401,
            payload: { error: "unauthorized", message: err.message },
        };
    }
    if (err instanceof ConfigError) {
        return {
            status: 500,
            // The detail names env vars; it is logged by the request
            // handler and kept out of the response.
            payload: {
                error: "configuration_error",
                message: "The server is misconfigured. Check the API logs.",
            },
        };
    }
    if (err instanceof ApiError) {
        const fieldError = err as ApiError & {
            path?: unknown;
            remediation?: unknown;
        };
        return {
            status: err.status,
            payload: {
                error: err.code,
                message: err.message,
                ...(typeof fieldError.path === "string"
                    ? { path: fieldError.path }
                    : {}),
                ...(typeof fieldError.remediation === "string"
                    ? { remediation: fieldError.remediation }
                    : {}),
            },
        };
    }
    if (err instanceof Error) {
        return {
            status: 500,
            payload: {
                error: "internal_error",
                message: "Internal server error",
            },
        };
    }
    return {
        status: 500,
        payload: { error: "internal_error", message: "Unknown error" },
    };
}
