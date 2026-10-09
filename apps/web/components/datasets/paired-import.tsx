"use client";

import { FileDropzone } from "@/components/ui/file-dropzone";
import { IMAGE_ACCEPT, IMAGE_MAX_BYTES } from "./image-dropzone";
import { Label } from "@/components/ui/label";
import { HelpCallout } from "@/components/datasets/help-callout";
import { ReadinessChecklist, type IReadinessMeta } from "./readiness";
import { ImportFormShell } from "./import-form-shell";
import { bulkMediaField } from "@/lib/uploads/upload-form-media";
import type { IActionState } from "@/app/actions";
import type { IParsedSchemaDescriptor } from "@/server/db/jsonTypes";

export function PairedImport({
    datasetId,
    schema,
    readiness,
    action,
}: {
    datasetId: string;
    schema: IParsedSchemaDescriptor | undefined;
    readiness: IReadinessMeta;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    if (!schema) {
        return (
            <ReadinessChecklist meta={readiness} itemsHref="#add-item-form" />
        );
    }

    return (
        <ImportFormShell
            datasetId={datasetId}
            action={action}
            submitLabel="Import paired items"
            uploadFields={[bulkMediaField("images", "imageUploads", "image")]}
            textSizeGuards={[{ field: "spreadsheet", label: "CSV file" }]}
        >
            <HelpCallout title="Spreadsheet format">
                Upload a folder of images plus a CSV with a{" "}
                <code>filename</code> column and one column per answer field.
                Rows are matched to images by filename.
            </HelpCallout>

            <div className="flex flex-col gap-2">
                <Label htmlFor="paired-images">Images</Label>
                <FileDropzone
                    id="paired-images"
                    name="images"
                    multiple
                    accept={IMAGE_ACCEPT}
                    maxBytes={IMAGE_MAX_BYTES}
                    size="sm"
                    title="Drop images or click to browse"
                    hint="PNG, JPEG, GIF, WebP · max 20MB each"
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor="paired-csv">Answer spreadsheet (CSV)</Label>
                <FileDropzone
                    id="paired-csv"
                    name="spreadsheet"
                    accept=".csv,text/csv"
                    size="sm"
                    title="Drop a CSV file or click to browse"
                    hint="Needs a filename column matching the images"
                />
            </div>
        </ImportFormShell>
    );
}
