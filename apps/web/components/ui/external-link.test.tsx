import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExternalLink } from "./external-link";

afterEach(cleanup);

describe("ExternalLink", () => {
    it("opens safely in a new tab and says so", () => {
        render(<ExternalLink href="https://example.com">Docs</ExternalLink>);
        const link = screen.getByRole("link", {
            name: /^Docs\s*\(opens in a new tab\)$/,
        });
        expect(link).toHaveAttribute("target", "_blank");
        expect(link).toHaveAttribute("rel", "noopener noreferrer");
        expect(link.querySelector('[data-slot="new-tab-icon"]')).toBeTruthy();
    });
});
