"use client";

import { FileDropzone } from "@/components/ui/file-dropzone";
import { Label } from "@/components/ui/label";
import { BulkImageDropzone } from "@/components/datasets/bulk-image-dropzone";
import { HelpCallout } from "@/components/datasets/help-callout";
import { ImportFormShell } from "./import-form-shell";
import { bulkMediaField } from "@/lib/uploads/upload-form-media";
import type { IActionState } from "@/app/actions";

export function ImageAnswersImport({
    datasetId,
    action,
}: {
    datasetId: string;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    return (
        <ImportFormShell
            datasetId={datasetId}
            action={action}
            submitLabel="Import images with answers"
            pendingLabel="Importing…"
            resultNoun="images imported"
            uploadFields={[bulkMediaField("images", "imageUploads", "image")]}
            textSizeGuards={[{ field: "answers", label: "Answer file" }]}
        >
            <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-2">
                    <Label>Images</Label>
                    <BulkImageDropzone name="images" />
                </div>

                <div className="flex flex-col gap-2">
                    <Label htmlFor="image-answers">
                        Answers keyed by image filename
                    </Label>
                    <FileDropzone
                        id="image-answers"
                        name="answers"
                        accept=".json,.jsonl,application/json"
                        required
                        size="sm"
                        title="Drop a JSON or JSONL file or click to browse"
                        hint="A JSON array, or one JSON object per line"
                    />
                    <HelpCallout title="Answer file format">
                        Upload JSONL or a JSON array. Each row needs{" "}
                        <code>filename</code> plus a <code>label</code> object.
                        Example:{" "}
                        <code>
                            {`{"filename":"plate.png","label":{"answer":"salad"}}`}
                        </code>
                    </HelpCallout>
                </div>
            </div>
        </ImportFormShell>
    );
}
