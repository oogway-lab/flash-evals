import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { RunNotes } from "./run-notes";

afterEach(cleanup);

describe("RunNotes", () => {
    it("offers Edit notes when a note exists and Add notes otherwise", () => {
        const { rerender } = render(
            <RunNotes runId="run-1" saveAction={vi.fn()} />,
        );
        expect(
            screen.getByRole("button", { name: "Add notes" }),
        ).toBeInTheDocument();

        rerender(
            <RunNotes
                runId="run-1"
                note={{
                    body: "Looks good",
                    updatedAt: "2026-07-06T08:30:00.000Z",
                    updatedBy: null,
                }}
                saveAction={vi.fn()}
            />,
        );
        expect(
            screen.getByRole("button", { name: "Edit notes" }),
        ).toBeInTheDocument();
    });

    it("keeps the form closed until the trigger is used", () => {
        render(<RunNotes runId="run-1" saveAction={vi.fn()} />);
        const trigger = screen.getByRole("button", { name: "Add notes" });
        expect(trigger).toHaveAttribute("aria-expanded", "false");
        fireEvent.click(trigger);
        expect(trigger).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByLabelText("Notes for this run")).toBeVisible();
    });

    it("shows the last-saved time as a <time> with the exact UTC instant", () => {
        const { container } = render(
            <RunNotes
                runId="run-1"
                note={{
                    body: "Looks good",
                    updatedAt: "2026-07-06T08:30:00.000Z",
                    updatedBy: "user-1",
                }}
                saveAction={vi.fn()}
            />,
        );

        expect(screen.getByText(/Last saved/)).toBeInTheDocument();
        expect(container.querySelector("time")).toHaveAttribute(
            "datetime",
            "2026-07-06T08:30:00.000Z",
        );
    });

    it("shows the empty copy when no note has been saved", () => {
        render(<RunNotes runId="run-1" saveAction={vi.fn()} />);

        expect(screen.getByText("No run notes saved yet.")).toBeInTheDocument();
    });
});
