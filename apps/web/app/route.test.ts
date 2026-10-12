import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("anonymous marketing document", () => {
    it("serves the built design without a dashboard shell or a cacheable session entry", async () => {
        const response = GET();
        expect(response.headers.get("content-type")).toBe(
            "text/html; charset=utf-8",
        );
        expect(response.headers.get("cache-control")).toBe("private, no-store");
        const html = await response.text();
        expect(html).toContain(
            "Choose your model. See the tradeoffs on your data.",
        );
        expect(html).toContain('href="/sign-in"');
        expect(html).toContain('href="https://flashevals.dev/"');
        expect(html).toContain("/marketing/_astro/");
        expect(html).toContain("prefers-reduced-motion");
        expect(html).toContain("Skip to content");
        expect(html).not.toContain("__next");
    });
});
