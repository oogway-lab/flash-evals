import { createHash, timingSafeEqual } from "node:crypto";

export interface IAuthConfig {
    internalApiToken?: string;
}

export class ApiUnauthorizedError extends Error {
    constructor(message = "Unauthorized") {
        super(message);
        this.name = "ApiUnauthorizedError";
    }
}

const INTERNAL_TOKEN_HEADER = "x-mosaic-internal-token";

export function assertInternalToken(
    request: Request,
    config: IAuthConfig,
): void {
    if (!config.internalApiToken) {
        throw new ApiUnauthorizedError("Internal API token is not configured");
    }
    if (!hasValidInternalToken(request, config)) {
        throw new ApiUnauthorizedError();
    }
}

/**
 * True when the request carries the configured internal API token. Never
 * throws; returns false when no token is configured.
 */
export function hasValidInternalToken(
    request: Request,
    config: IAuthConfig,
): boolean {
    if (!config.internalApiToken) return false;
    const header = request.headers.get(INTERNAL_TOKEN_HEADER);
    if (header === null) return false;
    return secretsEqual(header, config.internalApiToken);
}

/**
 * Constant-time string comparison. Both sides are hashed first so the
 * comparison always runs over equal-length buffers: a length mismatch neither
 * short-circuits nor leaks the secret's length.
 */
export function secretsEqual(received: string, expected: string): boolean {
    return timingSafeEqual(sha256(received), sha256(expected));
}

function sha256(value: string): Buffer {
    return createHash("sha256").update(value, "utf8").digest();
}
