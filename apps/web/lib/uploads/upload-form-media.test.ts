import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DirectUpload from "./direct-upload";

const mocks = vi.hoisted(() => ({ uploadFiles: vi.fn() }));

vi.mock("./direct-upload", async () => {
    const actual =
        await vi.importActual<typeof DirectUpload>("./direct-upload");
    return { ...actual, uploadFiles: mocks.uploadFiles };
});

import { UploadError } from "./direct-upload";
import {
    bulkMediaField,
    singleMediaField,
    uploadFormMedia,
} from "./upload-form-media";

beforeEach(() => vi.clearAllMocks());

function imageFile(name = "cat.png") {
    return new File(["x"], name, { type: "image/png" });
}

describe("uploadFormMedia", () => {
    it("replaces File bytes with storageKey metadata (no File left in FormData)", async () => {
        mocks.uploadFiles.mockResolvedValue({
            uploaded: [
                {
                    storageKey: "datasets/ds-1/abc.png",
                    fileName: "cat.png",
                    contentType: "image/png",
                    byteSize: 1,
                },
            ],
            failures: [],
        });

        const formData = new FormData();
        formData.set("images", imageFile());

        const error = await uploadFormMedia(formData, "ds-1", [
            bulkMediaField("images", "imageUploads", "image"),
        ]);

        expect(error).toBeUndefined();
        // The raw File is gone; only JSON metadata remains.
        expect(formData.get("images")).toBeNull();
        const meta = JSON.parse(String(formData.get("imageUploads")));
        expect(meta).toEqual([
            {
                storageKey: "datasets/ds-1/abc.png",
                name: "cat.png",
                mimeType: "image/png",
                size: 1,
            },
        ]);
        expect(mocks.uploadFiles).toHaveBeenCalledWith(
            expect.objectContaining({ datasetId: "ds-1", modality: "image" }),
        );
    });

    it("returns a typed error naming the field when uploadFiles throws (R6)", async () => {
        mocks.uploadFiles.mockRejectedValue(
            new UploadError("oversize", "This batch is too large."),
        );
        const formData = new FormData();
        formData.set("audio", new File(["x"], "a.mp3", { type: "audio/mpeg" }));

        const error = await uploadFormMedia(formData, "ds-1", [
            singleMediaField("audio"),
        ]);

        expect(error).toEqual({
            field: "audio",
            message: "This batch is too large.",
        });
    });

    it("reports per-file failures so the caller can retry", async () => {
        mocks.uploadFiles.mockResolvedValue({
            uploaded: [],
            failures: [
                {
                    fileName: "bad.png",
                    error: new UploadError("storage", "boom", {
                        fileName: "bad.png",
                    }),
                },
            ],
        });
        const formData = new FormData();
        formData.set("images", imageFile("bad.png"));

        const error = await uploadFormMedia(formData, "ds-1", [
            bulkMediaField("images", "imageUploads", "image"),
        ]);

        expect(error?.field).toBe("images");
        expect(error?.message).toContain("bad.png");
    });

    it("skips fields with no selected file and never calls uploadFiles", async () => {
        const formData = new FormData();
        const error = await uploadFormMedia(formData, "ds-1", [
            singleMediaField("image"),
        ]);
        expect(error).toBeUndefined();
        expect(mocks.uploadFiles).not.toHaveBeenCalled();
        expect(formData.get("imageUpload")).toBeNull();
    });
});
