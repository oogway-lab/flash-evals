import {
    ALLOWED_AUDIO_TYPES,
    ALLOWED_IMAGE_TYPES,
    MAX_AUDIO_BYTES,
    MAX_AUDIO_IMPORT_BYTES,
    MAX_IMAGE_BYTES,
    MAX_IMAGE_IMPORT_BYTES,
    MAX_IMPORT_FILE_COUNT,
    type ISignedUploadTarget,
} from "@mosaic/api-contract";

export type UploadModality = "audio" | "image";

export type UploadErrorKind =
    | "oversize"
    | "too-many"
    | "unsupported-type"
    | "sign-failed"
    | "network"
    | "expired"
    | "storage";

/**
 * A typed failure raised by the direct-upload flow. `kind` lets the caller map
 * the failure to a friendly, actionable, retryable message (R6); `fileName`
 * names the offending file when the failure is file-specific.
 */
export class UploadError extends Error {
    readonly kind: UploadErrorKind;
    readonly fileName?: string;

    constructor(
        kind: UploadErrorKind,
        message: string,
        options?: { fileName?: string; cause?: unknown },
    ) {
        super(message);
        this.name = "UploadError";
        this.kind = kind;
        this.fileName = options?.fileName;
        if (options?.cause !== undefined) {
            (this as { cause?: unknown }).cause = options.cause;
        }
    }
}

/** A successfully uploaded object plus the metadata a caller needs to import it. */
export interface IUploadedObject {
    storageKey: string;
    fileName: string;
    contentType: string;
    byteSize: number;
}

export interface IUploadFailure {
    fileName: string;
    error: UploadError;
}

export interface IUploadFilesResult {
    uploaded: IUploadedObject[];
    failures: IUploadFailure[];
}

export interface IUploadFilesParams {
    datasetId: string;
    modality: UploadModality;
    files: File[];
    onProgress?: (done: number, total: number) => void;
    concurrency?: number;
}

interface IModalityCaps {
    perFile: number;
    batch: number;
}

const MODALITY_CAPS: Record<UploadModality, IModalityCaps> = {
    image: { perFile: MAX_IMAGE_BYTES, batch: MAX_IMAGE_IMPORT_BYTES },
    audio: { perFile: MAX_AUDIO_BYTES, batch: MAX_AUDIO_IMPORT_BYTES },
};

const DEFAULT_CONCURRENCY = 3;
const SIGN_ENDPOINT = "/api/datasets/upload/sign";

function formatBytes(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/**
 * Fail-fast client-side validation performed BEFORE any network call: count,
 * per-file size, and batch total against the modality caps. Throws a typed
 * `UploadError` (`too-many` / `oversize`) so an oversize batch never reaches the
 * signing endpoint.
 */
function preValidate(files: File[], modality: UploadModality): void {
    if (files.length > MAX_IMPORT_FILE_COUNT) {
        throw new UploadError(
            "too-many",
            `You can upload at most ${MAX_IMPORT_FILE_COUNT} files at once (got ${files.length}).`,
        );
    }

    const caps = MODALITY_CAPS[modality];
    const allowedTypes =
        modality === "image" ? ALLOWED_IMAGE_TYPES : ALLOWED_AUDIO_TYPES;
    let total = 0;
    for (const file of files) {
        total += file.size;
        if (file.size > caps.perFile) {
            throw new UploadError(
                "oversize",
                `"${file.name}" is too large (${formatBytes(file.size)}). The per-file limit is ${formatBytes(caps.perFile)}.`,
                { fileName: file.name },
            );
        }
        const contentType = file.type || "application/octet-stream";
        if (!allowedTypes.includes(contentType)) {
            throw new UploadError(
                "unsupported-type",
                `"${file.name}" has unsupported type "${contentType}" for ${modality} uploads.`,
                { fileName: file.name },
            );
        }
    }

    if (total > caps.batch) {
        throw new UploadError(
            "oversize",
            `This batch is too large (${formatBytes(total)}). The total upload limit is ${formatBytes(caps.batch)}.`,
        );
    }
}

interface ISignErrorBody {
    error?: unknown;
}

async function requestSignedTargets(
    params: IUploadFilesParams,
): Promise<ISignedUploadTarget[]> {
    const { datasetId, modality, files } = params;

    let res: Response;
    try {
        res = await fetch(SIGN_ENDPOINT, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                datasetId,
                modality,
                files: files.map((file) => ({
                    fileName: file.name,
                    byteSize: file.size,
                    contentType: file.type || "application/octet-stream",
                })),
            }),
        });
    } catch (cause) {
        throw new UploadError(
            "network",
            "Could not reach the server to prepare the upload. Check your connection and try again.",
            { cause },
        );
    }

    if (!res.ok) {
        let message = `Could not prepare the upload (${res.status}).`;
        try {
            const body = (await res.json()) as ISignErrorBody;
            if (typeof body.error === "string" && body.error.length > 0) {
                message = body.error;
            }
        } catch {
            // Non-JSON error body — keep the status-based message.
        }
        throw new UploadError("sign-failed", message);
    }

    const body = (await res.json()) as { targets?: ISignedUploadTarget[] };
    if (!Array.isArray(body.targets) || body.targets.length !== files.length) {
        throw new UploadError(
            "sign-failed",
            "The server returned an unexpected number of upload targets.",
        );
    }
    return body.targets;
}

