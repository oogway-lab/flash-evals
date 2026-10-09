import { uploadFiles, UploadError } from "./direct-upload";

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
 * Returns `undefined` on success, or a typed error naming the offending field
 * (R6) when the whole batch fails (oversize/too-many/network/sign) or individual
 * files fail to PUT — so the caller can surface a retryable message.
 */
export async function uploadFormMedia(
    formData: FormData,
    datasetId: string,
    fields: IUploadField[],
): Promise<IUploadFormMediaError | undefined> {
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

        let result;
        try {
            result = await uploadFiles({
                datasetId,
                modality: spec.modality,
                files: selected,
            });
        } catch (err) {
            if (err instanceof UploadError) {
                return { field: spec.field, message: err.message };
            }
            throw err;
        }

        if (result.failures.length > 0) {
            const names = result.failures.map((f) => f.fileName).join(", ");
            const plural = result.failures.length === 1 ? "" : "s";
            return {
                field: spec.field,
                message: `Could not upload ${result.failures.length} file${plural} (${names}). Please retry.`,
            };
        }

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

    return undefined;
}
