import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { AuthCardSkeleton, AuthPanel } from "./auth-panel";

afterEach(cleanup);

describe("AuthPanel", () => {
    it("reserves the card's size before Clerk loads", () => {
        const { container } = render(
            <AuthPanel>
                <AuthCardSkeleton />
            </AuthPanel>,
        );
        const panel = container.querySelector('[data-slot="auth-panel"]');
        expect(panel).toHaveClass("min-h-[30rem]", "max-w-[25rem]");
        const placeholder = screen.getByRole("status", {
            name: "Loading sign-in",
        });
        expect(placeholder).toHaveClass(
            "min-h-[30rem]",
            "rounded-sm",
            "border",
        );
        expect(placeholder.className).not.toMatch(/shadow/);
    });
});
