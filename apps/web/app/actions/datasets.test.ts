import { beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";

const mocks = vi.hoisted(() => ({
    createDataset: vi.fn(),
    importImages: vi.fn(),
    importAudio: vi.fn(),
    importPairedItems: vi.fn(),
    createDatasetItemFromForm: vi.fn(),
    updateDatasetItemFromForm: vi.fn(),
    previewGoldenAnswers: vi.fn(),
    commitGoldenAnswers: vi.fn(),
    revalidatePath: vi.fn(),
}));

vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn(async () => ({
        teamId: "team-1",
        projectId: "project-1",
        userId: "user-1",
    })),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        createDataset: mocks.createDataset,
        importImages: mocks.importImages,
        importAudio: mocks.importAudio,
        importPairedItems: mocks.importPairedItems,
        createDatasetItemFromForm: mocks.createDatasetItemFromForm,
        updateDatasetItemFromForm: mocks.updateDatasetItemFromForm,
        previewGoldenAnswers: mocks.previewGoldenAnswers,
        commitGoldenAnswers: mocks.commitGoldenAnswers,
    }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
    addItemAction,
    editItemAction,
    importAudioAction,
    importImagesAction,
    importPairedItemsAction,
    previewGoldenAnswersAction,
    commitGoldenAnswersAction,
    createDatasetForInputAction,
} from "./datasets";

const okSummary = { importedCount: 1, failures: [] };

function imageUploadsJson() {
    return JSON.stringify([
        {
            storageKey: "datasets/ds-1/abc.png",
            name: "cat.png",
            mimeType: "image/png",
            size: 1234,
        },
    ]);
}

function audioUploadsJson() {
    return JSON.stringify([
        {
            storageKey: "datasets/ds-1/abc.mp3",
            name: "clip.mp3",
            mimeType: "audio/mpeg",
            size: 5678,
        },
    ]);
}

/** Asserts a value never carries inline base64 bytes (only a storageKey). */
function expectNoBase64(file: { storageKey?: string; base64Data?: unknown }) {
    expect(file.storageKey).toBeTruthy();
    expect(file.base64Data).toBeUndefined();
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDataset.mockResolvedValue({ id: "new-dataset" });
    mocks.importImages.mockResolvedValue(okSummary);
    mocks.importAudio.mockResolvedValue(okSummary);
    mocks.importPairedItems.mockResolvedValue(okSummary);
    mocks.createDatasetItemFromForm.mockResolvedValue({ datasetId: "ds-1" });
    mocks.updateDatasetItemFromForm.mockResolvedValue({ datasetId: "ds-1" });
    mocks.previewGoldenAnswers.mockResolvedValue({
        fields: [],
        proposedMapping: {},
        rows: [],
        importableCount: 0,
        warningCount: 0,
        failingCount: 0,
    });
    mocks.commitGoldenAnswers.mockResolvedValue(okSummary);
});

describe("createDatasetForInputAction", () => {
    it("creates an evaluation dataset and returns its id without redirecting", async () => {
        const formData = new FormData();
        formData.set("name", "Canvas images");
        formData.set("modality", "image");

        await expect(createDatasetForInputAction(formData)).resolves.toEqual({
            id: "new-dataset",
        });
        expect(mocks.createDataset).toHaveBeenCalledWith({
            teamId: "team-1",
            projectId: "project-1",
            name: "Canvas images",
            purpose: "evaluation",
            modality: "image",
            createdBy: "user-1",
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/datasets");
    });
});

describe("mapped golden answer actions", () => {
    it("forwards a guarded multi-file batch to preview and commit", async () => {
        const files = JSON.stringify([
            {
                fileName: "one.json",
                content: JSON.stringify({ transcript: "one" }),
            },
            {
                fileName: "two.json",
                content: JSON.stringify({ transcript: "two" }),
                itemId: "item-2",
            },
        ]);
        const previewData = new FormData();
        previewData.set("datasetId", "ds-1");
        previewData.set("answersContent", "");
        previewData.set("answerFiles", files);

        await expect(
            previewGoldenAnswersAction(previewData),
        ).resolves.toMatchObject({
            ok: true,
        });
        expect(mocks.previewGoldenAnswers).toHaveBeenCalledWith(
            expect.objectContaining({
                datasetId: "ds-1",
                answerFiles: expect.arrayContaining([
                    expect.objectContaining({ fileName: "one.json" }),
                    expect.objectContaining({
                        fileName: "two.json",
                        itemId: "item-2",
                    }),
                ]),
            }),
        );

        const commitData = new FormData();
        commitData.set("datasetId", "ds-1");
        commitData.set("answersContent", "");
        commitData.set("answerFiles", files);
        commitData.set(
            "mapping",
            JSON.stringify({ transcript: "expectedTranscript" }),
        );
        await expect(
            commitGoldenAnswersAction(commitData),
        ).resolves.toMatchObject({
            ok: true,
        });
        expect(mocks.commitGoldenAnswers).toHaveBeenCalledWith(
            expect.objectContaining({ answerFiles: expect.any(Array) }),
        );
    });

    it("rejects malformed file batches before calling the API", async () => {
        const data = new FormData();
        data.set("datasetId", "ds-1");
        data.set(
            "answerFiles",
            JSON.stringify([{ fileName: "bad.txt", content: "{}" }]),
        );

        await expect(previewGoldenAnswersAction(data)).resolves.toEqual({
            ok: false,
            error: "bad.txt is not a JSON or JSONL file.",
        });
        expect(mocks.previewGoldenAnswers).not.toHaveBeenCalled();
    });
});

describe("importImagesAction", () => {
    it("forwards storageKeys (not base64) and returns success state", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("imageUploads", imageUploadsJson());

        const state = await importImagesAction({}, formData);

        expect(mocks.importImages).toHaveBeenCalledTimes(1);
        const arg = mocks.importImages.mock.calls[0][0];
        expect(arg).toMatchObject({
            teamId: "team-1",
            projectId: "project-1",
            datasetId: "ds-1",
        });
        expect(arg.images).toHaveLength(1);
        expectNoBase64(arg.images[0]);
        expect(arg.images[0]).toMatchObject({
            storageKey: "datasets/ds-1/abc.png",
            name: "cat.png",
            mimeType: "image/png",
            size: 1234,
        });
        expect(state.ok).toBe(true);
    });

    it("rejects when no uploads are present (non-file validation)", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");

        const state = await importImagesAction({}, formData);

        expect(mocks.importImages).not.toHaveBeenCalled();
        expect(state.rejected).toBe(true);
        expect(state.formError).toContain("Choose one or more images");
    });

    it("maps a MosaicApiError to typed field state, not a throw (R6)", async () => {
        mocks.importImages.mockRejectedValue(
            new MosaicApiError("Uploaded object is missing.", 400),
        );
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("imageUploads", imageUploadsJson());

        const state = await importImagesAction({}, formData);

        expect(state.rejected).toBe(true);
        expect(state.formError).toBe("Uploaded object is missing.");
    });

    it("rethrows not-found/archived/forbidden errors", async () => {
        mocks.importImages.mockRejectedValue(
            new MosaicApiError("Dataset not found", 404),
        );
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("imageUploads", imageUploadsJson());

        await expect(importImagesAction({}, formData)).rejects.toThrow(
            "Dataset not found",
        );
    });
});

