import { ALLOWED_AUDIO_TYPES, ALLOWED_IMAGE_TYPES } from "@mosaic/api-contract";
import type { IParsedSchemaDescriptor, LabelJson } from "../../db/jsonTypes";
import { formatLabelError, validateLabel } from "../schemaForm";
import { isRecord } from "../../lib/objects";
import { errorMessage } from "../../lib/errors";
import { importFailureReason } from "../errors";

export { isRecord, importFailureReason };
export { ALLOWED_AUDIO_TYPES, ALLOWED_IMAGE_TYPES };

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_IMPORT_FILE_COUNT = 100;
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024;
export const MAX_IMPORT_ROWS = 1_000;
export const MAX_JSONL_LINE_BYTES = 64 * 1024;
// Media batch caps now bound the direct-to-Supabase upload (signed-URL PUT), not a
// Server Action body — media bytes no longer flow through Server Actions, so these
// are free from the old sub-25MB coupling and reflect real Supabase/product
// ceilings. (MAX_TEXT_IMPORT_BYTES above still bounds the INLINE text/answer/CSV
// path, which does POST through a Server Action and so must stay under next.config
// serverActions.bodySizeLimit.)
export const MAX_IMAGE_IMPORT_BYTES = 24 * 1024 * 1024;
export const MAX_AUDIO_IMPORT_BYTES = 250 * 1024 * 1024;

export type ImportFormat = "csv" | "jsonl" | "images";

export interface IImportFailure {
    row?: number;
    fileName?: string;
    reason: string;
}

export interface IImportSummary {
    importedCount: number;
    failures: IImportFailure[];
    rejected?: boolean;
}

export interface IImageImportFile {
    name: string;
    type: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface IAudioImportFile {
    name: string;
    type: string;
    size: number;
    arrayBuffer: () => Promise<ArrayBuffer>;
}

export interface IMediaImportPartition {
    summary: IImportSummary;
    uniqueValidNames: string[];
    duplicateNames: Set<string>;
}

export const RESERVED_LABEL_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);

export function formatBytes(bytes: number): string {
    return `${Math.round(bytes / (1024 * 1024))}MB`;
}

export function imageFileFailure(file: IImageImportFile): string | undefined {
    // A blank/whitespace-only name normalizes to NULL source_name, which silently
    // opts the item out of duplicate detection. Reject it so dedup is reliable.
    if (file.name.trim() === "") {
        return "Image filename is required.";
    }
    if (file.size > MAX_IMAGE_BYTES) {
        return `Image exceeds the ${formatBytes(MAX_IMAGE_BYTES)} per-file limit.`;
    }
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        return `Unsupported image type: ${file.type || "unknown"}.`;
    }
    return undefined;
}

export function audioFileFailure(file: IAudioImportFile): string | undefined {
    if (file.name.trim() === "") {
        return "Audio filename is required.";
    }
    if (file.size > MAX_AUDIO_BYTES) {
        return `Audio exceeds the ${formatBytes(MAX_AUDIO_BYTES)} per-file limit.`;
    }
    if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
        return `Unsupported audio type: ${file.type || "unknown"}.`;
    }
    return undefined;
}

export function partitionMediaImportFiles<
    TFile extends { name: string; size: number },
>(
    files: TFile[],
    options: {
        mediaLabel: "Audio" | "Image";
        maxTotalBytes: number;
        fileFailure: (file: TFile) => string | undefined;
    },
): IMediaImportPartition {
    const empty = { uniqueValidNames: [], duplicateNames: new Set<string>() };
    if (files.length > MAX_IMPORT_FILE_COUNT) {
        return {
            summary: {
                importedCount: 0,
                rejected: true,
                failures: [
                    {
                        reason: `${options.mediaLabel} import is limited to ${MAX_IMPORT_FILE_COUNT} files.`,
                    },
                ],
            },
            ...empty,
        };
    }

    const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > options.maxTotalBytes) {
        return {
            summary: {
                importedCount: 0,
                rejected: true,
                failures: [
                    {
                        reason: `${options.mediaLabel} import exceeds the ${formatBytes(options.maxTotalBytes)} payload limit.`,
                    },
                ],
            },
            ...empty,
        };
    }

    const validCounts = new Map<string, number>();
    for (const file of files) {
        if (options.fileFailure(file)) continue;
        validCounts.set(file.name, (validCounts.get(file.name) ?? 0) + 1);
    }

    const failures: IImportFailure[] = [];
    const duplicateNames = new Set<string>();
    const uniqueValidNames: string[] = [];
    const seenValidNames = new Set<string>();

    for (const file of files) {
        const reason = options.fileFailure(file);
        if (reason) {
            failures.push({ fileName: file.name, reason });
            continue;
        }
        if (seenValidNames.has(file.name)) {
            failures.push({
                fileName: file.name,
                reason: "Duplicate filename in upload.",
            });
            duplicateNames.add(file.name);
            continue;
        }
        seenValidNames.add(file.name);
        if ((validCounts.get(file.name) ?? 0) > 1) {
            duplicateNames.add(file.name);
        } else {
            uniqueValidNames.push(file.name);
        }
    }

    return {
        summary: {
            importedCount: files.length - failures.length,
            failures,
        },
        uniqueValidNames,
        duplicateNames,
    };
}

export function validateImportLabel(
    label: LabelJson,
    schema: IParsedSchemaDescriptor,
): string[] {
    return validateLabel(label, schema).map(formatLabelError);
}

export function rejectImport<
    T extends { failures: IImportFailure[]; rejected?: boolean },
>(reason: string, empty: Omit<T, "failures" | "rejected">): T {
    return {
        ...empty,
        failures: [{ reason }],
        rejected: true,
    } as T;
}

export function parseJsonlLines<TRow>(
    content: string,
    normalize: (
        parsed: unknown,
    ) => { ok: true; row: TRow } | { ok: false; reason: string },
): {
    rows: Array<{ rowNumber: number; row: TRow }>;
    failures: IImportFailure[];
    rejected?: boolean;
} {
    const numbered = content
        .split(/\r?\n/)
        .map((line, index) => ({ line, lineNo: index + 1 }))
        .filter((entry) => entry.line.trim().length > 0);

    if (numbered.length > MAX_IMPORT_ROWS) {
        return {
            rows: [],
            failures: [
                { reason: `Import is limited to ${MAX_IMPORT_ROWS} rows.` },
            ],
            rejected: true,
        };
    }

    const rows: Array<{ rowNumber: number; row: TRow }> = [];
    const failures: IImportFailure[] = [];

    numbered.forEach(({ line, lineNo }) => {
        if (Buffer.byteLength(line, "utf8") > MAX_JSONL_LINE_BYTES) {
            failures.push({
                row: lineNo,
                reason: `Line exceeds the ${formatBytes(MAX_JSONL_LINE_BYTES)} JSONL line limit.`,
            });
            return;
        }

        try {
            const parsed = JSON.parse(line) as unknown;
            const normalized = normalize(parsed);
            if (!normalized.ok) {
                failures.push({ row: lineNo, reason: normalized.reason });
                return;
            }
            rows.push({ rowNumber: lineNo, row: normalized.row });
        } catch (err) {
            failures.push({
                row: lineNo,
                reason: errorMessage(err),
            });
        }
    });

    return { rows, failures };
}
