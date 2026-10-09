import { createServer, type Server } from "node:http";
import { expect, test } from "@playwright/test";

let fakeApiServer: Server | undefined;

test.beforeAll(async () => {
    if (process.env.API_BASE_URL) return;

    fakeApiServer = createServer((req, res) => {
        if (req.url?.startsWith("/api/workspaces")) {
            res.writeHead(200, {
                "Content-Type": "application/json",
                "x-request-id": "playwright-workspaces",
            });
            res.end(
                JSON.stringify([
                    {
                        id: "00000000-0000-4000-8000-000000000004",
                        teamId: "00000000-0000-4000-8000-000000000001",
                        name: "Default",
                        ownerUserId: "00000000-0000-4000-8000-000000000002",
                        createdAt: "2026-07-11T00:00:00.000Z",
                    },
                ]),
            );
            return;
        }

        if (req.url?.startsWith("/api/projects")) {
            res.writeHead(200, {
                "Content-Type": "application/json",
                "x-request-id": "playwright-projects",
            });
            res.end(
                JSON.stringify([
                    {
                        id: "00000000-0000-4000-8000-000000000003",
                        teamId: "00000000-0000-4000-8000-000000000001",
                        name: "Default",
                        createdBy: "00000000-0000-4000-8000-000000000002",
                        createdAt: "2026-07-11T00:00:00.000Z",
                    },
                ]),
            );
            return;
        }

        if (req.url?.startsWith("/api/datasets")) {
            res.writeHead(200, {
                "Content-Type": "application/json",
                "x-request-id": "playwright-datasets",
            });
            res.end("[]");
            return;
        }

        console.warn(`fake API: unhandled ${req.method} ${req.url}`);
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not_found", message: "Not found" }));
    });

    await new Promise<void>((resolve, reject) => {
        fakeApiServer?.once("error", reject);
        fakeApiServer?.listen(
            Number(process.env.PLAYWRIGHT_FAKE_API_PORT ?? "3101"),
            "127.0.0.1",
            resolve,
        );
    });
});

test.afterAll(async () => {
    if (!fakeApiServer) return;
    await new Promise<void>((resolve, reject) => {
        fakeApiServer?.close((error) => {
            if (error) reject(error);
            else resolve();
        });
    });
});

test("web health endpoint returns ok", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(response.ok()).toBe(true);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
});

test("public access-denied page renders without a session", async ({
    page,
}) => {
    await page.goto("/access-denied");
    await expect(page).toHaveURL(/\/access-denied/);
    await expect(page.getByText(/access denied/i).first()).toBeVisible();
});

test("protected app shell is reachable in dev auth mode", async ({ page }) => {
    await page.goto("/datasets");
    await expect(page).toHaveURL(/\/datasets/);
    await expect(
        page.getByRole("heading", { exact: true, name: "Datasets" }),
    ).toBeVisible();

    const datasetsLink = page.getByRole("link", { name: "Datasets" });
    const navigationMenu = page.getByRole("button", {
        name: /open navigation menu/i,
    });
    await expect(datasetsLink.or(navigationMenu).first()).toBeVisible();
});
