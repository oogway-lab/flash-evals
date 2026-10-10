import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clerkMock = vi.hoisted(() => ({
    authenticateRequest: vi.fn(),
    getUser: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
    createClerkClient: vi.fn(() => ({
        authenticateRequest: clerkMock.authenticateRequest,
        users: { getUser: clerkMock.getUser },
    })),
}));

import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import {
    handleMcpRequest,
    MCP_PATH_PROTECTED_RESOURCE_METADATA_PATH,
    MCP_PROTECTED_RESOURCE_METADATA_PATH,
} from "./http.js";

const config: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://user:pass@example.supabase.co:5432/postgres",
    storageAdapter: "local",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    supabaseStorageBucket: "mosaic-images",
    clerkSecretKey: "sk_test",
    clerkPublishableKey: "pk_test",
    clerkIssuer: "https://clerk.example.com",
    clerkJwtKey: "jwt-key",
    mosaicTenancyMode: "single-org",
    mosaicAllowedEmailDomain: "example.com",
    corsOrigins: ["https://web.example.com"],
    mosaicLlmProvider: "openai",
    sttCapabilityProbes: {},
    profilingEnabled: false,
    mosaicMcpEnabled: true,
    mosaicMcpAllowedOrigins: ["https://claude.example.com"],
    mosaicMcpResourceUrl: "https://api.example.com/mcp",
    mosaicMcpOAuthClientId: "oauth-client",
    featureFlags: resolveApiFeatureFlags({}),
};

function dbWithLinkedUser(): IDb {
    return {
        query: vi.fn(async () => ({
            rows: [
                {
                    id: "user-1",
                    team_id: "team-1",
                    email: "teammate@example.com",
                    name: "Teammate",
                },
            ],
        })) as never,
    };
}

