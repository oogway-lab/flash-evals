import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { RelativeTime } from "./relative-time";

afterEach(() => {
    cleanup();
    vi.useRealTimers();
});

describe("RelativeTime", () => {
    it("renders relative text in a <time> with the exact instant", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
        render(<RelativeTime value="2026-10-01T12:00:00.000Z" />);
        const time = screen.getByText("3 days ago");
        expect(time.tagName).toBe("TIME");
        expect(time).toHaveAttribute("datetime", "2026-10-01T12:00:00.000Z");
    });

    it("is not a tab stop but still exposes the exact UTC time", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-04T12:00:00Z"));
        render(<RelativeTime value="2026-10-01T12:00:00.000Z" />);
        const time = screen.getByText("3 days ago");
        expect(time).not.toHaveAttribute("tabindex");
        expect(time).toHaveTextContent("3 days ago (10/1/26, 12:00:00 PM UTC)");
    });

    it("server-renders the exact date so hydration never mismatches", () => {
        const html = renderToString(
            <RelativeTime value="2026-10-01T12:00:00.000Z" />,
        );
        expect(html).toContain("Oct 1, 2026");
        expect(html).not.toContain("ago");
    });

    it("renders the missing marker for an invalid date", () => {
        render(<RelativeTime value="not a date" />);
        expect(screen.getByText("not available")).toBeInTheDocument();
    });
});
