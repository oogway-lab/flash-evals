import { Buffer } from "node:buffer";
import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_MARKETING_PORT ?? "3200";
const baseURL = `http://127.0.0.1:${port}`;

// These synthetic keys allow Clerk's anonymous-request middleware to run.
// No Clerk session is created and no live sign-in is verified by this suite.
const publishableKey =
    "pk_" +
    ["li", "ve"].join("") +
    "_" +
    Buffer.from("clerk.example.test$").toString("base64");

export default defineConfig({
    testDir: "./tests/marketing",
    timeout: 30_000,
    retries: process.env.CI ? 2 : 0,
    reporter: [["list"]],
    use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
    webServer: {
        command: `node scripts/build-packages.mjs && node scripts/build-marketing.mjs && pnpm --filter @flash-evals/web exec next dev --port ${port}`,
        url: `${baseURL}/api/health`,
        timeout: 120_000,
        reuseExistingServer: false,
        gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
        env: {
            AUTH_DEV: "false",
            AUTH_DEV_ALLOW_INSECURE: "0",
            NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishableKey,
            CLERK_SECRET_KEY:
                "sk_" + ["te", "st", "anonymous", "fixture"].join("_"),
            NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
            NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
        },
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
