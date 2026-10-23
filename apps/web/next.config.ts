import type { NextConfig } from "next";
import {
    assertClerkOriginInPolicy,
    securityHeaders,
} from "./config/security-headers.mjs";

const devWebOrigin = process.env.FLASH_EVALS_DEV_WEB_ORIGIN;
const devWebUrl = devWebOrigin ? new URL(devWebOrigin) : undefined;
const playwrightMode = process.env.FLASH_EVALS_PLAYWRIGHT;
if (playwrightMode && !["app", "marketing"].includes(playwrightMode)) {
    throw new Error("FLASH_EVALS_PLAYWRIGHT must be app or marketing");
}

const nextConfig: NextConfig = {
    // Each browser suite can run alongside the normal development server.
    distDir: playwrightMode ? `.next-playwright/${playwrightMode}` : ".next",
    typescript: {
        tsconfigPath: playwrightMode
            ? "tsconfig.playwright.json"
            : "tsconfig.json",
    },
    allowedDevOrigins: devWebUrl ? [devWebUrl.hostname] : [],
    // In dev, Clerk's same-origin rewrite must retain 127.0.0.1. Normalizing
    // it to localhost makes Next proxy back into itself when explicitly bound.
    skipProxyUrlNormalize: process.env.NODE_ENV === "development",
    // Compiles components with the React Compiler (auto-memoization).
    reactCompiler: true,
    // Statically typed `href` / `router.push` route strings.
    typedRoutes: true,
    // The server modules import the workspace package directly from source.
    transpilePackages: ["@flash-evals/llm-core"],
    // pg and pg-boss are server-only; keep them external to the bundle.
    serverExternalPackages: ["pg", "pg-boss"],
    experimental: {
        // Dataset media now uploads directly to object storage (signed-URL PUT), so those
        // bytes no longer traverse Server Actions. However the prompt-test image
        // attach (`app/actions/prompts.ts` `imageFromForm`) was NOT migrated: it
        // still reads a raw `imageFile` File through a Server Action and allows up
        // to MAX_IMAGE_BYTES = 20MB. The cap must therefore stay above 20MB;
        // 22mb fits the image plus multipart/form overhead. (Dataset inline
        // text/answer/CSV content, up to MAX_TEXT_IMPORT_BYTES = 2MB, and
        // storageKey metadata also POST through Server Actions and fit well under
        // this.) Migrating the prompt-test path to direct upload later would allow
        // lowering this back down.
        serverActions: {
            bodySizeLimit: "22mb",
            allowedOrigins: devWebUrl ? [devWebUrl.host] : [],
        },
    },
    async headers() {
        assertClerkOriginInPolicy();
        return [{ source: "/:path*", headers: securityHeaders() }];
    },
};

export default nextConfig;
