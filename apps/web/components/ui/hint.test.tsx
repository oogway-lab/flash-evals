import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Hint, HintText } from "./hint";

afterEach(cleanup);

describe("Hint", () => {
    it("shows its content when the trigger takes keyboard focus", async () => {
        render(
            <Hint content="Full explanation">
                <button type="button">Trigger</button>
            </Hint>,
        );
        fireEvent.focus(screen.getByRole("button", { name: "Trigger" }));
        expect(await screen.findByRole("tooltip")).toHaveTextContent(
            "Full explanation",
        );
    });

    it("works without an app-level TooltipProvider", () => {
        expect(() =>
            render(
                <Hint content="x">
                    <button type="button">ok</button>
                </Hint>,
            ),
        ).not.toThrow();
    });
});

describe("HintText", () => {
    it("is focusable text with a dotted underline", async () => {
        render(<HintText hint="Why this matters">diff. scorer</HintText>);
        const text = screen.getByText("diff. scorer");
        expect(text).toHaveAttribute("tabindex", "0");
        expect(text).toHaveClass("decoration-dotted");
        fireEvent.focus(text);
        expect(await screen.findByRole("tooltip")).toHaveTextContent(
            "Why this matters",
        );
    });
});
