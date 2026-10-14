import {
    uploadFiles,
    UploadError,
    type IFileProgressEvent,
} from "./direct-upload";

/**
 * Declares one FormData field whose selected File(s) must be uploaded directly
 * to storage (U5) before the Server Action runs. The bytes are replaced with a
 * JSON metadata list under `targetField` so only `storageKey` + metadata cross
 * the Server Action boundary (R1).
 */
export interface IUploadField {
    /** FormData field holding the selected File(s). */
    field: string;
    /** FormData field to receive the JSON-encoded uploaded metadata. */
    targetField: string;
    modality: "image" | "audio";
    multiple: boolean;
}

/** A typed upload failure, naming the offending FormData field (R6). */
export interface IUploadFormMediaError {
    field: string;
    message: string;
}

/** One file that could not be uploaded, after retries. */
export interface IUploadFileFailure {
    field: string;
    fileName: string;
    reason: string;
}

export interface IUploadFormMediaOutcome {
    /** Set when nothing can be imported: the batch failed as a whole. */
    error?: IUploadFormMediaError;
    /**
     * Files that failed while others in their field uploaded. The uploaded
     * ones are already in FormData, so the import goes ahead without these.
     */
    fileFailures: IUploadFileFailure[];
}

/** Progress callbacks, reported per FormData field. */
export interface IUploadFormMediaProgress {
    /** A field's files are about to be signed (`preparing`) or sent (`uploading`). */
    onPhase?: (phase: "preparing" | "uploading", field: string) => void;
    /** Before signing, every file that will be sent, so they can show as queued. */
    onQueued?: (field: string, files: File[]) => void;
    onFileProgress?: (
        field: string,
        file: File,
        event: IFileProgressEvent,
    ) => void;
}

/** Build the upload spec for a single-item media field (`image`/`audio`). */
export function singleMediaField(modality: "image" | "audio"): IUploadField {
    return {
        field: modality,
        targetField: `${modality}Upload`,
        modality,
        multiple: false,
    };
}

/** Build the upload spec for a bulk media field. */
export function bulkMediaField(
    field: string,
    targetField: string,
    modality: "image" | "audio",
): IUploadField {
    return { field, targetField, modality, multiple: true };
}

/**
 * Upload any File(s) held in the given FormData fields directly to Supabase and
 * replace them, in place, with JSON metadata (`storageKey` + name/mimeType/size).
 * File bytes never traverse the Next.js Server Action (R1).
 *
 * A file that fails to upload (after `uploadFiles` has retried it) is left out
 * and reported in `fileFailures`; the rest of its field still goes through.
 * `error` is set, naming the offending field (R6), only when nothing in a field
 * could be uploaded (oversize/too-many/network/sign, or every file failed).
 */
export async function uploadFormMedia(
    formData: FormData,
    datasetId: string,
    fields: IUploadField[],
    progress: IUploadFormMediaProgress = {},
): Promise<IUploadFormMediaOutcome> {
    const fileFailures: IUploadFileFailure[] = [];
    for (const spec of fields) {
        const files = formData
            .getAll(spec.field)
            .filter(
                (value): value is File =>
                    value instanceof File && value.size > 0,
            );
        // Remove the raw File(s); the action reads `targetField` metadata instead.
        formData.delete(spec.field);
        if (files.length === 0) continue;

        const selected = spec.multiple ? files : files.slice(0, 1);
        progress.onQueued?.(spec.field, selected);
        progress.onPhase?.("preparing", spec.field);

        let result;
        try {
            result = await uploadFiles({
                datasetId,
                modality: spec.modality,
                files: selected,
                onSigned: () => progress.onPhase?.("uploading", spec.field),
                onFileProgress: progress.onFileProgress
                    ? (event) =>
                          progress.onFileProgress?.(
                              spec.field,
                              selected[event.index],
                              event,
                          )
                    : undefined,
            });
        } catch (err) {
            if (err instanceof UploadError) {
                return {
                    error: { field: spec.field, message: err.message },
                    fileFailures,
                };
            }
            throw err;
        }

        if (result.uploaded.length === 0 && result.failures.length > 0) {
            const names = result.failures.map((f) => f.fileName).join(", ");
            const plural = result.failures.length === 1 ? "" : "s";
            return {
                error: {
                    field: spec.field,
                    message: `Could not upload ${result.failures.length} file${plural} (${names}). Please retry.`,
                },
                fileFailures: [
                    ...fileFailures,
                    ...result.failures.map((failure) => ({
                        field: spec.field,
                        fileName: failure.fileName,
                        reason: failure.error.message,
                    })),
                ],
            };
        }
        fileFailures.push(
            ...result.failures.map((failure) => ({
                field: spec.field,
                fileName: failure.fileName,
                reason: failure.error.message,
            })),
        );

        formData.set(
            spec.targetField,
            JSON.stringify(
                result.uploaded.map((uploaded) => ({
                    storageKey: uploaded.storageKey,
                    name: uploaded.fileName,
                    mimeType: uploaded.contentType,
                    size: uploaded.byteSize,
                })),
            ),
        );
    }

    return { fileFailures };
}
