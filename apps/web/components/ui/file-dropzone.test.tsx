import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileDropzone, fileMatchesAccept } from "./file-dropzone";
import { SubmitButton } from "./submit-button";

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

describe("fileMatchesAccept", () => {
    it("matches extensions, exact types and wildcards", () => {
        expect(fileMatchesAccept(png(), "image/png")).toBe(true);
        expect(fileMatchesAccept(png(), "image/*")).toBe(true);
        expect(fileMatchesAccept(png("x.PNG"), ".png")).toBe(true);
        expect(fileMatchesAccept(png(), ".csv,text/csv")).toBe(false);
    });
});

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

        expect(screen.getByRole("alert")).toHaveTextContent(
            "notes.txt: unsupported file type.",
        );
        expect(screen.getByRole("alert")).toHaveTextContent(
            "huge.png: larger than",
        );
        const list = screen.getByRole("list", { name: "Selected files" });
        expect(list).toHaveTextContent("ok.png");
        expect(onFilesChange).toHaveBeenLastCalledWith([
            expect.objectContaining({ name: "ok.png" }),
        ]);
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
