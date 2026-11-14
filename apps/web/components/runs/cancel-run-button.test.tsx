import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { cancelRunAction, cancelWorkflowRunAction } = vi.hoisted(() => ({
    cancelRunAction: vi.fn(
        async (_prev: unknown, _data: FormData) => ({ ok: true }) as const,
    ),
    cancelWorkflowRunAction: vi.fn(
        async (_prev: unknown, _data: FormData) => ({ ok: true }) as const,
    ),
}));
vi.mock("@/app/actions", () => ({ cancelRunAction, cancelWorkflowRunAction }));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));

import { CancelRunButton } from "./cancel-run-button";

afterEach(() => {
    cleanup();
    cancelRunAction.mockClear();
    cancelWorkflowRunAction.mockClear();
});

describe("CancelRunButton", () => {
    it("asks in an in-page dialog, not a browser dialog, before cancelling", async () => {
        const confirm = vi.spyOn(window, "confirm");
        render(<CancelRunButton runId="run-1" />);

        fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog).toHaveTextContent("Calls already sent will finish");
        expect(confirm).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Keep running" }));
        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
        expect(cancelRunAction).not.toHaveBeenCalled();
    });

    it("cancels the run once confirmed", async () => {
        render(<CancelRunButton runId="run-1" />);
        fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
        const dialog = await screen.findByRole("alertdialog");
        const confirmButton = [...dialog.querySelectorAll("button")].find(
            (button) => button.textContent === "Cancel run",
        )!;

        fireEvent.click(confirmButton);

        await waitFor(() => expect(cancelRunAction).toHaveBeenCalledOnce());
        const data = cancelRunAction.mock.calls[0]![1];
        expect(data.get("runId")).toBe("run-1");
    });

    it("cancels a pipeline run through the pipeline action", async () => {
        render(<CancelRunButton runId="run-1" workflowId="workflow-1" />);
        fireEvent.click(screen.getByRole("button", { name: "Cancel run" }));
        const dialog = await screen.findByRole("alertdialog");
        expect(dialog).toHaveTextContent("No new steps will start");
        const confirmButton = [...dialog.querySelectorAll("button")].find(
            (button) => button.textContent === "Cancel run",
        )!;

        fireEvent.click(confirmButton);

        await waitFor(() =>
            expect(cancelWorkflowRunAction).toHaveBeenCalledOnce(),
        );
        const data = cancelWorkflowRunAction.mock.calls[0]![1];
        expect(data.get("runId")).toBe("run-1");
        expect(data.get("workflowId")).toBe("workflow-1");
        expect(cancelRunAction).not.toHaveBeenCalled();
    });
});
