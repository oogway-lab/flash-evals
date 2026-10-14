import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDropzone } from "./file-dropzone";
import { SubmitButton } from "./submit-button";
import {
    IDLE_UPLOAD_PROGRESS,
    UploadProgressContext,
    uploadProgressKey,
    type IUploadProgress,
} from "@/lib/uploads/upload-progress";

afterEach(cleanup);

const png = (name = "a.png", size = 10) =>
    new File([new Uint8Array(size)], name, { type: "image/png" });

function drop(files: File[]) {
    fireEvent.drop(screen.getByRole("button", { name: /Drop/ }), {
        dataTransfer: { files },
    });
}

function renderDropzone(onFilesChange = vi.fn()) {
    render(
        <form>
            <FileDropzone
                id="images"
                name="images"
                accept="image/png,image/jpeg"
                maxBytes={100}
                multiple
                title="Drop images"
                hint="PNG or JPEG"
                onFilesChange={onFilesChange}
            />
            <button type="reset">Reset</button>
        </form>,
    );
    return onFilesChange;
}

describe("FileDropzone", () => {
    it("keeps the highlight while dragging over child elements", () => {
        renderDropzone();
        const zone = screen.getByRole("button", { name: /Drop/ });
        fireEvent.dragEnter(zone);
        fireEvent.dragEnter(zone); // entering a child
        fireEvent.dragLeave(zone); // leaving the child
        expect(zone).toHaveClass("border-primary");
        fireEvent.dragLeave(zone);
        expect(zone).not.toHaveClass("border-primary");
    });

    it("rejects wrong types and oversize files on drop, and lists the rest", () => {
        const onFilesChange = renderDropzone();
        drop([
            png("ok.png"),
            new File(["x"], "notes.txt", { type: "text/plain" }),
            png("huge.png", 500),
        ]);

        const leftOut = screen.getByRole("alert", { name: "Files left out" });
        expect(leftOut).toHaveTextContent("2 files won't be uploaded");
        expect(leftOut).toHaveTextContent("Unsupported file type");
        expect(leftOut).toHaveTextContent("notes.txt");
        expect(leftOut).toHaveTextContent(
            "Larger than the 100 B per-file limit",
        );
        expect(leftOut).toHaveTextContent("huge.png");
        expect(screen.getByText(/1 file will be uploaded/)).toBeInTheDocument();
        const list = screen.getByRole("list", { name: "Selected files" });
        expect(list).toHaveTextContent("ok.png");
        expect(onFilesChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ name: "ok.png" }),
        ]);
    });

    it("adds to the selection on each drop and checks the batch limits right away", () => {
        const onFilesChange = vi.fn();
        render(
            <FileDropzone
                name="images"
                accept="image/png"
                maxBytes={100}
                maxFiles={3}
                maxTotalBytes={50}
                multiple
                title="Drop images"
                hint="PNG"
                onFilesChange={onFilesChange}
            />,
        );
        drop([png("a.png", 20), png("b.png", 20)]);
        drop([png("c.png", 20), png("d.png", 5), png("e.png", 5)]);

        // c.png would pass 50 B; e.png would be a fourth file.
        expect(onFilesChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ name: "a.png" }),
            expect.objectContaining({ name: "b.png" }),
            expect.objectContaining({ name: "d.png" }),
        ]);
        expect(
            screen.getByText(/3 files will be uploaded/).parentElement,
        ).toHaveTextContent(
            "3 files will be uploaded · 45 B of 50 B · 2 left out",
        );
        const leftOut = screen.getByRole("alert", { name: "Files left out" });
        expect(leftOut).toHaveTextContent("Over the 50 B limit for one upload");
        expect(leftOut).toHaveTextContent("c.png");
        expect(leftOut).toHaveTextContent(
            "Over the 3-file limit for one upload",
        );
        expect(leftOut).toHaveTextContent("e.png");

        // Freeing room lets a left-out file back in.
        fireEvent.click(screen.getByRole("button", { name: "Remove d.png" }));
        expect(onFilesChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ name: "a.png" }),
            expect.objectContaining({ name: "b.png" }),
            expect.objectContaining({ name: "e.png" }),
        ]);

        fireEvent.click(screen.getByRole("button", { name: "Dismiss all" }));
        expect(
            screen.queryByRole("alert", { name: "Files left out" }),
        ).not.toBeInTheDocument();
    });

    it("shows each file's upload progress and keeps only failed files after an import", () => {
        const a = png("a.png");
        const b = png("b.png");
        const c = png("c.png");
        const progress = (
            files: IUploadProgress["files"],
            completedRun = 0,
        ): IUploadProgress => ({
            ...IDLE_UPLOAD_PROGRESS,
            phase: "uploading",
            files,
            completedRun,
        });
        const ui = (value: IUploadProgress) => (
            <UploadProgressContext.Provider value={value}>
                <FileDropzone
                    name="images"
                    accept="image/png"
                    multiple
                    title="Drop images"
                    hint="PNG"
                />
            </UploadProgressContext.Provider>
        );
        const { rerender } = render(ui(IDLE_UPLOAD_PROGRESS));
        drop([a, b, c]);

        const states: IUploadProgress["files"] = {
            [uploadProgressKey("images", a)]: {
                status: "done",
                loaded: 10,
                total: 10,
            },
            [uploadProgressKey("images", b)]: {
                status: "uploading",
                loaded: 4,
                total: 10,
            },
            [uploadProgressKey("images", c)]: {
                status: "failed",
                loaded: 0,
                total: 10,
                error: "The network failed.",
            },
        };
        rerender(ui(progress(states)));
        expect(screen.getByText("Uploaded")).toBeInTheDocument();
        expect(screen.getByText("40%")).toBeInTheDocument();
        expect(
            screen.getByRole("progressbar", { name: "Uploading b.png" }),
        ).toBeInTheDocument();
        expect(screen.getByText(/The network failed\./)).toBeInTheDocument();

        // The import went through: a.png is done and leaves the list.
        rerender(ui(progress(states, 1)));
        const list = screen.getByRole("list", { name: "Selected files" });
        expect(list).not.toHaveTextContent("a.png");
        expect(list).toHaveTextContent("b.png");
        expect(list).toHaveTextContent("c.png");
    });

    it("keeps a companion picker's file while another field has files to retry", () => {
        const csv = new File(["filename"], "answers.csv", { type: "text/csv" });
        const failed = png("bad.png");
        const ui = (value: IUploadProgress) => (
            <UploadProgressContext.Provider value={value}>
                <FileDropzone
                    name="spreadsheet"
                    accept=".csv,text/csv"
                    title="Drop a CSV"
                    hint="CSV"
                />
            </UploadProgressContext.Provider>
        );
        const run = (
            completedRun: number,
            status: "done" | "failed",
        ): IUploadProgress => ({
            ...IDLE_UPLOAD_PROGRESS,
            completedRun,
            retryPending: status === "failed",
            files: {
                [uploadProgressKey("images", failed)]: {
                    status,
                    loaded: 0,
                    total: 10,
                },
            },
        });
        const { rerender } = render(ui(IDLE_UPLOAD_PROGRESS));
        drop([csv]);

        // An image failed: the CSV is needed again for the retry.
        rerender(ui(run(1, "failed")));
        expect(
            screen.getByRole("list", { name: "Selected files" }),
        ).toHaveTextContent("answers.csv");

        // Everything went through: the CSV clears.
        rerender(ui(run(2, "done")));
        expect(
            screen.queryByRole("list", { name: "Selected files" }),
        ).not.toBeInTheDocument();
    });

    it("removes one file and clears all", () => {
        const onFilesChange = renderDropzone();
        drop([png("a.png"), png("b.png")]);

        fireEvent.click(screen.getByRole("button", { name: "Remove a.png" }));
        expect(onFilesChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ name: "b.png" }),
        ]);

        drop([png("c.png"), png("d.png")]);
        fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
        expect(onFilesChange).toHaveBeenLastCalledWith([]);
    });

    it("keeps its files across a form reset (React resets after every action)", () => {
        renderDropzone();
        drop([png("e.png")]);
        fireEvent.click(screen.getByRole("button", { name: "Reset" }));
        expect(
            screen.getByRole("list", { name: "Selected files" }),
        ).toHaveTextContent("e.png");
    });

    it("sends native required-field validation to the visible control", () => {
        render(
            <form>
                <FileDropzone
                    name="csv"
                    accept=".csv"
                    required
                    title="Drop a CSV"
                    hint="CSV"
                />
            </form>,
        );
        const input = document.getElementById("csv-file") as HTMLInputElement;
        fireEvent.invalid(input);
        const zone = screen.getByRole("button", { name: /Drop a CSV/ });
        expect(zone).toHaveFocus();
        expect(zone).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Choose a file to continue.",
        );
    });

    it("is disabled while its form submits", async () => {
        let finish!: () => void;
        render(
            <form action={() => new Promise<void>((r) => (finish = r))}>
                <FileDropzone
                    name="file"
                    accept=".csv"
                    title="Drop a CSV"
                    hint="CSV"
                />
                <SubmitButton>Upload</SubmitButton>
            </form>,
        );
        fireEvent.click(screen.getByRole("button", { name: "Upload" }));
        expect(
            await screen.findByRole("button", { name: /Drop a CSV/ }),
        ).toBeDisabled();
        await act(async () => finish());
        expect(
            screen.getByRole("button", { name: /Drop a CSV/ }),
        ).toBeEnabled();
    });
});
