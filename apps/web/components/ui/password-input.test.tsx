import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PasswordInput } from "./password-input";

afterEach(cleanup);

describe("PasswordInput", () => {
    it("hides the value by default and toggles visibility", () => {
        render(<PasswordInput id="k" aria-label="API key" noun="key" />);
        const input = screen.getByLabelText("API key");
        expect(input).toHaveAttribute("type", "password");

        const toggle = screen.getByRole("button", { name: "Show key" });
        expect(toggle).toHaveAttribute("aria-pressed", "false");
        expect(toggle).toHaveAttribute("aria-controls", "k");
        expect(toggle).toHaveAttribute("type", "button");

        fireEvent.click(toggle);
        expect(input).toHaveAttribute("type", "text");
        expect(
            screen.getByRole("button", { name: "Hide key" }),
        ).toHaveAttribute("aria-pressed", "true");

        fireEvent.click(screen.getByRole("button", { name: "Hide key" }));
        expect(input).toHaveAttribute("type", "password");
    });
});
