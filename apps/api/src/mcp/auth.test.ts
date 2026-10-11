import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as ClerkBackend from "@clerk/backend";

const clerkMock = vi.hoisted(() => ({
    authenticateRequest: vi.fn(),
    verifyToken: vi.fn(),
    getUser: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({
    verifyToken: clerkMock.verifyToken,
    createClerkClient: vi.fn(() => ({
        authenticateRequest: clerkMock.authenticateRequest,
        users: { getUser: clerkMock.getUser },
    })),
}));
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { resolveApiFeatureFlags } from "../featureFlags.js";
import { ApiForbiddenError } from "../errors.js";
import {
    hashMcpToken,
    mcpProfileFromOAuthScopes,
    resolveClerkOAuthSubject,
    resolveMcpPrincipal,
} from "./auth.js";

const config: IApiConfig = {
    nodeEnv: "test",
    port: 3001,
    databaseUrl: "postgres://user:pass@example.supabase.co:5432/postgres",
    storageAdapter: "local",
    supabaseUrl: "https://example.supabase.co",
    supabaseServiceRoleKey: "service-role",
    supabaseStorageBucket: "mosaic-images",
    clerkSecretKey: "sk_test",
    mosaicTenancyMode: "single-org",
    mosaicAllowedEmailDomain: "example.com",
    corsOrigins: [],
    mosaicLlmProvider: "openai",
    sttCapabilityProbes: {},
    profilingEnabled: false,
    mosaicMcpTokenPepper: "pepper",
    mosaicMcpRawTokenFallbackEnabled: false,
    featureFlags: resolveApiFeatureFlags({}),
};

describe("MCP auth", () => {
    beforeEach(() => {
        clerkMock.authenticateRequest.mockReset();
        clerkMock.verifyToken
            .mockReset()
            .mockResolvedValue({ iss: "https://clerk.example.com" });
        clerkMock.getUser.mockReset();
    });

    it("hashes tokens with the configured pepper", () => {
        expect(hashMcpToken("mcp_test", "pepper")).toBe(
            hashMcpToken("mcp_test", "pepper"),
        );
        expect(hashMcpToken("mcp_test", "pepper")).not.toBe(
            hashMcpToken("mcp_test", "other"),
        );
    });

    it("maps OAuth profile scopes and defaults existing clients to eval", () => {
        expect(mcpProfileFromOAuthScopes([])).toBe("eval");
        expect(mcpProfileFromOAuthScopes(["flash-evals:read"])).toBe("read");
        expect(mcpProfileFromOAuthScopes(["flash-evals:admin"])).toBe("admin");
        expect(
            mcpProfileFromOAuthScopes([
                "flash-evals:read",
                "flash-evals:admin",
            ]),
        ).toBe("admin");
    });

    it("rejects raw bearer tokens unless fallback mode is enabled", async () => {
        const db: IDb = { query: vi.fn() };

        await expect(
            resolveMcpPrincipal(
                db,
                config,
                new Request("https://api.example.com/mcp", {
                    headers: { authorization: "Bearer mcp_test" },
                }),
            ),
        ).rejects.toThrow(
            new ApiForbiddenError("MCP OAuth is not configured."),
        );
    });

    it("resolves raw bearer tokens to Flash Evals principals when fallback is enabled", async () => {
        const query = vi
            .fn()
            .mockResolvedValueOnce({
                rows: [
                    {
                        token_id: "token-1",
                        user_id: "user-1",
                        team_id: "team-1",
                        email: "teammate@example.com",
                        name: "Teammate",
                    },
                ],
            })
            .mockResolvedValueOnce({ rows: [] });
        const db: IDb = { query };

        const principal = await resolveMcpPrincipal(
            db,
            { ...config, mosaicMcpRawTokenFallbackEnabled: true },
            new Request("https://api.example.com/mcp", {
                headers: { authorization: "Bearer mcp_test" },
            }),
        );

        expect(principal).toEqual({
            tokenId: "token-1",
            authMode: "raw-token",
            profile: "admin",
            userId: "user-1",
            teamId: "team-1",
            email: "teammate@example.com",
            name: "Teammate",
        });
        expect(query).toHaveBeenNthCalledWith(
            2,
            "update mcp_access_tokens set last_used_at = now() where id = $1",
            ["token-1"],
        );
        expect(query.mock.calls[0]?.[0]).toContain("u.team_id = mat.team_id");
    });

    it("revokes existing raw MCP access when the current Clerk email changes domains", async () => {
        const query = vi.fn(async () => ({
            rows: [
                {
                    token_id: "token-1",
                    user_id: "user-1",
                    team_id: "team-1",
                    email: "alice@oogwaylabs.com",
                    clerk_user_id: "clerk-user-1",
                    name: "Alice",
                },
            ],
        })) as never;
        const db: IDb = { query };
        clerkMock.getUser.mockResolvedValue({
            primaryEmailAddress: {
                emailAddress: "alice@outside.example",
                verification: { status: "verified" },
            },
        });

        await expect(
            resolveMcpPrincipal(
                db,
                {
                    ...config,
                    mosaicAllowedEmailDomain: "oogwaylabs.com",
                    mosaicMcpRawTokenFallbackEnabled: true,
                },
                new Request("https://api.example.com/mcp", {
                    headers: { authorization: "Bearer mcp_test" },
                }),
            ),
        ).rejects.toThrow(
            "This Flash Evals account is not allowed to use MCP.",
        );
        expect(query).toHaveBeenCalledTimes(1);
        expect(clerkMock.getUser).toHaveBeenCalledWith("clerk-user-1");
    });

    it("rejects raw tokens whose stored team does not match the user", async () => {
        const db: IDb = {
            query: vi.fn(async () => ({ rows: [] })) as never,
        };

        await expect(
            resolveMcpPrincipal(
                db,
                { ...config, mosaicMcpRawTokenFallbackEnabled: true },
                new Request("https://api.example.com/mcp", {
                    headers: { authorization: "Bearer mcp_test" },
                }),
            ),
        ).rejects.toThrow(new ApiForbiddenError("Invalid MCP bearer token."));
    });

    it("verifies Clerk OAuth tokens and returns the Clerk subject", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });

        await expect(
            resolveClerkOAuthSubject("header.payload.signature", {
                resourceUrl: "https://api.example.com/mcp",
                issuer: "https://clerk.example.com",
                secretKey: "sk_test",
                publishableKey: "pk_test",
                jwtKey: "jwt-key",
                clientId: "oauth-client",
                dynamicClients: false,
            }),
        ).resolves.toBe("clerk-user-1");
        expect(clerkMock.authenticateRequest).toHaveBeenCalledWith(
            expect.objectContaining({ url: "https://api.example.com/mcp" }),
            expect.objectContaining({
                acceptsToken: "oauth_token",
                audience: "https://api.example.com/mcp",
                authorizedParties: undefined,
            }),
        );
        expect(clerkMock.verifyToken).toHaveBeenCalledWith(
            "header.payload.signature",
            {
                jwtKey: "jwt-key",
                audience: "https://api.example.com/mcp",
                authorizedParties: undefined,
                headerType: ["at+jwt", "application/at+jwt"],
            },
        );
    });

    it("rejects Clerk session tokens and wrong OAuth clients", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "session_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
            }),
        });

        await expect(
            resolveClerkOAuthSubject("header.payload.signature", {
                resourceUrl: "https://api.example.com/mcp",
                issuer: "https://clerk.example.com",
                secretKey: "sk_test",
                publishableKey: "pk_test",
                jwtKey: "jwt-key",
                clientId: "oauth-client",
                dynamicClients: false,
            }),
        ).rejects.toThrow("Invalid or expired Clerk OAuth token.");

        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "other-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });

        await expect(
            resolveClerkOAuthSubject("header.payload.signature", {
                resourceUrl: "https://api.example.com/mcp",
                issuer: "https://clerk.example.com",
                secretKey: "sk_test",
                publishableKey: "pk_test",
                jwtKey: "jwt-key",
                clientId: "oauth-client",
                dynamicClients: false,
            }),
        ).rejects.toThrow(
            "OAuth token was not issued for this Flash Evals MCP client.",
        );
    });

    it("rejects opaque OAuth tokens even if Clerk authenticates them", async () => {
        const actual =
            await vi.importActual<typeof ClerkBackend>("@clerk/backend");
        clerkMock.verifyToken.mockImplementation(actual.verifyToken);
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });

        await expect(
            resolveClerkOAuthSubject("oat_synthetic_opaque", {
                resourceUrl: "https://api.example.com/mcp",
                issuer: "https://clerk.example.com",
                secretKey: "sk_test",
                publishableKey: "pk_test",
                jwtKey: "jwt-key",
                clientId: "oauth-client",
                dynamicClients: false,
            }),
        ).rejects.toMatchObject({ reason: "issuer_verification_failed" });
    });

    // With MOSAIC_MCP_OAUTH_DYNAMIC_CLIENTS=true and no MOSAIC_MCP_OAUTH_CLIENT_ID,
    // both client guards are skipped rather than failed — that is what lets
    // dynamically registered clients (Codex, Cursor, MCP Inspector) work at all.
    // It is also the whole security cost of enabling DCR, so it is asserted
    // explicitly rather than left implied.
    it("accepts any OAuth client when no client id is pinned", async () => {
        const dynamicConfig = {
            resourceUrl: "https://api.example.com/mcp",
            issuer: "https://clerk.example.com",
            secretKey: "sk_test",
            publishableKey: "pk_test",
            jwtKey: "jwt-key",
            dynamicClients: true,
        };

        for (const clientId of [
            "statically-configured-client",
            "dynamically-registered-client",
            "some-client-nobody-vetted",
        ]) {
            clerkMock.authenticateRequest.mockResolvedValue({
                toAuth: () => ({
                    isAuthenticated: true,
                    tokenType: "oauth_token",
                    clientId,
                    userId: "clerk-user-1",
                    scopes: [],
                }),
            });
            await expect(
                resolveClerkOAuthSubject(
                    "header.payload.signature",
                    dynamicConfig,
                ),
            ).resolves.toBe("clerk-user-1");
        }

        // authorizedParties must be omitted, not narrowed to some default —
        // passing a list here would make Clerk reject every dynamic client.
        expect(clerkMock.authenticateRequest).toHaveBeenLastCalledWith(
            expect.anything(),
            expect.objectContaining({ authorizedParties: undefined }),
        );
    });

    it("still rejects non-OAuth tokens when no client id is pinned", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "session_token",
                clientId: "dynamically-registered-client",
                userId: "clerk-user-1",
            }),
        });

        await expect(
            resolveClerkOAuthSubject("header.payload.signature", {
                resourceUrl: "https://api.example.com/mcp",
                issuer: "https://clerk.example.com",
                secretKey: "sk_test",
                publishableKey: "pk_test",
                jwtKey: "jwt-key",
                dynamicClients: true,
            }),
        ).rejects.toThrow("Invalid or expired Clerk OAuth token.");
    });

    it("resolves OAuth subjects to linked Flash Evals principals", async () => {
        clerkMock.authenticateRequest.mockResolvedValue({
            toAuth: () => ({
                isAuthenticated: true,
                tokenType: "oauth_token",
                clientId: "oauth-client",
                userId: "clerk-user-1",
                scopes: [],
            }),
        });
        clerkMock.getUser.mockResolvedValue({
            primaryEmailAddress: {
                emailAddress: "Teammate@Example.com",
                verification: { status: "verified" },
            },
        });
        const db: IDb = {
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

        await expect(
            resolveMcpPrincipal(
                db,
                {
                    ...config,
                    mosaicMcpEnabled: true,
                    mosaicMcpResourceUrl: "https://api.example.com/mcp",
                    mosaicMcpOAuthClientId: "oauth-client",
                    clerkIssuer: "https://clerk.example.com",
                    clerkPublishableKey: "pk_test",
                    clerkJwtKey: "jwt-key",
                },
                new Request("https://api.example.com/mcp", {
                    headers: {
                        authorization: "Bearer header.payload.signature",
                    },
                }),
            ),
        ).resolves.toEqual({
            authMode: "oauth",
            profile: "eval",
            userId: "user-1",
            teamId: "team-1",
            email: "teammate@example.com",
            name: "Teammate",
        });
    });

    it("rejects an OAuth user whose current verified email changed domains", async () => {
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
                emailAddress: "alice@outside.example",
                verification: { status: "verified" },
            },
        });
        const db: IDb = {
            query: vi.fn(async () => ({
                rows: [
                    {
                        id: "user-1",
                        clerk_user_id: "clerk-user-1",
                        team_id: "team-1",
                        email: "alice@oogwaylabs.com",
                        name: "Alice",
                    },
                ],
            })) as never,
        };

        await expect(
            resolveMcpPrincipal(
                db,
                {
                    ...config,
                    mosaicAllowedEmailDomain: "oogwaylabs.com",
                    mosaicMcpEnabled: true,
                    mosaicMcpResourceUrl: "https://api.example.com/mcp",
                    mosaicMcpOAuthClientId: "oauth-client",
                    clerkIssuer: "https://clerk.example.com",
                    clerkPublishableKey: "pk_test",
                    clerkJwtKey: "jwt-key",
                },
                new Request("https://api.example.com/mcp", {
                    headers: {
                        authorization: "Bearer header.payload.signature",
                    },
                }),
            ),
        ).rejects.toThrow(
            "This Flash Evals account is not allowed to use MCP.",
        );
    });

    it("rejects unverified current Clerk emails for OAuth MCP access", async () => {
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
                emailAddress: "alice@oogwaylabs.com",
                verification: { status: "unverified" },
            },
        });
        const db: IDb = {
            query: vi.fn(async () => ({
                rows: [
                    {
                        id: "user-1",
                        clerk_user_id: "clerk-user-1",
                        team_id: "team-1",
                        email: "alice@oogwaylabs.com",
                        name: "Alice",
                    },
                ],
            })) as never,
        };

        await expect(
            resolveMcpPrincipal(
                db,
                {
                    ...config,
                    mosaicAllowedEmailDomain: "oogwaylabs.com",
                    mosaicMcpEnabled: true,
                    mosaicMcpResourceUrl: "https://api.example.com/mcp",
                    mosaicMcpOAuthClientId: "oauth-client",
                    clerkIssuer: "https://clerk.example.com",
                    clerkPublishableKey: "pk_test",
                    clerkJwtKey: "jwt-key",
                },
                new Request("https://api.example.com/mcp", {
                    headers: {
                        authorization: "Bearer header.payload.signature",
                    },
                }),
            ),
        ).rejects.toThrow(
            "A currently verified email address is required for MCP access.",
        );
    });
});
