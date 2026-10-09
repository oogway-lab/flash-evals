import { expect, test } from "@playwright/test";

const apiBaseUrl = process.env.PLAYWRIGHT_API_BASE_URL;
const internalApiToken = process.env.INTERNAL_API_TOKEN;

test.skip(
    !apiBaseUrl,
    "Set PLAYWRIGHT_API_BASE_URL to smoke-test the Railway API surface.",
);

test("api health endpoint reports service readiness", async ({ request }) => {
    expect(apiBaseUrl).toBeTruthy();
    // Public /health returns only { status }. The detailed payload needs the
    // internal API token, so the deployment-shape checks run only when it is set.
    const response = await request.get(`${apiBaseUrl}/health`, {
        headers: internalApiToken
            ? { "x-mosaic-internal-token": internalApiToken }
            : {},
    });
    expect(response.ok()).toBe(true);
    const payload = await response.json();
    if (!internalApiToken) {
        expect(payload).toEqual({ status: "ok" });
        return;
    }
    expect(payload).toMatchObject({
        status: "ok",
        service: "mosaic-api",
        storage: "supabase",
        database: "supabase-postgres",
        railwayVolumeRequired: false,
    });
});
