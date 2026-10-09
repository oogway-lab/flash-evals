import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";
import {
    AuthConfigurationError,
    ForbiddenError,
    UnauthorizedError,
    allowedEmailDomain,
    assertPageSameTeam,
    assertSameTeam,
    isAllowedEmail,
    normalizeEmail,
    principalForClerkIdentity,
    requirePagePrincipal,
    requirePrincipal,
} from "./session";
import { authErrorResponse } from "./http";

const clerkMock = vi.hoisted(() => ({
    currentClerkIdentity: vi.fn(),
}));

const apiMock = vi.hoisted(() => ({
    resolvePrincipal: vi.fn(),
}));

const navigationMock = vi.hoisted(() => ({
    notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
    }),
    redirect: vi.fn((url: string) => {
        throw new Error(`REDIRECT:${url}`);
    }),
}));

vi.mock("./clerk", () => ({
    currentClerkIdentity: clerkMock.currentClerkIdentity,
}));

vi.mock("@/server/api/client", () => ({
    serverApiClient: () => apiMock,
}));

vi.mock("next/navigation", () => ({
    notFound: navigationMock.notFound,
    redirect: navigationMock.redirect,
}));

describe("auth session", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubEnv("NODE_ENV", "test");
        process.env.MOSAIC_ALLOWED_EMAIL_DOMAIN = "example.com";
        delete process.env.MOSAIC_DEFAULT_TEAM_ID;
        delete process.env.MOSAIC_DEFAULT_USER_ID;
        delete process.env.AUTH_DEV;
        delete process.env.AUTH_DEV_ALLOW_INSECURE;
        apiMock.resolvePrincipal.mockResolvedValue({
            userId: "user-1",
            teamId: "team-1",
        });
    });

    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("normalizes and checks the configured email domain", () => {
        process.env.MOSAIC_ALLOWED_EMAIL_DOMAIN = "@example.com";

        expect(allowedEmailDomain()).toBe("example.com");
        expect(normalizeEmail(" Alice@Example.com ")).toBe("alice@example.com");
        expect(isAllowedEmail("alice@example.com")).toBe(true);
        expect(isAllowedEmail("alice@sub.example.com")).toBe(false);
        expect(isAllowedEmail("alice@gmail.com")).toBe(false);
    });

    it("denies every email when no domain is configured", () => {
        delete process.env.MOSAIC_ALLOWED_EMAIL_DOMAIN;

        expect(allowedEmailDomain()).toBe("");
        expect(isAllowedEmail("anyone@example.com")).toBe(false);
        expect(isAllowedEmail("person@gmail.com")).toBe(false);
        expect(isAllowedEmail("not-an-email")).toBe(false);
    });

    it("denies disallowed emails before calling the API", async () => {
        await expect(
            principalForClerkIdentity({
                clerkUserId: "clerk-1",
                email: "person@gmail.com",
                emailVerified: true,
                name: "Person",
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);

        expect(apiMock.resolvePrincipal).not.toHaveBeenCalled();
    });

    it("skips the domain check in isolated mode and lets the API decide", async () => {
        process.env.MOSAIC_TENANCY_MODE = "isolated";
        try {
            await expect(
                principalForClerkIdentity({
                    clerkUserId: "clerk-1",
                    email: "person@gmail.com",
                    emailVerified: true,
                    name: "Person",
                }),
            ).resolves.toEqual({ userId: "user-1", teamId: "team-1" });

            expect(apiMock.resolvePrincipal).toHaveBeenCalledWith({
                identity: {
                    clerkUserId: "clerk-1",
                    email: "person@gmail.com",
                    emailVerified: true,
                    name: "Person",
                },
            });
        } finally {
            delete process.env.MOSAIC_TENANCY_MODE;
        }
    });

    it("requires a verified email before calling the API", async () => {
        await expect(
            principalForClerkIdentity({
                clerkUserId: "clerk-1",
                email: "person@example.com",
                emailVerified: false,
                name: "Person",
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);

        expect(apiMock.resolvePrincipal).not.toHaveBeenCalled();
    });

    it("resolves an allowed Clerk identity through the API", async () => {
        await expect(
            principalForClerkIdentity({
                clerkUserId: "clerk-1",
                email: " Alice@Example.com ",
                emailVerified: true,
                name: "Alice",
            }),
        ).resolves.toEqual({ userId: "user-1", teamId: "team-1" });

        expect(apiMock.resolvePrincipal).toHaveBeenCalledWith({
            identity: {
                clerkUserId: "clerk-1",
                email: "alice@example.com",
                emailVerified: true,
                name: "Alice",
            },
        });
    });

    it("maps API auth errors to web auth errors", async () => {
        apiMock.resolvePrincipal.mockRejectedValueOnce(
            new MosaicApiError("Nope", 403, "forbidden"),
        );

        await expect(
            principalForClerkIdentity({
                clerkUserId: "clerk-1",
                email: "alice@example.com",
                emailVerified: true,
                name: undefined,
            }),
        ).rejects.toBeInstanceOf(ForbiddenError);
    });

    it("maps API configuration errors", async () => {
        apiMock.resolvePrincipal.mockRejectedValueOnce(
            new MosaicApiError("Missing team", 400, "bad_request"),
        );

        await expect(
            principalForClerkIdentity({
                clerkUserId: "clerk-1",
                email: "alice@example.com",
                emailVerified: true,
                name: undefined,
            }),
        ).rejects.toBeInstanceOf(AuthConfigurationError);
    });

    it("requires Clerk identity unless AUTH_DEV is enabled", async () => {
        clerkMock.currentClerkIdentity.mockResolvedValue(undefined);

        await expect(requirePrincipal()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );

        process.env.AUTH_DEV = "true";
        process.env.AUTH_DEV_ALLOW_INSECURE = "1";
        process.env.MOSAIC_DEFAULT_TEAM_ID = "team-dev";
        process.env.MOSAIC_DEFAULT_USER_ID = "user-dev";
        await expect(requirePrincipal()).resolves.toEqual({
            teamId: "team-dev",
            userId: "user-dev",
        });
    });

    it("keeps requiring Clerk when AUTH_DEV lacks the insecure opt-in", async () => {
        clerkMock.currentClerkIdentity.mockResolvedValue(undefined);
        process.env.AUTH_DEV = "true";
        process.env.MOSAIC_DEFAULT_TEAM_ID = "team-dev";
        process.env.MOSAIC_DEFAULT_USER_ID = "user-dev";

        await expect(requirePrincipal()).rejects.toBeInstanceOf(
            UnauthorizedError,
        );
    });

    it("has no built-in dev identity when the default IDs are unset", async () => {
        process.env.AUTH_DEV = "true";
        process.env.AUTH_DEV_ALLOW_INSECURE = "1";

        await expect(requirePrincipal()).rejects.toThrow(
            "AUTH_DEV requires MOSAIC_DEFAULT_TEAM_ID and MOSAIC_DEFAULT_USER_ID",
        );
    });

    it("returns a Clerk-backed principal when identity is present", async () => {
        clerkMock.currentClerkIdentity.mockResolvedValue({
            clerkUserId: "clerk-1",
            email: "alice@example.com",
            emailVerified: true,
            name: "Alice",
        });

        await expect(requirePrincipal()).resolves.toEqual({
            userId: "user-1",
            teamId: "team-1",
        });
    });

    it("protects resource team boundaries", () => {
        expect(() =>
            assertSameTeam({ userId: "user-1", teamId: "team-1" }, "team-2"),
        ).toThrow(UnauthorizedError);

        expect(() =>
            assertPageSameTeam(
                { userId: "user-1", teamId: "team-1" },
                "team-2",
            ),
        ).toThrow("NEXT_NOT_FOUND");
        expect(navigationMock.notFound).toHaveBeenCalled();
    });

    it("redirects forbidden page auth to access denied", async () => {
        apiMock.resolvePrincipal.mockRejectedValueOnce(
            new MosaicApiError("Forbidden", 403, "forbidden"),
        );
        clerkMock.currentClerkIdentity.mockResolvedValue({
            clerkUserId: "clerk-1",
            email: "alice@example.com",
            emailVerified: true,
        });

        await expect(requirePagePrincipal()).rejects.toThrow(
            "REDIRECT:/access-denied",
        );
    });

    it("renders auth error responses", async () => {
        const forbidden = authErrorResponse(new ForbiddenError("No access"));
        expect(forbidden?.status).toBe(403);
        await expect(forbidden?.json()).resolves.toEqual({
            error: "No access",
        });

        const unauthorized = authErrorResponse(
            new UnauthorizedError("Missing", 401),
        );
        expect(unauthorized?.status).toBe(401);
        await expect(unauthorized?.json()).resolves.toEqual({
            error: "Missing",
        });
    });
});
