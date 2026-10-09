import { addImageItem } from "../service";
import {
    MAX_IMAGE_IMPORT_BYTES,
    imageFileFailure,
    importFailureReason,
    partitionMediaImportFiles,
    type IImageImportFile,
    type IImportSummary,
} from "./shared";

export interface IImageImportPartition {
    summary: IImportSummary;
    uniqueValidNames: string[];
    duplicateNames: Set<string>;
}

export function partitionImageImportFiles(
    files: IImageImportFile[],
): IImageImportPartition {
    return partitionMediaImportFiles(files, {
        mediaLabel: "Image",
        maxTotalBytes: MAX_IMAGE_IMPORT_BYTES,
        fileFailure: imageFileFailure,
    });
}

export function validateImageImportFiles(
    files: IImageImportFile[],
): IImportSummary {
    return partitionImageImportFiles(files).summary;
}

export async function importImageItems(
    datasetId: string,
    files: IImageImportFile[],
): Promise<IImportSummary> {
    const validation = validateImageImportFiles(files);
    if (validation.rejected) return validation;

    let importedCount = 0;
    const failures = [...validation.failures];
    const seenValidNames = new Set<string>();
    for (const file of files) {
        if (imageFileFailure(file)) continue;
        if (seenValidNames.has(file.name)) continue;
        seenValidNames.add(file.name);
        try {
            const bytes = Buffer.from(await file.arrayBuffer());
            await addImageItem(datasetId, bytes, file.type, undefined, undefined, file.name);
            importedCount++;
        } catch (err) {
            failures.push({
                fileName: file.name,
                reason: importFailureReason(err),
            });
        }
    }

    return { importedCount, failures };
}
