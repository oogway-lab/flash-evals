/**
 * Decides, at selection time, which picked files go into the next upload and
 * which are left out and why. Runs on every drop, browse and removal, so the
 * per-file, file-count and batch-size limits surface before anything is sent
 * instead of failing the whole batch on submit.
 */

export type ExclusionReason =
    | "unsupported-type"
    | "too-large"
    | "duplicate"
    | "too-many"
    | "over-batch-size";

export interface IUploadPlanLimits {
    /** Same syntax as `<input accept>`. */
    accept: string;
    /** Per-file size limit in bytes. */
    maxBytes?: number;
    /** Most files a single upload may hold. */
    maxFiles?: number;
    /** Combined size limit in bytes for a single upload. */
    maxTotalBytes?: number;
}

export interface IExcludedFile {
    file: File;
    reason: ExclusionReason;
}

export interface IUploadPlan {
    /** Files that will be uploaded, in the order they were picked. */
    included: File[];
    /** Files left out of this upload, in the order they were picked. */
    excluded: IExcludedFile[];
    includedBytes: number;
}

/** Whether `file` matches an `accept` list of extensions and MIME patterns. */
export function fileMatchesAccept(file: File, accept: string): boolean {
    const tokens = accept
        .split(",")
        .map((token) => token.trim().toLowerCase())
        .filter(Boolean);
    if (tokens.length === 0) return true;
    const name = file.name.toLowerCase();
    const type = file.type.toLowerCase();
    return tokens.some((token) => {
        if (token.startsWith(".")) return name.endsWith(token);
        if (token.endsWith("/*")) return type.startsWith(token.slice(0, -1));
        return type === token;
    });
}

/** Identifies a picked file across re-renders and FileList round-trips. */
export function fileKey(file: File): string {
    return `${file.name}\u0000${file.size}\u0000${file.lastModified}`;
}

/**
 * Splits `files` into what fits one upload and what does not. Per-file problems
 * (type, size, duplicate) are checked first; the remaining files are then taken
 * in picked order while they fit the count and batch-size limits, so a smaller
 * file later in the list still goes in when a larger one before it would not.
 */
export function planUpload(
    files: File[],
    { accept, maxBytes, maxFiles, maxTotalBytes }: IUploadPlanLimits,
): IUploadPlan {
    const included: File[] = [];
    const excluded: IExcludedFile[] = [];
    const seen = new Set<string>();
    let includedBytes = 0;

    for (const file of files) {
        const key = fileKey(file);
        let reason: ExclusionReason | undefined;
        if (!fileMatchesAccept(file, accept)) {
            reason = "unsupported-type";
        } else if (maxBytes !== undefined && file.size > maxBytes) {
            reason = "too-large";
        } else if (seen.has(key)) {
            reason = "duplicate";
        } else if (maxFiles !== undefined && included.length >= maxFiles) {
            reason = "too-many";
        } else if (
            maxTotalBytes !== undefined &&
            includedBytes + file.size > maxTotalBytes
        ) {
            reason = "over-batch-size";
        }
        seen.add(key);

        if (reason) {
            excluded.push({ file, reason });
        } else {
            included.push(file);
            includedBytes += file.size;
        }
    }

    return { included, excluded, includedBytes };
}
