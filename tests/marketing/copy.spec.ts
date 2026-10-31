import { expect, test } from "@playwright/test";
import { CLONE_COMMAND, installSteps } from "../../apps/site/src/lib/content";

test("public CTAs lead to local setup and explicitly limited pilot access", async ({
    page,
}) => {
    await page.goto("/");
    const links = page.locator(".mast .next a");
    await expect(links).toHaveText([
        "Set up locally",
        "View the source",
        "Pilot sign-in",
    ]);
    await expect(links.first()).toHaveAttribute(
        "href",
        /\/docs\/getting-started\.md$/,
    );
    await expect(links.last()).toHaveAttribute("href", "/sign-in");
    await expect(page.locator(".mast .note")).toContainText(
        "Hosted access is currently limited to the pilot.",
    );
    await page
        .locator(".topbar")
        .getByRole("link", { name: "Run locally" })
        .click();
    await expect(page).toHaveURL(/#self-host$/);
    await expect(page.locator("#host-title")).toBeInViewport();
    await expect(page.locator(".printer a")).toHaveAttribute(
        "href",
        /\/docs\/getting-started\.md$/,
    );
});

test("illustrations identify synthetic data without implying provider rankings or extra API results", async ({
    page,
}) => {
    await page.goto("/");
    await expect(page.locator(".mast .meta")).toHaveText(
        /SAMPLE RUN.*ILLUSTRATIVE DATA/,
    );
    await expect(page.locator("[data-clock]")).toHaveCount(0);
    await expect(page.locator(".resp .model")).toHaveText([
        "Model B",
        "Model C",
        "Model A",
    ]);
    await expect(page.locator(".board tbody .model").first()).toHaveText(
        "Model A",
    );
    await expect(page.locator(".board thead")).toContainText("Avg");
    await expect(page.locator(".calls .res")).toHaveText([
        "3 datasets",
        "run queued",
        "720 / 960 results",
        "status + progress",
        "outputs + scores",
        "review note saved",
    ]);
    await expect(page.locator(".site-foot")).toContainText(
        "synthetic outputs and sample figures",
    );
    await expect(page.locator(".judge")).toHaveText(
        /request preserved.*Pass in A, B, C/,
    );
    await expect(page.locator("main")).not.toContainText(
        /claude|gemini|gpt-4o|88 MCP|about ten minutes|OTP leakage/,
    );
});

test("all copy controls copy their complete commands and show success", async ({
    page,
    context,
}) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    for (const [selector, expected] of [
        [".clone button", CLONE_COMMAND],
        [".steps-bar button", installSteps.join("\n")],
        [".printer button", CLONE_COMMAND],
    ]) {
        const button = page.locator(selector);
        await button.click();
        await expect(button).toHaveAttribute("data-copied", "");
        expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
            expected,
        );
        await expect(button).not.toHaveAttribute("data-copied", "");
    }
});

test("clipboard rejection gives a usable fallback without claiming success", async ({
    page,
}) => {
    await page.goto("/");
    await page.evaluate(() => {
        Object.defineProperty(navigator.clipboard, "writeText", {
            value: () =>
                Promise.reject(new Error("Clipboard permission denied")),
        });
    });
    const button = page.locator(".clone button");
    await button.click();
    await expect(page.locator("[data-lcd]")).toHaveText(
        "Copy unavailable · select the text",
    );
    await expect(button).not.toHaveAttribute("data-copied", "");
    await expect(page.locator(".clone code")).toContainText("git clone");
});

for (const width of [360, 375, 390, 768, 1440]) {
    test(`receipt copy, stamps, and replay stay within the ${width}px viewport`, async ({
        page,
    }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const modelRequests: string[] = [];
        page.on("request", (request) => {
            if (request.method() === "POST") modelRequests.push(request.url());
        });
        await page.goto("/");
        await page.evaluate(() => document.fonts.ready);
        await expect(page.locator(".mast .ln").last()).toHaveCSS(
            "clip-path",
            /^inset\(0(?:px|%)(?: 0(?:px|%))*\)$/,
        );
        const run = page.locator("[data-run]");
        await run.scrollIntoViewIfNeeded();
        await expect(page.locator(".resp.printed")).toHaveCount(3);
        await page.getByRole("button", { name: "Replay", exact: true }).click();
        await expect(page.locator(".resp.printed")).toHaveCount(0);
        await expect(page.locator(".resp.printed")).toHaveCount(3);
        const board = page.locator("[data-board]");
        await board.scrollIntoViewIfNeeded();
        const overflow = await page.evaluate(async () => {
            const failures: number[] = [];
            const start = performance.now();
            await new Promise<void>((resolve) => {
                const sample = () => {
                    if (document.documentElement.scrollWidth > innerWidth)
                        failures.push(document.documentElement.scrollWidth);
                    if (performance.now() - start < 1200)
                        requestAnimationFrame(sample);
                    else resolve();
                };
                requestAnimationFrame(sample);
            });
            return failures;
        });
        expect(overflow).toEqual([]);
        const clipped = await page.evaluate(() => {
            const paper = document
                .querySelector(".roll")!
                .getBoundingClientRect();
            return Array.from(
                document.querySelectorAll<HTMLElement>(
                    ".sec-title .dw-ink, .copy-banner .dw-ink, .totals .dw-ink, .printer .feed, .printer .gh",
                ),
            )
                .filter((element) => {
                    const rect = element.getBoundingClientRect();
                    if (!rect.width) return false;
                    const isPrinter = Boolean(element.closest(".printer"));
                    return (
                        rect.left < (isPrinter ? 0 : paper.left) - 1 ||
                        rect.right >
                            (isPrinter ? innerWidth : paper.right) + 1 ||
                        element.scrollWidth > element.clientWidth + 1
                    );
                })
                .map((element) => element.textContent?.trim());
        });
        expect(clipped).toEqual([]);
        expect(modelRequests).toEqual([]);
        await page.locator(".site-foot").scrollIntoViewIfNeeded();
        await page.screenshot({
            path: `test-results/marketing-copy-${width}.png`,
            fullPage: true,
        });
        if (width === 390 || width === 1440) {
            await page.evaluate(() =>
                window.scrollTo({ top: 0, behavior: "instant" }),
            );
            await page.screenshot({
                path: `test-results/marketing-hero-${width}.png`,
            });
            await page.locator("#agents").scrollIntoViewIfNeeded();
            await page.screenshot({
                path: `test-results/marketing-agent-${width}.png`,
            });
        }
    });
}
