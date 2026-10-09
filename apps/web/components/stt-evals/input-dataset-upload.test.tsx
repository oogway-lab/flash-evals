import { afterEach, describe, expect, it, vi } from "vitest";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    waitFor,
} from "@testing-library/react";
import type { IActionState } from "@/app/actions";

const mocks = vi.hoisted(() => ({
    createDataset: vi.fn(),
    importAudio: vi.fn(),
    importImages: vi.fn(),
    importText: vi.fn(),
}));

vi.mock("@/app/actions", () => ({
    createDatasetForInputAction: mocks.createDataset,
    importAudioAction: mocks.importAudio,
    importImagesAction: mocks.importImages,
    importTextItemsAction: mocks.importText,
}));

vi.mock("@/components/datasets/audio-add-form", () => ({
    AudioAddForm: ({
        action,
    }: {
        action: (state: IActionState, data: FormData) => void;
    }) => (
        <button type="button" onClick={() => action({}, new FormData())}>
            Add audio
        </button>
    ),
}));
vi.mock("@/components/datasets/image-add-form", () => ({
    ImageAddForm: ({
        action,
    }: {
        action: (state: IActionState, data: FormData) => void;
    }) => (
        <button type="button" onClick={() => action({}, new FormData())}>
            Add images
        </button>
    ),
}));
vi.mock("@/components/datasets/text-bulk-import", () => ({
    TextBulkImport: ({
        action,
    }: {
        action: (state: IActionState, data: FormData) => void;
    }) => (
        <button type="button" onClick={() => action({}, new FormData())}>
            Import text
        </button>
    ),
}));

import { InputDatasetUpload } from "./input-dataset-upload";

afterEach(() => {
    cleanup();
    vi.clearAllMocks();
});

async function createFor(modality: "audio" | "image" | "text") {
    mocks.createDataset.mockResolvedValue({ id: `${modality}-dataset` });
    const onBind = vi.fn();
    render(<InputDatasetUpload modality={modality} onBind={onBind} />);
    fireEvent.change(screen.getByLabelText("New dataset name"), {
        target: { value: `${modality} from canvas` },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));
    await waitFor(() =>
        expect(onBind).toHaveBeenCalledWith(`${modality}-dataset`),
    );
    const formData = mocks.createDataset.mock.calls[0][0] as FormData;
    expect(formData.get("name")).toBe(`${modality} from canvas`);
    expect(formData.get("modality")).toBe(modality);
    return onBind;
}

describe("InputDatasetUpload", () => {
    it("creates, binds, and imports an image dataset", async () => {
        mocks.importImages.mockResolvedValue({
            ok: true,
            importedCount: 2,
            resetKey: 1,
        });
        const onBind = await createFor("image");

        fireEvent.click(screen.getByRole("button", { name: "Add images" }));
        await waitFor(() =>
            expect(mocks.importImages).toHaveBeenCalledTimes(1),
        );
        expect(onBind).toHaveBeenLastCalledWith("image-dataset");
        expect(screen.getByText("2 items added in this panel.")).toBeTruthy();
    });

    it.each([
        ["audio", "Add audio", "importAudio"],
        ["text", "Import text", "importText"],
    ] as const)("uses the %s importer", async (modality, label, importKey) => {
        mocks[importKey].mockResolvedValue({
            ok: true,
            importedCount: 1,
            resetKey: 1,
        });
        await createFor(modality);

        fireEvent.click(screen.getByRole("button", { name: label }));
        await waitFor(() => expect(mocks[importKey]).toHaveBeenCalledTimes(1));
    });

    it("shows a readable dataset creation error", async () => {
        mocks.createDataset.mockRejectedValue(
            new Error("Name already exists."),
        );
        render(<InputDatasetUpload modality="image" onBind={vi.fn()} />);
        fireEvent.change(screen.getByLabelText("New dataset name"), {
            target: { value: "Duplicate" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Create dataset" }));

        expect(await screen.findByRole("alert")).toHaveTextContent(
            "Name already exists.",
        );
    });
});
