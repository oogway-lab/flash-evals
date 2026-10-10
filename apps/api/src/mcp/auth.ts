import { createHash, randomBytes } from "node:crypto";
import { createClerkClient, type MachineAuthObject } from "@clerk/backend";
import {
    isEmailAllowedForDomain,
    normalizeEmailAddress,
} from "@mosaic/api-contract";
import {
    resolveMcpOAuthConfig,
    type IApiConfig,
    type IMcpOAuthConfig,
} from "../config.js";
import type { IDb } from "../db.js";
import { ApiForbiddenError } from "../errors.js";
import type { McpProfile } from "./effects.js";

type McpAuthenticationReason =
    | "missing_bearer"
    | "sdk_exception"
    | "sdk_rejected"
    | "authorized_party_mismatch"
    | "audience_mismatch"
    | "invalid_signature"
    | "expired_token"
    | "token_type_mismatch"
    | "missing_subject";

export class McpAuthenticationError extends ApiForbiddenError {
    constructor(
        message: string,
        readonly reason: McpAuthenticationReason = "sdk_rejected",
    ) {
        super(message);
    }
}

// SDK messages can contain claims or other sensitive values. Classify known
// failures into fixed codes; never retain or log the SDK message itself.
function clerkRejectionReason(message: string | null): McpAuthenticationReason {
    if (message?.startsWith("Invalid JWT Authorized party claim (azp)")) {
        return "authorized_party_mismatch";
    }
    if (
        message?.startsWith("Invalid JWT audience claim") ||
        message?.startsWith("Invalid OAuth audience claim") ||
        message?.startsWith("OAuth audience mismatch.")
    ) {
        return "audience_mismatch";
    }
    if (message?.startsWith("JWT signature is invalid.")) {
        return "invalid_signature";
    }
    if (message?.startsWith("JWT is expired.")) return "expired_token";
    return "sdk_rejected";
}

export interface IMcpPrincipal {
    authMode: "oauth" | "raw-token";
    profile: McpProfile;
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
    clerk_user_id: string | null;
}

