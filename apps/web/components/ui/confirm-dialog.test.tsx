import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "./button";
import { ConfirmDialog } from "./confirm-dialog";

afterEach(cleanup);

function renderConfirm(onConfirm: () => Promise<string | undefined>) {
    render(
        <ConfirmDialog
            trigger={<Button>Delete</Button>}
            title="Delete it?"
            description="This can’t be undone."
            confirmLabel="Delete forever"
            pendingLabel="Deleting…"
            onConfirm={onConfirm}
        />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
}

describe("ConfirmDialog", () => {
    it("puts Cancel before the destructive action and does nothing on cancel", async () => {
        const onConfirm = vi.fn(async () => undefined);
        renderConfirm(onConfirm);
        const dialog = await screen.findByRole("alertdialog");
        const buttons = [...dialog.querySelectorAll("button")].map(
            (b) => b.textContent,
        );
        expect(buttons).toEqual(["Cancel", "Delete forever"]);

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
        expect(onConfirm).not.toHaveBeenCalled();
    });

    it("shows pending on the action and closes after it succeeds", async () => {
        let finish!: () => void;
        renderConfirm(
            () => new Promise<undefined>((r) => (finish = () => r(undefined))),
        );
        fireEvent.click(
            await screen.findByRole("button", { name: "Delete forever" }),
        );
        expect(
            await screen.findByRole("button", { name: "Deleting…" }),
        ).toHaveAttribute("aria-busy", "true");
        expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

        await act(async () => finish());
        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
    });

    it("stays open and shows the error when the action fails", async () => {
        renderConfirm(async () => "Couldn’t delete it.");
        fireEvent.click(
            await screen.findByRole("button", { name: "Delete forever" }),
        );
        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Couldn’t delete it.",
        );
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    });

    it("can be opened programmatically, e.g. for a keyboard delete", async () => {
        const onOpenChange = vi.fn();
        render(
            <ConfirmDialog
                open
                onOpenChange={onOpenChange}
                title="Remove block?"
                description="Settings are removed."
                confirmLabel="Remove"
                onConfirm={() => undefined}
            />,
        );
        fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
        expect(onOpenChange).toHaveBeenCalledWith(false);
    });
});
