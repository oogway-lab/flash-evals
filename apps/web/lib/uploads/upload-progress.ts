"use client";

import { createContext, useContext } from "react";
import { fileKey } from "./upload-plan";

export type FileUploadStatus = "queued" | "uploading" | "done" | "failed";

export interface IFileUploadState {
    status: FileUploadStatus;
    /** Bytes sent so far. */
    loaded: number;
    total: number;
    /** Why the upload failed, when `status` is `failed`. */
    error?: string;
}

/**
 * Where a submit is: `preparing` while upload URLs are signed, `uploading`
 * while bytes go to storage, `importing` while the server adds the items.
 */
export type UploadPhase = "idle" | "preparing" | "uploading" | "importing";

export interface IUploadProgress {
    phase: UploadPhase;
    /** Per-file state, keyed by `uploadProgressKey`. */
    files: Record<string, IFileUploadState>;
    /**
     * Bumped each time an import goes through. File pickers then drop the
     * files that made it and keep the rest (failed or left out) for a retry.
     */
    completedRun: number;
}

export const IDLE_UPLOAD_PROGRESS: IUploadProgress = {
    phase: "idle",
    files: {},
    completedRun: 0,
};

/** Keys a file's progress by the form field it was picked in. */
export function uploadProgressKey(field: string, file: File): string {
    return `${field}\u0000${fileKey(file)}`;
}

/** Live upload progress for the enclosing import form, if it reports any. */
export const UploadProgressContext = createContext<IUploadProgress | null>(
    null,
);

export function useUploadProgress(): IUploadProgress | null {
    return useContext(UploadProgressContext);
}
