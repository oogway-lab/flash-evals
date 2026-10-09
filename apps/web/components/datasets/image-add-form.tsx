"use client";

import { BulkImageDropzone } from "./bulk-image-dropzone";
import { ImportFormShell } from "./import-form-shell";
import { bulkMediaField } from "@/lib/uploads/upload-form-media";
import type { IActionState } from "@/app/actions";

export function ImageAddForm({
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
            submitLabel="Add images"
            pendingLabel="Adding…"
            resultNoun="added"
            uploadFields={[bulkMediaField("images", "imageUploads", "image")]}
        >
            <BulkImageDropzone name="images" />
        </ImportFormShell>
    );
}
