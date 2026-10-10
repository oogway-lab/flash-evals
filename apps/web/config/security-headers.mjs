// HTTP security headers for every web response, wired up in next.config.ts.
//
// next.config headers are resolved at build time, so every origin here comes
// from build-time env. Keep the allow-lists to what the browser really loads:
// - Clerk: its Frontend API host (decoded from the publishable key) serves
//   clerk-js and handles auth calls; *.protect.clerk.com runs abuse and fraud
//   protection for every app, on ports other than 443; img.clerk.com serves
//   avatars; Cloudflare Turnstile runs the bot-protection captcha. See
//   https://clerk.com/docs/security/clerk-csp.
// - Storage: dataset uploads PUT straight to a signed URL. With the local
//   adapter that is the API; with cloud storage it is Supabase or the R2 bucket
//   endpoint configured through MOSAIC_CSP_STORAGE_ORIGIN.
//
// script-src keeps 'unsafe-inline' because the App Router emits inline
// bootstrap scripts, and nonces would force every page to render dynamically.

import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { URL } from "node:url";

const DEFAULT_STORAGE_ORIGIN = "https://*.supabase.co";
const CLERK_PROTECT = "https://*.protect.clerk.com";

/**
 * @param {Record<string, string | undefined>} env
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders(env = process.env) {
    return [
        {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(env),
        },
        {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
        },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Legacy counterpart of frame-ancestors for older browsers.
        { key: "X-Frame-Options", value: "DENY" },
    ];
}

/**
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function contentSecurityPolicy(env = process.env) {
    const isDev = env.NODE_ENV === "development";
    const clerkOrigin = clerkFrontendApiOrigin(
        env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    );
    const apiOrigin = originOf(env.NEXT_PUBLIC_API_BASE_URL);
    const storageOrigin =
        env.MOSAIC_CSP_STORAGE_ORIGIN?.trim() || DEFAULT_STORAGE_ORIGIN;
    const turnstile = "https://challenges.cloudflare.com";

    const directives = {
        "default-src": ["'self'"],
        "base-uri": ["'self'"],
        "object-src": ["'none'"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
        "script-src": [
            "'self'",
            "'unsafe-inline'",
            // React Refresh evaluates code in development only.
            ...(isDev ? ["'unsafe-eval'"] : []),
            clerkOrigin,
            CLERK_PROTECT,
            turnstile,
        ],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "blob:", "data:", "https://img.clerk.com"],
        "media-src": ["'self'", "blob:"],
        "font-src": ["'self'"],
        "connect-src": [
            "'self'",
            clerkOrigin,
            `${CLERK_PROTECT}:*`,
            "https://clerk-telemetry.com",
            "https://*.clerk-telemetry.com",
            apiOrigin,
            storageOrigin,
        ],
        "frame-src": ["'self'", CLERK_PROTECT, turnstile],
        "worker-src": ["'self'", "blob:"],
        ...(isDev ? {} : { "upgrade-insecure-requests": [] }),
    };

    return Object.entries(directives)
        .map(([name, sources]) =>
            [name, ...new Set(sources.filter(Boolean))].join(" "),
        )
        .join("; ");
}

/**
 * next.config headers are fixed at build time, so a production build without
 * the publishable key ships a CSP that blocks clerk-js and nobody can sign in.
 * Cloudflare Workers Builds (WORKERS_CI=1) fails the deploy; other production
 * builds, such as CI, only warn because they never serve users.
 *
 * @param {Record<string, string | undefined>} env
 */
export function assertClerkOriginInPolicy(env = process.env) {
    if (env.NODE_ENV !== "production") return;
    if (clerkFrontendApiOrigin(env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)) return;
    const message =
        "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is missing or invalid at build time, so the CSP leaves out Clerk's Frontend API and sign-in will fail. Set it as a build variable.";
    if (env.WORKERS_CI === "1") throw new Error(message);
    console.warn(`Warning: ${message}`);
}

/**
 * Clerk publishable keys are `pk_<env>_<base64("<frontend-api-host>$")>`.
 *
 * @param {string | undefined} publishableKey
 * @returns {string | undefined}
 */
export function clerkFrontendApiOrigin(publishableKey) {
    const encoded = /^pk_(?:test|live)_(.+)$/.exec(publishableKey ?? "")?.[1];
    if (!encoded) return undefined;
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const host = decoded.endsWith("$") ? decoded.slice(0, -1) : "";
    return /^[a-z0-9.-]+$/i.test(host) ? `https://${host}` : undefined;
}

/**
 * @param {string | undefined} url
 * @returns {string | undefined}
 */
function originOf(url) {
    if (!url) return undefined;
    try {
        return new URL(url).origin;
    } catch {
        return undefined;
    }
}
