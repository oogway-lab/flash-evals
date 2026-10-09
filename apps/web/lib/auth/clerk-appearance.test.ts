import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLERK_CSS_LAYER, clerkAppearance } from "./clerk-appearance";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("clerkAppearance", () => {
    it("themes Clerk from Flash Evals tokens rather than raw colours", () => {
        const { variables } = clerkAppearance;
        expect(variables.colorPrimary).toBe("var(--primary)");
        expect(variables.fontFamily).toBe("var(--font-sans)");
        expect(variables.borderRadius).toBe("6px");
        expect(variables.colorShadow).toBe("transparent");
    });

    it("uses a bordered rounded-sm card with no shadow and 40px controls", () => {
        const { elements } = clerkAppearance;
        expect(elements.cardBox).toContain("rounded-sm");
        expect(elements.cardBox).toContain("border");
        expect(elements.cardBox).toContain("shadow-none");
        expect(elements.formButtonPrimary).toContain("h-10");
        expect(elements.formButtonPrimary).toContain("rounded-sm");
        expect(elements.formFieldInput).toContain("h-10");
        expect(elements.userButtonPopoverCard).toContain("shadow-none");
    });

    it("puts Clerk's CSS in a layer that globals.css orders below utilities", () => {
        const css = readFileSync(join(root, "app/globals.css"), "utf8");
        const order = css
            .match(/@layer ([^;{]+);/)?.[1]
            ?.split(",")
            .map((l) => l.trim());
        expect(order).toBeDefined();
        expect(order).toContain(CLERK_CSS_LAYER);
        expect(order!.indexOf(CLERK_CSS_LAYER)).toBeLessThan(
            order!.indexOf("utilities"),
        );
        expect(clerkAppearance.cssLayerName).toBe(CLERK_CSS_LAYER);
    });
});
