import path from "node:path";
import { ApiBadRequestError } from "./errors.js";

export function localMediaPath(storageKey: string): string {
    assertStorageKey(storageKey);
    return path.join(uploadDir(process.env.UPLOAD_DIR), storageKey);
}

export function assertStorageKey(storageKey: string): void {
    if (!isStorageKey(storageKey)) {
        throw new ApiBadRequestError("Invalid media storage key.");
    }
}

// Legacy per-item media keys: a bare UUID (`uploadMediaToSupabase` history).
const LEGACY_STORAGE_KEY = /^[a-f0-9-]{36}$/i;
// Dataset-scoped keys minted by the signed-upload endpoint (U1):
// `datasets/<datasetId>/<uuid><ext>`. Bounded + safe: must start with
// `datasets/`, no leading slash, no `..`, only `[A-Za-z0-9_-]` per path
// segment plus an optional file extension.
const DATASET_SCOPED_STORAGE_KEY =
    /^datasets\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}\/[A-Za-z0-9][A-Za-z0-9_-]{0,127}(\.[A-Za-z0-9]{1,16})?$/;

export function isStorageKey(storageKey: string): boolean {
    return (
        LEGACY_STORAGE_KEY.test(storageKey) ||
        DATASET_SCOPED_STORAGE_KEY.test(storageKey)
    );
}

function uploadDir(configured: string | undefined): string {
    const requested = configured?.trim() || ".uploads";
    return path.isAbsolute(requested)
        ? requested
        : path.resolve(workspaceRoot(), requested);
}

function workspaceRoot(): string {
    const cwd = process.cwd();
    const parts = cwd.split(path.sep);
    const appsIndex = parts.lastIndexOf("apps");
    if (appsIndex === parts.length - 2) {
        return parts.slice(0, appsIndex).join(path.sep);
    }
    return cwd;
}
