import { defineConfig, devices } from "@playwright/test";

const webPort = process.env.PLAYWRIGHT_WEB_PORT ?? "3000";
const fakeApiPort = process.env.PLAYWRIGHT_FAKE_API_PORT ?? "3101";
const webBaseUrl =
    process.env.PLAYWRIGHT_WEB_BASE_URL ?? `http://127.0.0.1:${webPort}`;
const defaultApiBaseUrl = `http://127.0.0.1:${fakeApiPort}`;

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
              // Build the workspace packages @mosaic/web imports (the same
              // script its own `dev` script runs), then start Next directly so
              // the port can be set. The API is faked by the tests in tests/e2e.
              command:
                  `node scripts/build-packages.mjs && ` +
                  `pnpm --filter @mosaic/web exec next dev --port ${webPort}`,
              url: `${webBaseUrl}/api/health`,
              reuseExistingServer: !process.env.CI,
              timeout: 120_000,
              // pnpm 12 runs `next dev` in its own process group, so the
              // default SIGKILL to Playwright's group would orphan it and
              // hang the run. pnpm forwards SIGTERM to its child.
              gracefulShutdown: { signal: "SIGTERM", timeout: 10_000 },
              env: {
                  AUTH_DEV: "true",
                  AUTH_DEV_ALLOW_INSECURE: "1",
                  // Match the fake API fixtures in tests/e2e.
                  MOSAIC_DEFAULT_TEAM_ID:
                      "00000000-0000-4000-8000-000000000001",
                  MOSAIC_DEFAULT_USER_ID:
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