interface IMcpClerkUserRow {
    id: string;
    clerk_user_id: string;
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
    if (!token) {
        throw new McpAuthenticationError(
            "Missing MCP bearer token.",
            "missing_bearer",
        );
    }
    const oauthConfig = resolveMcpOAuthConfig(config);
    if (oauthConfig) {
        const identity = await resolveClerkOAuthIdentity(token, oauthConfig);
        return resolveMcpPrincipalForClerkUser(
            db,
            config,
            identity.userId,
            mcpProfileFromOAuthScopes(identity.scopes),
        );
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
            u.clerk_user_id,
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

    let email = normalizeEmailAddress(row.email);
    if (requiresDomainAdmission(config)) {
        if (!isEmailAllowedForDomain(email, config.mosaicAllowedEmailDomain)) {
            throw new ApiForbiddenError(
                "This Flash Evals account is not allowed to use MCP.",
            );
        }
    }
    if (row.clerk_user_id && config.clerkSecretKey) {
        email = await verifyCurrentClerkEmailAdmission(
            row.clerk_user_id,
            config,
        );
    } else if (config.nodeEnv === "production") {
        throw new ApiForbiddenError(
            "A current verified Clerk identity is required for MCP access.",
        );
    }

    await db.query(
        "update mcp_access_tokens set last_used_at = now() where id = $1",
        [row.token_id],
    );

    return {
        authMode: "raw-token",
        // Compatibility for existing opaque MCP tokens, which predate profile scopes.
        profile: "admin",
        tokenId: row.token_id,
        userId: row.user_id,
        teamId: row.team_id,
        email,
        ...(row.name ? { name: row.name } : {}),
    };
}

export async function resolveClerkOAuthSubject(
    token: string,
    config: IMcpOAuthConfig,
): Promise<string> {
    return (await resolveClerkOAuthIdentity(token, config)).userId;
}

export async function resolveClerkOAuthIdentity(
    token: string,
    config: IMcpOAuthConfig,
): Promise<{ userId: string; scopes: string[] }> {
    const client = createClerkClient({
        secretKey: config.secretKey,
        publishableKey: config.publishableKey,
        jwtKey: config.jwtKey,
        telemetry: { disabled: true },
    });

    let authCandidate: MachineAuthObject<"oauth_token">;
    let rejectionReason: McpAuthenticationReason = "sdk_rejected";
    try {
        const state = await client.authenticateRequest(
            new Request(config.resourceUrl, {
                headers: { authorization: `Bearer ${token}` },
            }),
            {
                acceptsToken: "oauth_token",
                audience: config.resourceUrl,
                jwtKey: config.jwtKey,
                // Clerk checks authorizedParties against azp (session origin),
                // not OAuth client_id. Pin the verified OAuth client below.
                authorizedParties: config.authorizedParties,
            },
        );
        rejectionReason = clerkRejectionReason(state.message);
        authCandidate = state.toAuth();
    } catch {
        throw new McpAuthenticationError(
            "Invalid or expired Clerk OAuth token.",
            "sdk_exception",
        );
    }

    if (
        !authCandidate.isAuthenticated ||
        authCandidate.tokenType !== "oauth_token"
    ) {
        throw new McpAuthenticationError(
            "Invalid or expired Clerk OAuth token.",
            authCandidate.tokenType !== "oauth_token"
                ? "token_type_mismatch"
                : rejectionReason,
        );
    }
    const auth: ClerkOAuthAuth = authCandidate;
    if (config.clientId && auth.clientId !== config.clientId) {
        throw new ApiForbiddenError(
            "OAuth token was not issued for this Flash Evals MCP client.",
        );
    }
    if (!auth.userId) {
        throw new McpAuthenticationError(
            "OAuth token has no Clerk subject.",
            "missing_subject",
        );
    }
    return { userId: auth.userId, scopes: auth.scopes ?? [] };
}

export async function resolveMcpPrincipalForClerkUser(
    db: IDb,
    config: IApiConfig,
    clerkUserId: string,
    profile: McpProfile = "eval",
): Promise<IMcpPrincipal> {
    const result = await db.query<IMcpClerkUserRow>(
        `select id, clerk_user_id, team_id, email, name
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

    const email = await verifyCurrentClerkEmailAdmission(clerkUserId, config);

    return {
        authMode: "oauth",
        profile,
        userId: row.id,
        teamId: row.team_id,
        email,
        ...(row.name ? { name: row.name } : {}),
    };
}

export function mcpProfileFromOAuthScopes(
    scopes: readonly string[],
): McpProfile {
    if (scopes.includes("flash-evals:admin")) return "admin";
    if (scopes.includes("flash-evals:eval")) return "eval";
    if (scopes.includes("flash-evals:read")) return "read";
    // Existing OAuth clients have no Flash Evals profile scope. Keep normal
    // evaluation tools available, while reserving secret and destructive tools
    // for clients granted the explicit admin scope.
    return "eval";
}

function requiresDomainAdmission(config: IApiConfig): boolean {
    return (
        config.mosaicTenancyMode === "single-org" ||
        config.mosaicAllowedEmailDomain !== ""
    );
}

async function verifyCurrentClerkEmailAdmission(
    clerkUserId: string,
    config: IApiConfig,
): Promise<string> {
    if (!config.clerkSecretKey) {
        throw new ApiForbiddenError(
            "A current verified Clerk identity is required for MCP access.",
        );
    }

    const client = createClerkClient({
        secretKey: config.clerkSecretKey,
        publishableKey: config.clerkPublishableKey,
        jwtKey: config.clerkJwtKey,
        telemetry: { disabled: true },
    });

    let user: Awaited<ReturnType<typeof client.users.getUser>>;
    try {
        user = await client.users.getUser(clerkUserId);
    } catch {
        throw new ApiForbiddenError(
            "The current Clerk identity could not be verified for MCP access.",
        );
    }

    const email = user.primaryEmailAddress?.emailAddress;
    const emailVerified =
        user.primaryEmailAddress?.verification?.status === "verified";
    if (!email || !emailVerified) {
        throw new ApiForbiddenError(
            "A currently verified email address is required for MCP access.",
        );
    }

    const normalized = normalizeEmailAddress(email);
    if (
        requiresDomainAdmission(config) &&
        !isEmailAllowedForDomain(normalized, config.mosaicAllowedEmailDomain)
    ) {
        throw new ApiForbiddenError(
            "This Flash Evals account is not allowed to use MCP.",
        );
    }
    return normalized;
}

function bearerToken(request: Request): string | undefined {
    const header = request.headers.get("authorization")?.trim();
    if (!header) return undefined;
    const match = /^Bearer\s+(.+)$/i.exec(header);
    return match?.[1]?.trim() || undefined;
}
