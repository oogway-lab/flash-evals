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
    /** Storage's HTTP status, when storage rejected the PUT. */
    readonly status?: number;

    constructor(
        kind: UploadErrorKind,
        message: string,
        options?: { fileName?: string; cause?: unknown; status?: number },
    ) {
        super(message);
        this.name = "UploadError";
        this.kind = kind;
        this.fileName = options?.fileName;
        this.status = options?.status;
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

/** One file's progress; `index` is its position in `files`. */
export interface IFileProgressEvent {
    index: number;
    status: "uploading" | "done" | "failed";
    loaded: number;
    total: number;
    error?: UploadError;
}

export interface IUploadFilesParams {
    datasetId: string;
    modality: UploadModality;
    files: File[];
    onProgress?: (done: number, total: number) => void;
    /** Called once the batch is signed, before any bytes are sent. */
    onSigned?: () => void;
    /**
     * Per-file progress. When set, files are sent with XMLHttpRequest so bytes
     * sent can be reported; otherwise they are sent with `fetch`.
     */
    onFileProgress?: (event: IFileProgressEvent) => void;
    concurrency?: number;
    /** Base wait before retrying a failed PUT; doubles per attempt. */
    retryDelayMs?: number;
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
/** PUT attempts per file against the same signed URL. */
const MAX_PUT_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 500;

/**
 * Failures a retry can fix: the network dropped, or storage was busy or
 * erroring (408, 429, 5xx). Other rejections, such as 412 on a key that
 * already holds bytes, are final so a retry can never overwrite an upload.
 */
function isTransient(error: UploadError): boolean {
    if (error.kind === "network") return true;
    const status = error.status;
    return (
        error.kind === "storage" &&
        status !== undefined &&
        (status >= 500 || status === 408 || status === 429)
    );
}

const wait = (ms: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, ms));
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
        { fileName, status },
    );
}

function uploadedObject(
    file: File,
    target: ISignedUploadTarget,
): IUploadedObject {
    return {
        storageKey: target.storageKey,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        byteSize: file.size,
    };
}

/** PUT with XMLHttpRequest, the only browser API that reports bytes sent. */
function putFileWithProgress(
    file: File,
    target: ISignedUploadTarget,
    onBytes: (loaded: number) => void,
): Promise<IUploadedObject> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", target.signedUrl);
        xhr.setRequestHeader(
            "Content-Type",
            file.type || "application/octet-stream",
        );
        for (const [header, value] of Object.entries(target.headers ?? {})) {
            xhr.setRequestHeader(header, value);
        }
        xhr.upload.onprogress = (event) => onBytes(event.loaded);
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(uploadedObject(file, target));
            } else {
                reject(putErrorFromStatus(xhr.status, file.name));
            }
        };
        xhr.onerror = () =>
            reject(
                new UploadError(
                    "network",
                    `The network failed while uploading "${file.name}". Please retry.`,
                    { fileName: file.name },
                ),
            );
        xhr.send(file);
    });
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

    return uploadedObject(file, target);
}

/**
 * Turn `File[]` into uploaded storage objects by requesting signed upload URLs
 * from the web broker route and PUTting bytes directly to Supabase Storage.
 *
 * File bytes never traverse a Next.js Server Action (R1). Uploads run through a
 * bounded concurrency pool and each file heals on its own: transient PUT
 * failures retry with backoff, and files that still fail (or whose URL expired)
 * are re-signed and tried once more. A file that cannot be uploaded never
 * aborts the batch — the result reports `uploaded` and `failures` separately so
 * the caller can import what made it and retry only what failed (R6).
 */