describe("importAudioAction", () => {
    it("forwards storageKeys (not base64) and returns success state", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("audioUploads", audioUploadsJson());

        const state = await importAudioAction({}, formData);

        const arg = mocks.importAudio.mock.calls[0][0];
        expect(arg.audio).toHaveLength(1);
        expectNoBase64(arg.audio[0]);
        expect(state.ok).toBe(true);
    });

    it("maps a MosaicApiError to typed field state, not a throw (R6)", async () => {
        mocks.importAudio.mockRejectedValue(
            new MosaicApiError("Object too large.", 400),
        );
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("audioUploads", audioUploadsJson());

        const state = await importAudioAction({}, formData);
        expect(state.rejected).toBe(true);
        expect(state.formError).toBe("Object too large.");
    });
});

describe("importPairedItemsAction", () => {
    it("forwards image storageKeys and reads the CSV as text", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("imageUploads", imageUploadsJson());
        const csvBody = "filename,answer\ncat.png,cat";
        const csv = new File([csvBody], "answers.csv", { type: "text/csv" });
        // jsdom's File lacks .text(); the Next server runtime provides it.
        Object.defineProperty(csv, "text", { value: async () => csvBody });
        formData.set("spreadsheet", csv);

        const state = await importPairedItemsAction({}, formData);

        const arg = mocks.importPairedItems.mock.calls[0][0];
        expect(arg.images).toHaveLength(1);
        expectNoBase64(arg.images[0]);
        expect(arg.csvContent).toContain("filename,answer");
        expect(state.ok).toBe(true);
    });

    it("rejects when the CSV is missing", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("imageUploads", imageUploadsJson());

        const state = await importPairedItemsAction({}, formData);
        expect(mocks.importPairedItems).not.toHaveBeenCalled();
        expect(state.rejected).toBe(true);
    });
});

describe("addItemAction", () => {
    it("sends an image storageKey (not base64) for a single item", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set("inputText", "hello");
        formData.set("label", "{}");
        formData.set("imageUpload", imageUploadsJson());

        const state = await addItemAction({}, formData);

        const arg = mocks.createDatasetItemFromForm.mock.calls[0][0];
        expect(arg.image).toBeDefined();
        expectNoBase64(arg.image);
        expect(arg.audio).toBeUndefined();
        expect(state.ok).toBe(true);
    });

    it("rejects an unsupported image type (non-file validation)", async () => {
        const formData = new FormData();
        formData.set("datasetId", "ds-1");
        formData.set(
            "imageUpload",
            JSON.stringify([
                {
                    storageKey: "datasets/ds-1/x.tiff",
                    name: "x.tiff",
                    mimeType: "image/tiff",
                    size: 10,
                },
            ]),
        );

        const state = await addItemAction({}, formData);
        expect(mocks.createDatasetItemFromForm).not.toHaveBeenCalled();
        expect(state.fieldErrors?.image?.[0]).toContain(
            "Unsupported image type",
        );
    });
});

describe("editItemAction", () => {
    it("sends an audio storageKey (not base64) when replacing media", async () => {
        const formData = new FormData();
        formData.set("itemId", "item-1");
        formData.set("inputText", "hi");
        formData.set("label", "{}");
        formData.set("audioUpload", audioUploadsJson());

        const state = await editItemAction({}, formData);

        const arg = mocks.updateDatasetItemFromForm.mock.calls[0][0];
        expect(arg.audio).toBeDefined();
        expectNoBase64(arg.audio);
        expect(state.ok).toBe(true);
    });
});
