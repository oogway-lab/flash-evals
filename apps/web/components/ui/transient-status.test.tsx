import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRANSIENT_STATUS_MS, TransientStatus } from "./transient-status";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("TransientStatus", () => {
    it("keeps an empty fixed-height slot until there is a success", () => {
        render(<TransientStatus token={undefined}>Saved.</TransientStatus>);
        const slot = screen.getByRole("status");
        expect(slot).toBeEmptyDOMElement();
        expect(slot).toHaveClass("min-h-5");
    });

    it("shows the message for a new success, then clears it", () => {
        const { rerender } = render(
            <TransientStatus token={undefined}>Saved.</TransientStatus>,
        );
        rerender(<TransientStatus token={{}}>Saved.</TransientStatus>);
        expect(screen.getByRole("status")).toHaveTextContent("Saved.");

        act(() => {
            vi.advanceTimersByTime(TRANSIENT_STATUS_MS);
        });
        expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("clears early once dismissed, e.g. on the next edit", () => {
        const token = {};
        const { rerender } = render(
            <TransientStatus token={undefined}>Saved.</TransientStatus>,
        );
        rerender(<TransientStatus token={token}>Saved.</TransientStatus>);
        rerender(
            <TransientStatus token={token} dismissed>
                Saved.
            </TransientStatus>,
        );
        expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });
});
