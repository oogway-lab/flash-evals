"use client";

import { BulkAudioDropzone } from "./bulk-audio-dropzone";
import { ImportFormShell } from "./import-form-shell";
import { bulkMediaField } from "@/lib/uploads/upload-form-media";
import type { IActionState } from "@/app/actions";

export function AudioAddForm({
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
            submitLabel="Add audio"
            pendingLabel="Adding…"
            resultNoun="added"
            uploadFields={[bulkMediaField("audio", "audioUploads", "audio")]}
        >
            <BulkAudioDropzone name="audio" />
        </ImportFormShell>
    );
}
