import console from "node:console";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    assertClerkOriginInPolicy,
    clerkFrontendApiOrigin,
    contentSecurityPolicy,
    securityHeaders,
} from "./security-headers.mjs";

const CLERK_HOST = "clerk.mosaic.example";
const PUBLISHABLE_KEY = `pk_live_${Buffer.from(`${CLERK_HOST}$`).toString("base64")}`;

function directive(policy: string, name: string): string[] {
    const entry = policy
        .split("; ")
        .find((part) => part.split(" ")[0] === name);
    return entry ? entry.split(" ").slice(1) : [];
}

describe("clerkFrontendApiOrigin", () => {
    it("decodes the Frontend API host from a publishable key", () => {
        expect(clerkFrontendApiOrigin(PUBLISHABLE_KEY)).toBe(
            `https://${CLERK_HOST}`,
        );
    });

    it("ignores missing, placeholder, and malformed keys", () => {
        expect(clerkFrontendApiOrigin(undefined)).toBeUndefined();
        expect(clerkFrontendApiOrigin("pk_test_...")).toBeUndefined();
        expect(
            clerkFrontendApiOrigin(
                `pk_live_${Buffer.from("evil.example; script-src *$").toString("base64")}`,
            ),
        ).toBeUndefined();
    });
});

describe("contentSecurityPolicy", () => {
    const production = {
        NODE_ENV: "production",
        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
        NEXT_PUBLIC_API_BASE_URL: "https://api.mosaic.example/v1",
    };

    it("forbids framing, plugins, and foreign base URIs", () => {
        const policy = contentSecurityPolicy(production);

        expect(directive(policy, "frame-ancestors")).toEqual(["'none'"]);
        expect(directive(policy, "object-src")).toEqual(["'none'"]);
        expect(directive(policy, "base-uri")).toEqual(["'self'"]);
    });

    it("allows Clerk, the API origin, and storage uploads", () => {
        const policy = contentSecurityPolicy(production);

        expect(directive(policy, "script-src")).toContain(
            `https://${CLERK_HOST}`,
        );
        expect(directive(policy, "connect-src")).toEqual(
            expect.arrayContaining([
                `https://${CLERK_HOST}`,
                "https://api.mosaic.example",
                "https://*.supabase.co",
            ]),
        );
    });

    it("allows Clerk's abuse and fraud protection hosts on any port", () => {
        const policy = contentSecurityPolicy(production);

        expect(directive(policy, "script-src")).toContain(
            "https://*.protect.clerk.com",
        );
        expect(directive(policy, "frame-src")).toContain(
            "https://*.protect.clerk.com",
        );
        expect(directive(policy, "connect-src")).toContain(
            "https://*.protect.clerk.com:*",
        );
    });

    it("uses an explicit storage origin when configured", () => {
        const policy = contentSecurityPolicy({
            ...production,
            MOSAIC_CSP_STORAGE_ORIGIN: "https://abc.supabase.co",
        });

        expect(directive(policy, "connect-src")).toContain(
            "https://abc.supabase.co",
        );
        expect(directive(policy, "connect-src")).not.toContain(
            "https://*.supabase.co",
        );
    });

    it("allows eval only in development", () => {
        expect(
            directive(contentSecurityPolicy(production), "script-src"),
        ).not.toContain("'unsafe-eval'");
        expect(
            directive(
                contentSecurityPolicy({ NODE_ENV: "development" }),
                "script-src",
            ),
        ).toContain("'unsafe-eval'");
    });
});

describe("assertClerkOriginInPolicy", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("fails a Cloudflare production build without the publishable key", () => {
        expect(() =>
            assertClerkOriginInPolicy({
                NODE_ENV: "production",
                WORKERS_CI: "1",
                NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_...",
            }),
        ).toThrow(/NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY/);
    });

    it("only warns on other production builds without the key", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        assertClerkOriginInPolicy({ NODE_ENV: "production" });

        expect(warn).toHaveBeenCalledWith(
            expect.stringContaining("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"),
        );
    });

    it("passes when the key is set or outside production", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

        expect(() =>
            assertClerkOriginInPolicy({
                NODE_ENV: "production",
                WORKERS_CI: "1",
                NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: PUBLISHABLE_KEY,
            }),
        ).not.toThrow();
        assertClerkOriginInPolicy({ NODE_ENV: "development", WORKERS_CI: "1" });

        expect(warn).not.toHaveBeenCalled();
    });
});

describe("securityHeaders", () => {
    it("sends HSTS, nosniff, and a referrer policy", () => {
        const headers = Object.fromEntries(
            securityHeaders({ NODE_ENV: "production" }).map((header) => [
                header.key,
                header.value,
            ]),
        );

        expect(headers["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
        expect(headers["X-Content-Type-Options"]).toBe("nosniff");
        expect(headers["Referrer-Policy"]).toBe(
            "strict-origin-when-cross-origin",
        );
        expect(headers["Content-Security-Policy"]).toContain(
            "frame-ancestors 'none'",
        );
    });
});
