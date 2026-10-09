import { createHash, randomBytes } from "node:crypto";
import { createClerkClient, type MachineAuthObject } from "@clerk/backend";
import {
    resolveMcpOAuthConfig,
    type IApiConfig,
    type IMcpOAuthConfig,
} from "../config.js";
import type { IDb } from "../db.js";
import { ApiForbiddenError } from "../errors.js";

export class McpAuthenticationError extends ApiForbiddenError {}

export interface IMcpPrincipal {
    authMode: "oauth" | "raw-token";
    tokenId?: string;
    userId: string;
    teamId: string;
    email: string;
    name?: string;
}

interface IMcpTokenRow {
    token_id: string;
    user_id: string;
    team_id: string;
    email: string;
    name: string | null;
}

interface IMcpClerkUserRow {
    id: string;
    team_id: string;
    email: string;
    name: string | null;
}

type ClerkOAuthAuth = Extract<
    MachineAuthObject<"oauth_token">,
    { isAuthenticated: true }
>;

export function createMcpTokenSecret(): string {
    return `mcp_${randomBytes(32).toString("base64url")}`;
}

export function hashMcpToken(token: string, pepper?: string): string {
    return createHash("sha256")
        .update(`${pepper ?? ""}:${token}`)
        .digest("hex");
}

export async function resolveMcpPrincipal(
    db: IDb,
    config: IApiConfig,
    request: Request,
): Promise<IMcpPrincipal> {
    const token = bearerToken(request);
    if (!token) throw new McpAuthenticationError("Missing MCP bearer token.");
    const oauthConfig = resolveMcpOAuthConfig(config);
    if (oauthConfig) {
        const clerkUserId = await resolveClerkOAuthSubject(token, oauthConfig);
        return resolveMcpPrincipalForClerkUser(db, clerkUserId);
    }

    if (!config.mosaicMcpRawTokenFallbackEnabled) {
        throw new ApiForbiddenError("MCP OAuth is not configured.");
    }

    return resolveMcpPrincipalForRawToken(db, config, token);
}

export async function resolveMcpPrincipalForRawToken(
    db: IDb,
    config: IApiConfig,
    token: string,
): Promise<IMcpPrincipal> {
    const result = await db.query<IMcpTokenRow>(
        `select
            mat.id as token_id,
            mat.user_id,
            mat.team_id,
            u.email,
            u.name
        from mcp_access_tokens mat
        inner join users u on u.id = mat.user_id
        where mat.token_hash = $1
            and u.team_id = mat.team_id
            and mat.revoked_at is null
        limit 1`,
        [hashMcpToken(token, config.mosaicMcpTokenPepper)],
    );
    const row = result.rows[0];
    if (!row) throw new ApiForbiddenError("Invalid MCP bearer token.");

    await db.query("update mcp_access_tokens set last_used_at = now() where id = $1", [
        row.token_id,
    ]);

    return {
        authMode: "raw-token",
        tokenId: row.token_id,
        userId: row.user_id,
        teamId: row.team_id,
        email: row.email,
        ...(row.name ? { name: row.name } : {}),
    };
}

export async function resolveClerkOAuthSubject(
    token: string,
    config: IMcpOAuthConfig,
): Promise<string> {
    const client = createClerkClient({
        secretKey: config.secretKey,
        publishableKey: config.publishableKey,
        jwtKey: config.jwtKey,
        telemetry: { disabled: true },
    });

    let authCandidate: MachineAuthObject<"oauth_token">;
    try {
        const state = await client.authenticateRequest(
            new Request(config.resourceUrl, {
                headers: { authorization: `Bearer ${token}` },
            }),
            {
                acceptsToken: "oauth_token",
                audience: config.resourceUrl,
                jwtKey: config.jwtKey,
                authorizedParties:
                    config.authorizedParties ??
                    (config.clientId ? [config.clientId] : undefined),
            },
        );
        authCandidate = state.toAuth();
    } catch {
        throw new McpAuthenticationError("Invalid or expired Clerk OAuth token.");
    }

    if (!authCandidate.isAuthenticated || authCandidate.tokenType !== "oauth_token") {
        throw new McpAuthenticationError("Invalid or expired Clerk OAuth token.");
    }
    const auth: ClerkOAuthAuth = authCandidate;
    if (config.clientId && auth.clientId !== config.clientId) {
        throw new ApiForbiddenError(
            "OAuth token was not issued for this Flash Evals MCP client.",
        );
    }
    if (!auth.userId) {
        throw new McpAuthenticationError("OAuth token has no Clerk subject.");
    }
    return auth.userId;
}

export async function resolveMcpPrincipalForClerkUser(
    db: IDb,
    clerkUserId: string,
): Promise<IMcpPrincipal> {
    const result = await db.query<IMcpClerkUserRow>(
        `select id, team_id, email, name
        from users
        where clerk_user_id = $1
        limit 1`,
        [clerkUserId],
    );
    const row = result.rows[0];
    if (!row) {
        throw new ApiForbiddenError(
            "Flash Evals account is not linked for this Clerk user. Sign in to Flash Evals once before using MCP.",
        );
    }

    return {
        authMode: "oauth",
        userId: row.id,
        teamId: row.team_id,
        email: row.email,
        ...(row.name ? { name: row.name } : {}),
    };
}

function bearerToken(request: Request): string | undefined {
    const header = request.headers.get("authorization")?.trim();
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match?.[1]?.trim() || undefined;
}
