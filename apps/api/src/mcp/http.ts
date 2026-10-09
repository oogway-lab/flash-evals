import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { resolveMcpOAuthConfig } from "../config.js";
import type { IApiRuntime } from "../server.js";
import { ApiForbiddenError, ApiNotFoundError } from "../errors.js";
import { errorResponse } from "../middleware/errors.js";
import { requestIdFromHeaders } from "../observability/requestId.js";
import { logApiEvent } from "../observability/logger.js";
import { McpAuthenticationError, resolveMcpPrincipal } from "./auth.js";
import { registerMosaicMcpCapabilities } from "./registry.js";

export const MCP_PATH = "/mcp";
export const MCP_PROTECTED_RESOURCE_METADATA_PATH =
    "/.well-known/oauth-protected-resource";
export const MCP_PATH_PROTECTED_RESOURCE_METADATA_PATH =
    `${MCP_PROTECTED_RESOURCE_METADATA_PATH}${MCP_PATH}`;

const MCP_CORS_METHODS = "GET,POST,OPTIONS";
const MCP_CORS_HEADERS =
    "Authorization,Content-Type,MCP-Protocol-Version,X-Request-Id";
const MCP_CORS_EXPOSED_HEADERS =
    "MCP-Protocol-Version,WWW-Authenticate,X-Request-Id";

export async function handleMcpRequest(
    request: Request,
    runtime: IApiRuntime,
): Promise<Response> {
    const requestId = requestIdFromHeaders(request.headers);
    const origin = request.headers.get("origin");
    const allowedOrigins = runtime.config.mosaicMcpAllowedOrigins ?? [];
    const headers = mcpCorsHeaders(origin, allowedOrigins);
    headers.set("x-request-id", requestId);

    try {
        if (!runtime.config.mosaicMcpEnabled) {
            throw new ApiNotFoundError("MCP is not enabled.");
        }
        const url = new URL(request.url);
        const oauthConfig = resolveMcpOAuthConfig(runtime.config);
        if (isMcpProtectedResourceMetadataPath(url.pathname)) {
            if (!oauthConfig) throw new ApiNotFoundError("MCP OAuth is not enabled.");
            if (!origin) headers.set("access-control-allow-origin", "*");
            return Response.json(
                {
                    resource: oauthConfig.resourceUrl,
                    authorization_servers: [oauthConfig.issuer],
                    bearer_methods_supported: ["header"],
                },
                { headers },
            );
        }

        if (request.method === "OPTIONS") {
            assertMcpOrigin(request, allowedOrigins);
            return new Response(null, { status: 204, headers });
        }

        assertMcpOrigin(request, allowedOrigins);

        let principal;
        try {
            principal = await resolveMcpPrincipal(runtime.db, runtime.config, request);
        } catch (err) {
            if (oauthConfig && err instanceof McpAuthenticationError) {
                return unauthorizedOAuthResponse(oauthConfig.resourceUrl, headers);
            }
            throw err;
        }
        const server = new McpServer({
            name: "mosaic-evals",
            version: "0.1.0",
        });
        registerMosaicMcpCapabilities(server, { runtime, principal });

        const transport = new WebStandardStreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
            allowedOrigins,
        });
        let response: Response;
        await server.connect(transport);
        try {
            response = await transport.handleRequest(request);
        } finally {
            await server.close().catch((err) => {
                logApiEvent("warn", "mcp.server.close.failed", {
                    requestId,
                    errorName: err instanceof Error ? err.name : "UnknownError",
                });
            });
        }
        headers.forEach((value, key) => response.headers.set(key, value));
        return response;
    } catch (err) {
        logApiEvent("warn", "mcp.request.failed", {
            requestId,
            errorName: err instanceof Error ? err.name : "UnknownError",
        });
        return errorResponse(err, headers);
    }
}

export function isMcpPath(pathname: string): boolean {
    return pathname === MCP_PATH || isMcpProtectedResourceMetadataPath(pathname);
}

function unauthorizedOAuthResponse(resourceUrl: string, headers: Headers): Response {
    const metadataUrl = new URL(
        MCP_PATH_PROTECTED_RESOURCE_METADATA_PATH,
        resourceUrl,
    );
    headers.set(
        "www-authenticate",
        `Bearer resource_metadata="${metadataUrl.toString()}"`,
    );
    return new Response("Unauthorized", { status: 401, headers });
}

function isMcpProtectedResourceMetadataPath(pathname: string): boolean {
    return (
        pathname === MCP_PROTECTED_RESOURCE_METADATA_PATH ||
        pathname === MCP_PATH_PROTECTED_RESOURCE_METADATA_PATH
    );
}

function mcpCorsHeaders(origin: string | null, allowedOrigins: string[]): Headers {
    const headers = new Headers();
    headers.set("access-control-allow-methods", MCP_CORS_METHODS);
    headers.set("access-control-allow-headers", MCP_CORS_HEADERS);
    headers.set("access-control-expose-headers", MCP_CORS_EXPOSED_HEADERS);
    headers.set("vary", "Origin");
    if (origin && allowedOrigins.includes(origin)) {
        headers.set("access-control-allow-origin", origin);
    }
    return headers;
}

function assertMcpOrigin(request: Request, allowedOrigins: string[]): void {
    const origin = request.headers.get("origin")?.trim();
    if (!origin) return;
    if (!allowedOrigins.includes(origin)) {
        throw new ApiForbiddenError("Origin is not allowed for MCP.");
    }
}
