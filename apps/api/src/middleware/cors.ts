export interface ICorsConfig {
    corsOrigins: string[];
}

const CORS_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
// `X-Upsert` is sent by the direct-upload client PUT; the local adapter (U8)
// PUTs cross-origin to this API, so it must be an allowed request header.
const CORS_HEADERS =
    "Content-Type,Authorization,X-Mosaic-Internal-Token,X-Request-Id,X-Upsert";
const CORS_EXPOSED_HEADERS = "X-Request-Id";

export function isOriginAllowed(
    origin: string | null,
    config: ICorsConfig,
): boolean {
    if (!origin) return false;
    return config.corsOrigins.includes(origin);
}

export function corsHeaders(
    origin: string | null,
    config: ICorsConfig,
): HeadersInit {
    if (!isOriginAllowed(origin, config)) return {};
    return {
        "Access-Control-Allow-Origin": origin!,
        "Access-Control-Allow-Methods": CORS_METHODS,
        "Access-Control-Allow-Headers": CORS_HEADERS,
        "Access-Control-Expose-Headers": CORS_EXPOSED_HEADERS,
        "Access-Control-Allow-Credentials": "true",
        Vary: "Origin",
    };
}

export function preflightResponse(
    request: Request,
    config: ICorsConfig,
): Response {
    const origin = request.headers.get("origin");
    if (!isOriginAllowed(origin, config)) {
        return new Response(null, { status: 403 });
    }
    return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, config),
    });
}
