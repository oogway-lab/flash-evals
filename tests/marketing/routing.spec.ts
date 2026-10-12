import { expect, test } from "@playwright/test";

test("anonymous / serves marketing and its local assets without an auth or dashboard shell", async ({
    page,
    request,
}) => {
    const response = await page.goto("/");
    expect(response?.status()).toBe(200);
    expect(response?.headers()["cache-control"]).toContain("no-store");
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Choose your model. See the tradeoffs on your data.",
    );
    await expect(
        page
            .locator(".topbar")
            .getByRole("link", { name: "Pilot sign-in", exact: true }),
    ).toHaveAttribute("href", "/sign-in");
    await expect(
        page
            .locator(".mast")
            .getByRole("link", { name: "Pilot sign-in", exact: true }),
    ).toHaveAttribute("href", "/sign-in");
    await expect(
        page.getByRole("navigation", { name: "Primary" }),
    ).toBeVisible();
    const stylesheet = page.locator('link[rel="stylesheet"]').first();
    const href = await stylesheet.getAttribute("href");
    expect(href).toMatch(/^\/marketing\/_astro\//);
    expect((await request.get(href!)).status()).toBe(200);
    const socialImage = await request.get("/marketing/og.png");
    expect(socialImage.status()).toBe(200);
    const png = await socialImage.body();
    await expect(
        page.locator('meta[property="og:image:width"]'),
    ).toHaveAttribute("content", String(png.readUInt32BE(16)));
    await expect(
        page.locator('meta[property="og:image:height"]'),
    ).toHaveAttribute("content", String(png.readUInt32BE(20)));
    await expect(page.locator(".mast .ln").last()).toHaveCSS(
        "clip-path",
        /^inset\(0(?:px|%)(?: 0(?:px|%))*\)$/,
    );
    await page.screenshot({
        path: "test-results/marketing-desktop.png",
        fullPage: true,
    });
});

test("mobile marketing keeps the headline and sign-in link accessible without horizontal overflow", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
        page
            .locator(".topbar")
            .getByRole("link", { name: "Pilot sign-in", exact: true }),
    ).toBeVisible();
    expect(
        await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
    ).toBe(true);
    await expect(page.locator(".mast .ln").last()).toHaveCSS(
        "clip-path",
        /^inset\(0(?:px|%)(?: 0(?:px|%))*\)$/,
    );
    await page.screenshot({
        path: "test-results/marketing-mobile.png",
        fullPage: true,
    });
});

test("reduced motion and no-JavaScript preserve the complete accessible marketing content", async ({
    browser,
}) => {
    for (const options of [
        { reducedMotion: "reduce" as const },
        { javaScriptEnabled: false },
    ]) {
        const context = await browser.newContext(options);
        const page = await context.newPage();
        await page.goto(test.info().project.use.baseURL!);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        await expect(page.locator("html")).not.toHaveClass(/motion/);
        for (const stamp of await page.locator(".stamp").all()) {
            await expect(stamp).toHaveCSS("opacity", "0.88");
        }
        await expect(
            page
                .locator(".topbar")
                .getByRole("link", { name: "Pilot sign-in", exact: true }),
        ).toBeVisible();
        await context.close();
    }
});

test("mobile stamps stay within the viewport throughout their staggered animation", async ({
    page,
}) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    const board = page.locator("[data-board]");
    await expect(board).toHaveClass(/armed/);

    const animation = await board.evaluate(async (element) => {
        await document.fonts.ready;
        const stamps = Array.from(element.querySelectorAll(".stamp"));
        const animatedStamps = new Set<number>();
        const overflow: number[] = [];
        let animationFrames = 0;
        element.scrollIntoView({ behavior: "instant", block: "center" });
        const start = performance.now();
        await new Promise<void>((resolve) => {
            const sample = () => {
                let active = false;
                stamps.forEach((stamp, index) => {
                    if (
                        stamp.getAnimations().some((animation) => {
                            const timing =
                                animation.effect?.getComputedTiming();
                            const delay =
                                animation.effect?.getTiming().delay ?? 0;
                            return (
                                animation.playState === "running" &&
                                typeof timing?.localTime === "number" &&
                                timing.localTime >= delay &&
                                timing.localTime < delay + timing.activeDuration
                            );
                        })
                    ) {
                        animatedStamps.add(index);
                        active = true;
                    }
                });
                if (active) {
                    animationFrames++;
                    const width = document.documentElement.scrollWidth;
                    if (width > window.innerWidth) overflow.push(width);
                }
                if (performance.now() - start < 1_200) {
                    requestAnimationFrame(sample);
                } else {
                    resolve();
                }
            };
            requestAnimationFrame(sample);
        });
        return {
            animatedStamps: animatedStamps.size,
            stamps: stamps.length,
            animationFrames,
            overflow,
        };
    });

    expect(animation.stamps).toBe(3);
    expect(animation.animatedStamps).toBe(animation.stamps);
    expect(animation.animationFrames).toBeGreaterThan(10);
    expect(animation.overflow).toEqual([]);
});

test("anonymous dashboard and direct protected links require sign-in on every refresh", async ({
    request,
}) => {
    for (const path of [
        "/dashboard",
        "/datasets",
        "/runs/example?tab=cost",
        "/settings",
    ]) {
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await request.get(path, { maxRedirects: 0 });
            expect(response.status()).toBe(307);
            expect(response.headers().location).toMatch(/\/sign-in$/);
            expect(response.headers()["cache-control"]).toContain("no-store");
        }
    }
});

test("interrupted and repeated sign-in navigation can return to marketing through Back/Forward", async ({
    page,
}) => {
    // Block the intentionally non-existent Clerk fixture origin. We verify the
    // app's routing and loading UI; this is not a completed Clerk login.
    await page.route("https://clerk.example.test/**", (route) => route.abort());
    await page.goto("/");
    await page
        .locator(".topbar")
        .getByRole("link", { name: "Pilot sign-in", exact: true })
        .click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(
        page.getByRole("status", { name: "Loading sign-in" }),
    ).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.reload();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/");
    await page
        .locator(".mast")
        .getByRole("link", { name: "Pilot sign-in", exact: true })
        .click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Choose your model. See the tradeoffs on your data.",
    );
});
