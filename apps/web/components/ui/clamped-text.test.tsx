import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ClampedText } from "./clamped-text";

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

function mockHeights(scrollHeight: number, clientHeight: number) {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
        scrollHeight,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(
        clientHeight,
    );
}

describe("ClampedText", () => {
    it("hides the toggle when the text fits", () => {
        mockHeights(40, 40);
        render(<ClampedText>Short error</ClampedText>);
        expect(screen.getByText("Short error")).toHaveClass("line-clamp-3");
        expect(screen.queryByRole("button")).toBeNull();
    });

    it("expands and collapses overflowing text", () => {
        mockHeights(200, 60);
        render(<ClampedText lines={2}>A very long error</ClampedText>);
        const text = screen.getByText("A very long error");
        const toggle = screen.getByRole("button", { name: "Show more" });
        expect(text).toHaveClass("line-clamp-2");
        expect(toggle).toHaveAttribute("aria-expanded", "false");
        expect(toggle).toHaveAttribute("aria-controls", text.id);

        fireEvent.click(toggle);
        expect(text).not.toHaveClass("line-clamp-2");
        expect(
            screen.getByRole("button", { name: "Show less" }),
        ).toHaveAttribute("aria-expanded", "true");

        fireEvent.click(screen.getByRole("button", { name: "Show less" }));
        expect(text).toHaveClass("line-clamp-2");
    });
});
