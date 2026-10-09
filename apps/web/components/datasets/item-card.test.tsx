import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from "@testing-library/react";
import { ItemCard } from "./item-card";

afterEach(cleanup);

function renderCard(
    deleteAction: Parameters<typeof ItemCard>[0]["deleteAction"],
) {
    return render(
        <ItemCard
            id="item-1"
            datasetId="ds-1"
            type="text"
            storageKey={null}
            mimeType={null}
            inputText="Hello world"
            label={undefined}
            schema={undefined}
            editAction={vi.fn(async () => ({}))}
            deleteAction={deleteAction}
        />,
    );
}

function openDeleteDialog() {
    fireEvent.click(
        screen.getByRole("button", { name: /^More actions for item/ }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
}

describe("ItemCard", () => {
    it("preserves input text when saving an edited golden answer", async () => {
        const editAction = vi.fn(async (_state: unknown, data: FormData) => {
            return { ok: data.has("inputText") };
        });
        render(
            <ItemCard
                id="item-1"
                datasetId="ds-1"
                type="text"
                storageKey={null}
                mimeType={null}
                inputText="Receipt from Maple Cafe"
                label={{ total: 12.5 }}
                schema={undefined}
                freeformLabel
                editAction={editAction}
                deleteAction={vi.fn(async () => ({}))}
            />,
        );
        fireEvent.click(screen.getByRole("button", { name: /^Edit$/ }));
        fireEvent.click(screen.getByRole("button", { name: "Save item" }));
        await waitFor(() => expect(editAction).toHaveBeenCalledTimes(1));
        expect(editAction.mock.calls[0]?.[1].get("inputText")).toBe(
            "Receipt from Maple Cafe",
        );
    });

    it("shows a failed delete's error inside the open dialog", async () => {
        const deleteAction = vi.fn(async () => ({
            formError: "Could not delete item.",
        }));
        renderCard(deleteAction);

        openDeleteDialog();
        const dialog = screen.getByRole("alertdialog");
        fireEvent.click(
            within(dialog).getByRole("button", { name: "Delete item" }),
        );

        await waitFor(() =>
            expect(
                within(screen.getByRole("alertdialog")).getByText(
                    "Could not delete item.",
                ),
            ).toBeInTheDocument(),
        );
        expect(deleteAction).toHaveBeenCalledTimes(1);
    });

    it("closes the dialog after a successful delete", async () => {
        const deleteAction = vi.fn(async () => ({ ok: true }));
        renderCard(deleteAction);

        openDeleteDialog();
        fireEvent.click(
            within(screen.getByRole("alertdialog")).getByRole("button", {
                name: "Delete item",
            }),
        );

        await waitFor(() =>
            expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
        );
        expect(deleteAction).toHaveBeenCalledTimes(1);
    });
});
