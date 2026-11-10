import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SpendLimitField, suggestedSpendLimit } from "./spend-limit-field";

afterEach(cleanup);

describe("SpendLimitField", () => {
    it("suggests 1.5 times the estimate, rounded up to the cent", () => {
        expect(suggestedSpendLimit(40)).toBe("60.00");
        expect(suggestedSpendLimit(0.011)).toBe("0.02");
        expect(suggestedSpendLimit(0)).toBe("");
        expect(suggestedSpendLimit(undefined)).toBe("");
    });

    it("follows the estimate until edited, then keeps the typed value", () => {
        const { rerender } = render(<SpendLimitField estimateUsd={10} />);
        const input = screen.getByLabelText("Spend limit (USD)");
        expect(input).toHaveValue(15);
        expect(input).toHaveAttribute("name", "maxCostUsd");

        rerender(<SpendLimitField estimateUsd={20} />);
        expect(input).toHaveValue(30);

        fireEvent.change(input, { target: { value: "25" } });
        rerender(<SpendLimitField estimateUsd={40} />);
        expect(input).toHaveValue(25);
    });

    it("starts empty, meaning no limit, without an estimate", () => {
        render(<SpendLimitField error="Enter a spend limit above $0." />);
        const input = screen.getByLabelText("Spend limit (USD)");
        expect(input).toHaveValue(null);
        expect(input).toHaveAttribute("placeholder", "No limit");
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Enter a spend limit above $0.",
        );
    });
});
