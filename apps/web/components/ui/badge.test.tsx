import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Badge } from "./badge";

afterEach(cleanup);

describe("Badge", () => {
    it("renders inline so it is valid inside a paragraph", () => {
        render(
            <p>
                Route <Badge>Default</Badge>
            </p>,
        );
        const badge = screen.getByText("Default");
        // A <div> inside <p> is invalid HTML and breaks hydration.
        expect(badge.tagName).toBe("SPAN");
        expect(badge).toHaveAttribute("data-slot", "badge");
    });
});
