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

const uploads = vi.hoisted(() => ({ uploadFormMedia: vi.fn() }));
vi.mock("@/lib/uploads/upload-form-media", async (importActual) => ({
    ...(await importActual<object>()),
    uploadFormMedia: uploads.uploadFormMedia,
}));

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

    it("imports the files that uploaded and lists the one that failed", async () => {
        uploads.uploadFormMedia.mockResolvedValue({
            fileFailures: [
                {
                    field: "audio",
                    fileName: "bad.wav",
                    reason: "The network dropped.",
                },
            ],
        });
        const action = vi.fn(async () => ({
            ok: true,
            importedCount: 2,
            failures: [],
            resetKey: 1,
        }));
        render(
            <ImportFormShell
                datasetId="dataset-1"
                submitLabel="Add audio"
                action={action}
                uploadFields={[
                    {
                        field: "audio",
                        targetField: "audioUploads",
                        modality: "audio",
                        multiple: true,
                    },
                ]}
            >
                <input aria-label="Notes" name="notes" />
            </ImportFormShell>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Add audio" }));

        expect(await screen.findByText("Imported: 2")).toBeInTheDocument();
        expect(action).toHaveBeenCalledTimes(1);
        expect(screen.getByText("bad.wav")).toBeInTheDocument();
        expect(
            screen.getByText("Upload failed: The network dropped."),
        ).toBeInTheDocument();
        expect(
            screen.getByText(/Submit again to retry just those/),
        ).toBeInTheDocument();
        expect(toast.success).not.toHaveBeenCalled();
    });
});
