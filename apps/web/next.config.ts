import type { NextConfig } from "next";
import {
    assertClerkOriginInPolicy,
    securityHeaders,
} from "./config/security-headers.mjs";

const nextConfig: NextConfig = {
    // Compiles components with the React Compiler (auto-memoization).
    reactCompiler: true,
    // Statically typed `href` / `router.push` route strings.
    typedRoutes: true,
    // The server modules import the workspace package directly from source.
    transpilePackages: ["@mosaic/llm-core"],
    // pg and pg-boss are server-only; keep them external to the bundle.
    serverExternalPackages: ["pg", "pg-boss"],
    experimental: {
        // Dataset media now uploads direct-to-Supabase (signed-URL PUT), so those
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
        },
    },
    async headers() {
        assertClerkOriginInPolicy();
        return [{ source: "/:path*", headers: securityHeaders() }];
    },
};

export default nextConfig;
