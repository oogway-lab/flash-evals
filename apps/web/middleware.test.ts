import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, type NextFetchEvent } from "next/server";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), dev: false }));
vi.mock("@/server/auth/mode", () => ({ isDevAuthEnabled: () => mocks.dev }));
vi.mock("@clerk/nextjs/server", () => ({
    clerkMiddleware:
        (handler: (auth: unknown, req: NextRequest) => unknown) =>
        (req: NextRequest) =>
            handler(mocks.auth, req),
    createRouteMatcher: (patterns: string[]) => (req: NextRequest) =>
        patterns.some((pattern) =>
            new RegExp(`^${pattern}$`).test(req.nextUrl.pathname),
        ),
}));

import middleware from "./middleware";

async function visit(path: string) {
    return middleware(
        new NextRequest(`https://flashevals.dev${path}`),
        {} as NextFetchEvent,
    );
}

describe("entry and protected routing (mocked Clerk session)", () => {
    beforeEach(() => {
        mocks.dev = false;
        mocks.auth.mockResolvedValue({ userId: null });
    });

    it.each([
        "/",
        "/sign-in",
        "/sign-up",
        "/sign-in/sso-callback",
        "/access-denied",
        "/api/health",
        "/robots.txt",
        "/api/runs",
    ])("allows an anonymous public/API request to %s", async (path) =>
        expect(await visit(path)).toBeUndefined(),
    );

    it.each([
        "/dashboard",
        "/datasets",
        "/runs/run-1?tab=cost",
        "/settings",
        "/unknown",
    ])(
        "sends anonymous protected links to sign-in without caching: %s",
        async (path) => {
            const response = await visit(path);
            expect(response?.status).toBe(307);
            expect(response?.headers.get("location")).toBe(
                "https://flashevals.dev/sign-in",
            );
            expect(response?.headers.get("cache-control")).toBe(
                "private, no-store",
            );
        },
    );

    it.each([
        "/",
        "/?redirect_url=https://evil.example",
        "/sign-in",
        "/sign-up",
        "/sign-in/?redirect_url=/",
    ])("sends signed-in entry requests to the dashboard: %s", async (path) => {
        mocks.auth.mockResolvedValue({ userId: "session-user" });
        const response = await visit(path);
        expect(response?.headers.get("location")).toBe(
            "https://flashevals.dev/dashboard",
        );
        expect(response?.headers.get("cache-control")).toBe(
            "private, no-store",
        );
    });

    it("leaves signed-in dashboard/deep links to the existing admission checks", async () => {
        mocks.auth.mockResolvedValue({ userId: "session-user" });
        for (const path of [
            "/dashboard",
            "/datasets/dataset-1",
            "/access-denied",
            "/sign-in/sso-callback",
        ]) {
            expect(await visit(path)).toBeUndefined();
        }
    });

    it("rechecks session state after login and logout without a redirect cycle", async () => {
        expect(await visit("/")).toBeUndefined();
        expect((await visit("/dashboard"))?.headers.get("location")).toContain(
            "/sign-in",
        );
        expect(await visit("/sign-in")).toBeUndefined();
        mocks.auth.mockResolvedValue({ userId: "session-user" });
        expect((await visit("/sign-in"))?.headers.get("location")).toContain(
            "/dashboard",
        );
        expect(await visit("/dashboard")).toBeUndefined();
        mocks.auth.mockResolvedValue({ userId: null });
        expect(await visit("/")).toBeUndefined();
        expect((await visit("/datasets"))?.headers.get("location")).toContain(
            "/sign-in",
        );
    });

    it("keeps the double-opt-in localhost mode on the dashboard", async () => {
        mocks.dev = true;
        expect((await visit("/"))?.headers.get("location")).toContain(
            "/dashboard",
        );
        expect((await visit("/dashboard"))?.status).toBe(200);
        expect(mocks.auth).not.toHaveBeenCalled();
    });
});
