import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StaleRegion } from "./stale-region";

afterEach(cleanup);

describe("StaleRegion", () => {
    it("dims and marks the content busy while stale", () => {
        render(
            <StaleRegion stale className="space-y-4">
                Previous result
            </StaleRegion>,
        );
        const region = screen.getByText("Previous result");
        expect(region).toHaveAttribute("aria-busy", "true");
        expect(region).toHaveClass("opacity-60", "space-y-4");
    });

    it("renders plainly when fresh", () => {
        render(<StaleRegion stale={false}>Current result</StaleRegion>);
        const region = screen.getByText("Current result");
        expect(region).not.toHaveAttribute("aria-busy");
        expect(region).not.toHaveClass("opacity-60");
    });
});
