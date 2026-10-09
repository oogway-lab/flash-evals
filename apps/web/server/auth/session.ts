import { MosaicApiError } from "@mosaic/api-contract";
import { notFound, redirect } from "next/navigation";
import { serverApiClient } from "@/server/api/client";
import { currentClerkIdentity, type IClerkIdentity } from "./clerk";
import { timedSpan } from "../lib/timing";
import { isDevAuthEnabled } from "./mode";

export interface Principal {
    userId: string;
    teamId: string;
    defaultWorkspaceId?: string;
}

export class UnauthorizedError extends Error {
    constructor(
        message = "Unauthorized",
        public readonly statusCode = 401,
    ) {
        super(message);
        this.name = "UnauthorizedError";
    }
}

export class ForbiddenError extends Error {
    public readonly statusCode = 403;

    constructor(message = "Forbidden") {
        super(message);
        this.name = "ForbiddenError";
    }
}

export class AuthConfigurationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "AuthConfigurationError";
    }
}

export async function requirePrincipal(): Promise<Principal> {
    if (isDevAuthEnabled()) {
        return devPrincipal();
    }

    const identity = await timedSpan("auth.currentClerkIdentity", () =>
        currentClerkIdentity(),
    );
    if (!identity) {
        throw new UnauthorizedError("Sign in required.");
    }
    return timedSpan("auth.principalForClerkIdentity", () =>
        principalForClerkIdentity(identity),
    );
}

export async function requirePagePrincipal(): Promise<Principal> {
    try {
        return await requirePrincipal();
    } catch (err) {
        if (err instanceof ForbiddenError) {
            redirect("/access-denied");
        }
        throw err;
    }
}

export async function principalForClerkIdentity(
    identity: IClerkIdentity,
): Promise<Principal> {
    if (!identity.email || !identity.emailVerified) {
        throw new ForbiddenError("A verified email address is required.");
    }

    const email = normalizeEmail(identity.email);
    if (mosaicTenancyMode() === "single-org" && !isAllowedEmail(email)) {
        throw new ForbiddenError(accessDeniedMessage());
    }

    try {
        return await serverApiClient().resolvePrincipal({
            identity: {
                clerkUserId: identity.clerkUserId,
                email,
                emailVerified: identity.emailVerified,
                ...(identity.name ? { name: identity.name } : {}),
            },
        });
    } catch (err) {
        if (err instanceof MosaicApiError) {
            if (err.status === 401) {
                throw new UnauthorizedError(err.message, err.status);
            }
            if (err.status === 403) {
                throw new ForbiddenError(err.message);
            }
            if (err.status >= 400 && err.status < 500) {
                throw new AuthConfigurationError(err.message);
            }
        }
        throw err;
    }
}

export function assertSameTeam(principal: Principal, rowTeamId: string): void {
    if (principal.teamId !== rowTeamId) {
        // Do not distinguish cross-team from non-existent to avoid info leak.
        throw new UnauthorizedError("Resource not found.", 404);
    }
}

export function assertPageSameTeam(
    principal: Principal,
    rowTeamId: string,
): void {
    if (principal.teamId !== rowTeamId) {
        notFound();
    }
}

// Must match apps/api/src/config.ts's MosaicTenancyMode: the web tier makes
// this same check before ever calling the API, so a mismatch here would
// reject (or wrongly admit) sign-ins the API would have handled differently.
export function mosaicTenancyMode(): "single-org" | "isolated" {
    const raw = (process.env.MOSAIC_TENANCY_MODE ?? "").trim().toLowerCase();
    return raw === "isolated" ? "isolated" : "single-org";
}

export function allowedEmailDomain(): string {
    return (process.env.MOSAIC_ALLOWED_EMAIL_DOMAIN ?? "")
        .trim()
        .toLowerCase()
        .replace(/^@/, "");
}

export function normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
}

export function isAllowedEmail(email: string): boolean {
    const normalized = normalizeEmail(email);
    const [, domain] = normalized.split("@");
    // Fail closed: with no configured domain, nobody is provisioned.
    const allowed = allowedEmailDomain();
    return Boolean(domain) && allowed !== "" && domain === allowed;
}

export function accessDeniedMessage(): string {
    const domain = allowedEmailDomain();
    return domain
        ? `Only ${domain} email addresses can access this Flash Evals instance.`
        : "Sign-in is disabled until MOSAIC_ALLOWED_EMAIL_DOMAIN is configured.";
}

async function devPrincipal(): Promise<Principal> {
    const teamId = process.env.MOSAIC_DEFAULT_TEAM_ID?.trim();
    const userId = process.env.MOSAIC_DEFAULT_USER_ID?.trim();
    if (!teamId || !userId) {
        throw new AuthConfigurationError(
            "AUTH_DEV requires MOSAIC_DEFAULT_TEAM_ID and MOSAIC_DEFAULT_USER_ID. `pnpm run dev` sets them to the seeded team and user.",
        );
    }
    return {
        teamId,
        userId,
        defaultWorkspaceId: process.env.MOSAIC_DEFAULT_WORKSPACE_ID,
    };
}
