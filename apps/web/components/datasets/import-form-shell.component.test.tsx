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

import { FileDropzone } from "@/components/ui/file-dropzone";
import type { IUploadFormMediaProgress } from "@/lib/uploads/upload-form-media";
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
    it.each([
        [
            "rejected",
            {
                ok: false,
                rejected: true,
                importedCount: 0,
                failures: [{ reason: "Bad batch." }],
                formError: "Bad batch.",
                resetKey: 1,
            },
        ],
        [
            "imported nothing",
            {
                ok: true,
                importedCount: 0,
                failures: [{ fileName: "a.wav", reason: "Could not decode." }],
                resetKey: 1,
            },
        ],
    ])(
        "keeps uploaded files selected and removable when the import %s",
        async (_label, outcome) => {
            const wav = new File([new Uint8Array(4)], "a.wav", {
                type: "audio/wav",
            });
            uploads.uploadFormMedia.mockImplementation(
                async (
                    _formData: FormData,
                    _datasetId: string,
                    _fields: unknown,
                    progress: IUploadFormMediaProgress,
                ) => {
                    progress.onQueued?.("audio", [wav]);
                    progress.onFileProgress?.("audio", wav, {
                        index: 0,
                        status: "done",
                        loaded: wav.size,
                        total: wav.size,
                    });
                    return { fileFailures: [] };
                },
            );
            render(
                <ImportFormShell
                    datasetId="dataset-1"
                    submitLabel="Add audio"
                    action={async () => outcome}
                    uploadFields={[
                        {
                            field: "audio",
                            targetField: "audioUploads",
                            modality: "audio",
                            multiple: true,
                        },
                    ]}
                >
                    <FileDropzone
                        name="audio"
                        accept="audio/wav"
                        multiple
                        title="Drop audio"
                        hint="WAV"
                    />
                </ImportFormShell>,
            );
            fireEvent.drop(screen.getByRole("button", { name: /Drop audio/ }), {
                dataTransfer: { files: [wav] },
            });
            fireEvent.click(screen.getByRole("button", { name: "Add audio" }));

            expect(
                await screen.findByText(/Nothing was imported/),
            ).toBeInTheDocument();
            expect(
                screen.getByRole("list", { name: "Selected files" }),
            ).toHaveTextContent("a.wav");
            expect(screen.queryByText("Uploaded")).not.toBeInTheDocument();
            expect(
                screen.getByRole("button", { name: "Remove a.wav" }),
            ).toBeInTheDocument();
        },
    );
});
