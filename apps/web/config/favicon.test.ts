import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";

vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "font-sans" } }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "font-mono" } }));

const repoFile = (file: string) =>
    path.resolve(import.meta.dirname, "../../..", file);

describe("favicon", () => {
    it("is the app-router icon file, a copy of the brand SVG", () => {
        // Next links and serves app/icon.svg itself, so it works on
        // Cloudflare (OpenNext) without a rewrite into the asset store.
        const icon = repoFile("apps/web/app/icon.svg");
        expect(existsSync(icon)).toBe(true);
        expect(readFileSync(icon, "utf8")).toBe(
            readFileSync(repoFile("apps/site/public/favicon.svg"), "utf8"),
        );
    });

    it("needs no /favicon.ico rewrite or icon metadata", async () => {
        const rewrites = await nextConfig.rewrites?.();
        expect(JSON.stringify(rewrites ?? [])).not.toContain("favicon");
        const { metadata } = await import("../app/layout");
        expect(metadata).not.toHaveProperty("icons");
    });

    it("leaves the marketing page's own favicon in place", () => {
        expect(
            readFileSync(repoFile("apps/site/src/layouts/Base.astro"), "utf8"),
        ).toContain('<link rel="icon" href="/marketing/favicon.svg"');
        expect(
            readFileSync(repoFile("scripts/build-marketing.mjs"), "utf8"),
        ).toContain('"favicon.svg"');
    });
});
