const DEFAULT_APP_URL = "https://flashevals.dev";
const DEFAULT_APP_TITLE = "Flash Evals";
const OPENROUTER_HOST = "openrouter.ai";

type Env = Record<string, string | undefined>;

/**
 * App attribution headers read by Vercel AI Gateway to fill the "App" column
 * in its usage logs. Metadata only: an invalid configured value is dropped
 * with a warning instead of being sent, so it can never fail a request.
 */
export function gatewayAttributionHeaders(): Record<string, string> {
    return attributionHeaders(processEnv());
}

/**
 * The same attribution for OpenRouter, sent only when `url` points at
 * openrouter.ai so a team's custom base URL never receives it.
 */
export function openRouterAttributionHeaders(
    url: string | undefined,
): Record<string, string> {
    return isOpenRouterUrl(url) ? attributionHeaders(processEnv()) : {};
}

function attributionHeaders(env: Env): Record<string, string> {
    if (env.MOSAIC_PROVIDER_ATTRIBUTION?.trim().toLowerCase() === "off") {
        return {};
    }
    return {
        "http-referer":
            headerValue(env, "MOSAIC_GATEWAY_HTTP_REFERER") ?? DEFAULT_APP_URL,
        "x-title":
            headerValue(env, "MOSAIC_GATEWAY_APP_TITLE") ?? DEFAULT_APP_TITLE,
    };
}

const warnedKeys = new Set<string>();

function headerValue(env: Env, key: string): string | undefined {
    const value = env[key]?.trim();
    if (!value) return undefined;
    // fetch rejects header values outside printable ASCII.
    if (/^[\x20-\x7E]+$/.test(value)) return value;
    if (!warnedKeys.has(key)) {
        warnedKeys.add(key);
        console.warn(
            `${key} contains characters that cannot be sent in an HTTP header; using the default attribution instead.`,
        );
    }
    return undefined;
}

function isOpenRouterUrl(url: string | undefined): boolean {
    if (!url) return false;
    try {
        return new URL(url).hostname === OPENROUTER_HOST;
    } catch {
        return false;
    }
}

function processEnv(): Env {
    return (
        (
            globalThis as {
                process?: { env?: Env };
            }
        ).process?.env ?? {}
    );
}