export async function uploadFiles(
    params: IUploadFilesParams,
): Promise<IUploadFilesResult> {
    const { files, modality, onProgress, onFileProgress } = params;

    // 1. Fail fast, before any network call.
    preValidate(files, modality);

    if (files.length === 0) {
        return { uploaded: [], failures: [] };
    }

    // 2. Sign the whole batch in one request.
    const targets = await requestSignedTargets(params);
    params.onSigned?.();
    const withProgress =
        onFileProgress !== undefined && typeof XMLHttpRequest !== "undefined";

    // 3. PUT each file with bounded concurrency. Each file heals on its own:
    // transient failures retry against the same URL, and one failed file
    // never stops the others.
    const total = files.length;
    const retryDelayMs = params.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    const outcomes: Array<IUploadedObject | UploadError> = new Array(total);
    let done = 0;

    const report = (
        index: number,
        status: IFileProgressEvent["status"],
        loaded: number,
        error?: UploadError,
    ) =>
        onFileProgress?.({
            index,
            status,
            loaded,
            total: files[index].size,
            error,
        });

    async function putOnce(
        index: number,
        target: ISignedUploadTarget,
    ): Promise<IUploadedObject> {
        const file = files[index];
        report(index, "uploading", 0);
        try {
            return withProgress
                ? await putFileWithProgress(file, target, (loaded) =>
                      report(index, "uploading", loaded),
                  )
                : await putFile(file, target);
        } catch (err) {
            throw err instanceof UploadError
                ? err
                : new UploadError(
                      "storage",
                      `Failed to upload "${file.name}".`,
                      { fileName: file.name, cause: err },
                  );
        }
    }

    async function putWithRetries(
        index: number,
        target: ISignedUploadTarget,
    ): Promise<IUploadedObject | UploadError> {
        let lastError: UploadError | undefined;
        for (let attempt = 1; attempt <= MAX_PUT_ATTEMPTS; attempt += 1) {
            try {
                return await putOnce(index, target);
            } catch (err) {
                lastError = err as UploadError;
                if (!isTransient(lastError) || attempt === MAX_PUT_ATTEMPTS) {
                    break;
                }
                await wait(retryDelayMs * 2 ** (attempt - 1));
            }
        }
        return lastError as UploadError;
    }

    async function runPool(
        indexes: number[],
        targetFor: (index: number) => ISignedUploadTarget,
        settle: (index: number, outcome: IUploadedObject | UploadError) => void,
    ): Promise<void> {
        let next = 0;
        const limit = Math.max(
            1,
            Math.min(params.concurrency ?? DEFAULT_CONCURRENCY, indexes.length),
        );
        async function worker(): Promise<void> {
            while (next < indexes.length) {
                const index = indexes[next];
                next += 1;
                settle(index, await putWithRetries(index, targetFor(index)));
            }
        }
        await Promise.all(Array.from({ length: limit }, () => worker()));
    }

    function settleFinal(
        index: number,
        outcome: IUploadedObject | UploadError,
    ): void {
        outcomes[index] = outcome;
        if (outcome instanceof UploadError) {
            report(index, "failed", 0, outcome);
        } else {
            report(index, "done", files[index].size);
        }
        done += 1;
        onProgress?.(done, total);
    }

    const allIndexes = files.map((_, index) => index);
    const firstPass: Array<IUploadedObject | UploadError> = new Array(total);
    await runPool(
        allIndexes,
        (index) => targets[index],
        (index, outcome) => {
            if (
                outcome instanceof UploadError &&
                (outcome.kind === "expired" || isTransient(outcome))
            ) {
                // Held back for the re-sign pass below.
                firstPass[index] = outcome;
                return;
            }
            settleFinal(index, outcome);
        },
    );

    // 4. Heal: files whose URL expired or that kept failing get fresh URLs
    // and one more round. If re-signing fails, the original errors stand.
    const retryIndexes = allIndexes.filter((index) => firstPass[index]);
    if (retryIndexes.length > 0) {
        let fresh: ISignedUploadTarget[] | undefined;
        try {
            fresh = await requestSignedTargets({
                ...params,
                files: retryIndexes.map((index) => files[index]),
            });
        } catch {
            fresh = undefined;
        }
        if (fresh) {
            const retargeted = new Map(
                retryIndexes.map((index, i) => [index, fresh[i]]),
            );
            await runPool(
                retryIndexes,
                (index) => retargeted.get(index) as ISignedUploadTarget,
                settleFinal,
            );
        } else {
            retryIndexes.forEach((index) =>
                settleFinal(index, firstPass[index]),
            );
        }
    }

    const uploaded: IUploadedObject[] = [];
    const failures: IUploadFailure[] = [];
    outcomes.forEach((outcome, index) => {
        if (outcome instanceof UploadError) {
            failures.push({ fileName: files[index].name, error: outcome });
        } else {
            uploaded.push(outcome);
        }
    });

    return { uploaded, failures };
}
