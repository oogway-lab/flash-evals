import {
    checkPublicProviderBaseUrl,
    ProviderBaseUrlError,
    resolveHostAddresses,
    type ProviderHostResolver,
} from "@flash-evals/llm-core/public-base-url";
import { ApiBadRequestError, ApiServiceUnavailableError } from "./errors.js";

export { resolveHostAddresses, type ProviderHostResolver };

/** DNS lookup failed. A 400 when saving; retryable (503) when re-validating. */
class ProviderHostLookupError extends ApiBadRequestError {}

export async function normalizedProviderBaseUrl(
    baseUrl: string | undefined,
    resolveHost: ProviderHostResolver,
): Promise<string | null> {
    try {
        return await checkPublicProviderBaseUrl(baseUrl, resolveHost);
    } catch (err) {
        if (!(err instanceof ProviderBaseUrlError)) throw err;
        throw err.kind === "lookup"
            ? new ProviderHostLookupError(err.message)
            : new ApiBadRequestError(err.message);
    }
}

/**
 * Re-validate a stored provider base URL right before it is used for a
 * request. The URL was validated when saved, but DNS can change afterwards
 * (rebinding), so resolve it again and refuse non-public targets. A failed
 * lookup is a retryable 503; a non-public or malformed URL stays a 400.
 */
export async function assertStoredProviderBaseUrl(
    baseUrl: string,
    resolveHost: ProviderHostResolver = resolveHostAddresses,
): Promise<string> {
    try {
        return (
            (await normalizedProviderBaseUrl(baseUrl, resolveHost)) ?? baseUrl
        );
    } catch (err) {
        if (err instanceof ProviderHostLookupError) {
            throw new ApiServiceUnavailableError(
                "The saved provider base URL could not be resolved right now. Try again.",
            );
        }
        if (!(err instanceof ApiBadRequestError)) throw err;
        throw new ApiBadRequestError(
            `The saved provider base URL is no longer allowed (${err.message}). Update it in Settings, then try again.`,
        );
    }
}