describe("MCP HTTP OAuth", () => {
    beforeEach(() => {
        clerkMock.authenticateRequest.mockReset();
        clerkMock.getUser.mockReset().mockResolvedValue({
            primaryEmailAddress: {
                emailAddress: "teammate@example.com",
                verification: { status: "verified" },
            },
        });
        // Rejected MCP requests log `mcp.request.failed`; keep test output clean.
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("serves OAuth protected resource metadata", async () => {
        const response = await handleMcpRequest(
            new Request(
                `https://api.example.com${MCP_PROTECTED_RESOURCE_METADATA_PATH}`,
            ),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        await expect(response.json()).resolves.toEqual({
            resource: "https://api.example.com/mcp",
            authorization_servers: ["https://clerk.example.com"],
            bearer_methods_supported: ["header"],
        });
    });

    it("serves OAuth metadata at the path-derived resource URL", async () => {
        const response = await handleMcpRequest(
            new Request(
                `https://api.example.com${MCP_PATH_PROTECTED_RESOURCE_METADATA_PATH}`,
            ),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toMatchObject({
            resource: "https://api.example.com/mcp",
        });
    });

    it("handles MCP CORS preflight with the MCP origin allowlist", async () => {
        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "OPTIONS",
                headers: {
                    origin: "https://claude.example.com",
                    "access-control-request-method": "POST",
                    "access-control-request-headers":
                        "Authorization,Content-Type,MCP-Protocol-Version",
                },
            }),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(204);
        expect(response.headers.get("access-control-allow-origin")).toBe(
            "https://claude.example.com",
        );
        expect(response.headers.get("access-control-allow-headers")).toContain(
            "MCP-Protocol-Version",
        );
        expect(clerkMock.authenticateRequest).not.toHaveBeenCalled();
    });

    it("rejects disallowed MCP preflight origins", async () => {
        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "OPTIONS",
                headers: {
                    origin: "https://evil.example.com",
                    "access-control-request-method": "POST",
                },
            }),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(403);
        expect(clerkMock.authenticateRequest).not.toHaveBeenCalled();
    });

    it("points unauthenticated MCP callers at OAuth metadata", async () => {
        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/list",
                    params: {},
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(401);
        expect(response.headers.get("www-authenticate")).toBe(
            'Bearer resource_metadata="https://api.example.com/.well-known/oauth-protected-resource/mcp"',
        );
    });

    it("returns authorization errors for linked-account failures without restarting OAuth", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });
        const db: IDb = {
            query: vi.fn(async () => ({ rows: [] })) as never,
        };

        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/list",
                    params: {},
                }),
            }),
            { config, db },
        );

        expect(response.status).toBe(403);
        expect(response.headers.get("www-authenticate")).toBeNull();
        await expect(response.json()).resolves.toEqual({
            error: "forbidden",
            message:
                "Flash Evals account is not linked for this Clerk user. Sign in to Flash Evals once before using MCP.",
        });
    });

    it("initializes MCP after Clerk OAuth principal resolution", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });

        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-06-18",
                        capabilities: {},
                        clientInfo: { name: "test", version: "0" },
                    },
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("access-control-allow-origin")).toBe(
            "https://claude.example.com",
        );
        await expect(response.json()).resolves.toMatchObject({
            result: {
                serverInfo: { name: "mosaic-evals" },
            },
            id: 1,
        });
    });

    it("denies MCP OAuth when the current verified Clerk email is outside the allowed domain", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
            }),
        });
        clerkMock.getUser.mockResolvedValue({
            primaryEmailAddress: {
                emailAddress: "teammate@outside.example",
                verification: { status: "verified" },
            },
        });

        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "initialize",
                    params: {
                        protocolVersion: "2025-06-18",
                        capabilities: {},
                        clientInfo: { name: "test", version: "0" },
                    },
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(403);
        expect(clerkMock.getUser).toHaveBeenCalledWith("clerk-user-1");
    });

    it("lists tools and executes get_current_user after OAuth", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });

        const listResponse = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/list",
                    params: {},
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );
        expect(listResponse.status).toBe(200);
        const listed = await listResponse.json();
        expect(listed).toMatchObject({
            result: {
                tools: expect.arrayContaining([
                    expect.objectContaining({ name: "get_current_user" }),
                    expect.objectContaining({
                        name: "import_dataset_image_answers",
                    }),
                    expect.objectContaining({ name: "list_projects" }),
                    expect.objectContaining({ name: "create_project" }),
                    expect.objectContaining({
                        name: "create_workflow_llm_route_version",
                        inputSchema: expect.objectContaining({
                            additionalProperties: false,
                        }),
                    }),
                    expect.objectContaining({
                        name: "list_workflow_llm_capabilities",
                    }),
                    expect.objectContaining({
                        name: "set_workflow_llm_default",
                    }),
                ]),
            },
        });
        const listedToolNames = listed.result.tools.map(
            (tool: { name: string }) => tool.name,
        );
        expect(listedToolNames).not.toContain("set_provider_key");
        expect(listedToolNames).not.toContain("clear_workflow_llm_default");

        const callResponse = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 2,
                    method: "tools/call",
                    params: {
                        name: "get_current_user",
                        arguments: {},
                    },
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );
        expect(callResponse.status).toBe(200);
        await expect(callResponse.json()).resolves.toMatchObject({
            result: {
                structuredContent: {
                    data: {
                        userId: "user-1",
                        teamId: "team-1",
                        email: "teammate@example.com",
                    },
                },
            },
            id: 2,
        });

        const rejectedMutation = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 3,
                    method: "tools/call",
                    params: {
                        name: "clear_workflow_llm_default",
                        arguments: {
                            projectId: "11111111-1111-4111-8111-111111111111",
                        },
                    },
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );
        expect(rejectedMutation.status).toBe(200);
        await expect(rejectedMutation.json()).resolves.toMatchObject({
            result: { isError: true },
            id: 3,
        });

        const invalidInput = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://claude.example.com",
                    "content-type": "application/json",
                    accept: "application/json, text/event-stream",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 4,
                    method: "tools/call",
                    params: {
                        name: "list_dataset_items",
                        arguments: {
                            projectId: "11111111-1111-4111-8111-111111111111",
                            datasetId: "22222222-2222-4222-8222-222222222222",
                            limit: 101,
                        },
                    },
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );
        expect(invalidInput.status).toBe(200);
        const invalidBody = await invalidInput.json();
        expect(
            invalidBody.error?.code === -32602 ||
                invalidBody.result?.isError === true,
        ).toBe(true);
    });

    it("rejects disallowed origins before auth work", async () => {
        const response = await handleMcpRequest(
            new Request("https://api.example.com/mcp", {
                method: "POST",
                headers: {
                    authorization: "Bearer header.payload.signature",
                    origin: "https://evil.example.com",
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "tools/list",
                }),
            }),
            { config, db: dbWithLinkedUser() },
        );

        expect(response.status).toBe(403);
        expect(clerkMock.authenticateRequest).not.toHaveBeenCalled();
    });
});
