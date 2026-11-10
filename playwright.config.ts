import { defineConfig, devices } from "@playwright/test";
import { devHost } from "./scripts/lib/dev-env.cjs";

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "3100";
const fakeApiPort = process.env.PLAYWRIGHT_FAKE_API_PORT ?? "3101";
const webBaseUrl =
    process.env.PLAYWRIGHT_WEB_BASE_URL ?? `http://${devHost}:${webPort}`;
const defaultApiBaseUrl = `http://${devHost}:${fakeApiPort}`;
// The fixture runs in a Playwright worker, separate from the Next process.
process.env.PLAYWRIGHT_FAKE_API_HOST = devHost;

export default defineConfig({
    testDir: "./tests/e2e",
    timeout: 30_000,
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? [["html"], ["github"]] : [["list"]],
    use: {
        baseURL: webBaseUrl,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
    },
    webServer: process.env.PLAYWRIGHT_WEB_BASE_URL
        ? undefined
        : {
              // Build the workspace packages @flash-evals/web imports (the same
              // script its own `dev` script runs), then start Next directly so
              // the port can be set. The API is faked by the tests in tests/e2e.
              command:
                  `node scripts/build-packages.mjs && node scripts/build-marketing.mjs && ` +
                  `cd apps/web && exec ./node_modules/.bin/next dev --hostname ${devHost} --port ${webPort}`,
              url: `${webBaseUrl}/api/health`,
              reuseExistingServer: false,
              timeout: 120_000,
              // `exec` makes `next dev` the shell's process itself, so
              // Playwright's SIGTERM reaches Next directly and it exits
              // cleanly instead of being orphaned.
              gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
              env: {
                  FLASH_EVALS_PLAYWRIGHT: "app",
                  FLASH_EVALS_DEV_WEB_ORIGIN: webBaseUrl,
                  AUTH_DEV: "true",
                  AUTH_DEV_ALLOW_INSECURE: "1",
                  // Match the fake API fixtures in tests/e2e.
                  FLASH_EVALS_DEFAULT_TEAM_ID:
                      "00000000-0000-4000-8000-000000000001",
                  FLASH_EVALS_DEFAULT_USER_ID:
                      "00000000-0000-4000-8000-000000000002",
                  NEXT_PUBLIC_API_BASE_URL:
                      process.env.NEXT_PUBLIC_API_BASE_URL ?? defaultApiBaseUrl,
                  API_BASE_URL: process.env.API_BASE_URL ?? defaultApiBaseUrl,
                  INTERNAL_API_TOKEN:
                      process.env.INTERNAL_API_TOKEN ?? "playwright-local",
              },
          },
    projects: [
        {
            name: "chromium",
            use: { ...devices["Desktop Chrome"] },
        },
    ],
});
