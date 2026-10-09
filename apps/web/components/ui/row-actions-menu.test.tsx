import { useState } from "react";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IActionState } from "@/app/actions/types";
import { DropdownMenuItem } from "./dropdown-menu";
import { ConfirmActionDialog, RowActionsMenu } from "./row-actions-menu";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

function Harness({
    action,
    successMessage,
}: {
    action: (prev: IActionState, data: FormData) => Promise<IActionState>;
    successMessage?: string;
}) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <RowActionsMenu name="Dish namer">
                <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setOpen(true)}
                >
                    Delete
                </DropdownMenuItem>
            </RowActionsMenu>
            <ConfirmActionDialog
                open={open}
                onOpenChange={setOpen}
                title="Delete prompt?"
                description="Gone for good."
                confirmLabel="Delete prompt"
                pendingLabel="Deleting…"
                action={action}
                fields={{ promptId: "p-1" }}
                successMessage={successMessage}
            />
        </>
    );
}

function openDialog() {
    fireEvent.click(
        screen.getByRole("button", { name: "More actions for Dish namer" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
}

async function confirm() {
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
        within(dialog).getByRole("button", { name: "Delete prompt" }),
    );
}

describe("RowActionsMenu", () => {
    it("labels the icon trigger with what the actions apply to", () => {
        render(<Harness action={vi.fn(async () => ({ ok: true }))} />);
        expect(
            screen.getByRole("button", { name: "More actions for Dish namer" }),
        ).toBeInTheDocument();
    });
});

describe("ConfirmActionDialog", () => {
    it("sends the fields to the action and closes on every success", async () => {
        const action = vi.fn(async () => ({ ok: true }));
        render(<Harness action={action} successMessage="Deleted it." />);

        for (const calls of [1, 2]) {
            openDialog();
            await confirm();
            await waitFor(() =>
                expect(
                    screen.queryByRole("alertdialog"),
                ).not.toBeInTheDocument(),
            );
            expect(action).toHaveBeenCalledTimes(calls);
        }
        const data = (
            action.mock.calls[0] as unknown as [unknown, FormData]
        )[1];
        expect(data.get("promptId")).toBe("p-1");
        expect(toast.success).toHaveBeenCalledTimes(2);
        expect(toast.success).toHaveBeenCalledWith("Deleted it.");
    });

    it("keeps the dialog open and shows the error when the action fails", async () => {
        const action = vi.fn(async () => ({ formError: "Prompt is in use." }));
        render(<Harness action={action} successMessage="Deleted it." />);

        openDialog();
        await confirm();

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Prompt is in use.",
        );
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
        expect(toast.success).not.toHaveBeenCalled();
    });
});
