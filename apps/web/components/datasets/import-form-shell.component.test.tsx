import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { ImportFormShell } from "./import-form-shell";

afterEach(() => {
    cleanup();
    toast.success.mockReset();
    toast.error.mockReset();
});

describe("ImportFormShell outcomes", () => {
    it("reports a rejected import once, in the summary", async () => {
        const reason = "The CSV has no filename column.";
        render(
            <ImportFormShell
                datasetId="dataset-1"
                submitLabel="Import"
                action={async () => ({
                    ok: false,
                    rejected: true,
                    importedCount: 0,
                    failures: [{ reason }],
                    formError: reason,
                    resetKey: 1,
                })}
            >
                <input aria-label="Notes" name="notes" />
            </ImportFormShell>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Import" }));

        expect(await screen.findAllByText(reason)).toHaveLength(1);
        expect(toast.error).not.toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
    });

    it("toasts a full success", async () => {
        render(
            <ImportFormShell
                datasetId="dataset-1"
                submitLabel="Import"
                resultNoun="items imported"
                action={async () => ({
                    ok: true,
                    importedCount: 3,
                    failures: [],
                    resetKey: 1,
                })}
            >
                <input aria-label="Notes" name="notes" />
            </ImportFormShell>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await screen.findByText("Import summary");
        // The toast fires from an effect after the summary renders.
        await waitFor(() =>
            expect(toast.success).toHaveBeenCalledWith("3 items imported."),
        );
    });
});