function putErrorFromStatus(status: number, fileName: string): UploadError {
    if (status === 400 || status === 401 || status === 403) {
        // Supabase rejects an expired/invalid single-use token with these codes.
        return new UploadError(
            "expired",
            `The upload authorization for "${fileName}" expired or was rejected. Please retry.`,
            { fileName },
        );
    }
    return new UploadError(
        "storage",
        `Storage rejected "${fileName}" (${status}). Please retry.`,
        { fileName },
    );
}

async function putFile(
    file: File,
    target: ISignedUploadTarget,
): Promise<IUploadedObject> {
    let res: Response;
    try {
        res = await fetch(target.signedUrl, {
            method: "PUT",
            headers: {
                "Content-Type": file.type || "application/octet-stream",
                ...target.headers,
            },
            body: file,
        });
    } catch (cause) {
        throw new UploadError(
            "network",
            `The network failed while uploading "${file.name}". Please retry.`,
            { fileName: file.name, cause },
        );
    }

    if (!res.ok) {
        throw putErrorFromStatus(res.status, file.name);
    }

    return {
        storageKey: target.storageKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
    };
}

/**
 * Turn `File[]` into uploaded storage objects by requesting signed upload URLs
 * from the web broker route and PUTting bytes directly to Supabase Storage.
 *
 * File bytes never traverse a Next.js Server Action (R1). Uploads run through a
 * bounded concurrency pool; a single PUT failure does not abort the batch — the
 * result reports `uploaded` and `failures` separately so the caller can retry
 * only what failed (R6).
 */
export async function uploadFiles(
    params: IUploadFilesParams,
): Promise<IUploadFilesResult> {
    const { files, modality, onProgress } = params;

    // 1. Fail fast, before any network call.
    preValidate(files, modality);

    if (files.length === 0) {
        return { uploaded: [], failures: [] };
    }

    // 2. Sign the whole batch in one request.
    const targets = await requestSignedTargets(params);

    // 3. PUT each file with bounded concurrency; collect per-file outcomes.
    const uploaded: IUploadedObject[] = [];
    const failures: IUploadFailure[] = [];
    const total = files.length;
    let done = 0;
    let next = 0;

    const limit = Math.max(
        1,
        Math.min(params.concurrency ?? DEFAULT_CONCURRENCY, total),
    );

    async function worker(): Promise<void> {
        while (next < total) {
            const index = next;
            next += 1;
            const file = files[index];
            try {
                uploaded.push(await putFile(file, targets[index]));
            } catch (err) {
                const error =
                    err instanceof UploadError
                        ? err
                        : new UploadError(
                              "storage",
                              `Failed to upload "${file.name}".`,
                              { fileName: file.name, cause: err },
                          );
                failures.push({ fileName: file.name, error });
            } finally {
                done += 1;
                onProgress?.(done, total);
            }
        }
    }

    await Promise.all(Array.from({ length: limit }, () => worker()));

    return { uploaded, failures };
}
