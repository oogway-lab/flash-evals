"use client";

import {
    Fragment,
    useActionState,
    useCallback,
    useEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { MAX_TEXT_IMPORT_BYTES } from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
import { ImportResultSummary } from "./import-result-summary";
import { UploadProgressPanel } from "./upload-progress-panel";
import {
    uploadFormMedia,
    type IUploadField,
} from "@/lib/uploads/upload-form-media";
import {
    IDLE_UPLOAD_PROGRESS,
    LeftOutFilesContext,
    UploadProgressContext,
    uploadProgressKey,
    type IFileUploadState,
    type IUploadProgress,
} from "@/lib/uploads/upload-progress";
import type { IActionState } from "@/app/actions";

const MAX_TEXT_IMPORT_MB = Math.round(MAX_TEXT_IMPORT_BYTES / (1024 * 1024));

/**
 * An INLINE text/answer/CSV file input whose bytes POST through the Server Action
 * (not the direct-to-Supabase media path). `field` is the input `name`; `label`
 * names the file in the friendly oversize message.
 */
export interface ITextSizeGuard {
    field: string;
    label: string;
}

/**
 * Returns a friendly message for the first oversize inline text/answer/CSV file,
 * or `undefined` when every guarded field is within MAX_TEXT_IMPORT_BYTES.
 */
export function textSizeGuardMessage(
    formData: FormData,
    guards: ITextSizeGuard[] | undefined,
): string | undefined {
    if (!guards || guards.length === 0) return undefined;
    for (const guard of guards) {
        const value = formData.get(guard.field);
        if (value instanceof File && value.size > MAX_TEXT_IMPORT_BYTES) {
            return `${guard.label} exceeds the ${MAX_TEXT_IMPORT_MB}MB limit. Reduce it and try again.`;
        }
    }
    return undefined;
}

function SubmitButton({
    label,
    pendingLabel,
}: {
    label: string;
    pendingLabel: string;
}) {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            loading={pending}
            loadingText={pendingLabel}
            className="self-start"
        >
            {label}
        </Button>
    );
}

/** Progress with the "done" file states removed; failed ones are kept. */
function withoutDoneFiles(progress: IUploadProgress): IUploadProgress {
    const entries = Object.entries(progress.files);
    if (!entries.some(([, file]) => file.status === "done")) return progress;
    return {
        ...progress,
        files: Object.fromEntries(
            entries.filter(([, file]) => file.status !== "done"),
        ),
    };
}

/**
 * A file not sent this run can only fail on the server for having no match in
 * the answers file or CSV. Drops those failures: a failed upload is already
 * listed, a left-out file waits for the next run, and a file an earlier run
 * imported is done.
 */
function withoutUnsentFailures(
    failures: IActionState["failures"] = [],
    unsent: string[],
    sent: string[],
): NonNullable<IActionState["failures"]> {
    const notSent = new Set(unsent);
    sent.forEach((name) => notSent.delete(name));
    return failures.filter(
        (failure) => !(failure.fileName && notSent.has(failure.fileName)),
    );
}

/** The media files each upload field's picker left out of this run. */
function leftOutFileNames(
    leftOut: Map<string, string[]>,
    uploadFields: IUploadField[],
): string[] {
    return uploadFields.flatMap((spec) => leftOut.get(spec.field) ?? []);
}

/**
 * Remembers the files a completed run imported while a retry still needs its
 * answers file or CSV. A run that leaves nothing behind ends that chain.
 */
function rememberImported(
    imported: Set<string>,
    uploadedFileNames: string[],
    retryPending: boolean,
): void {
    if (!retryPending) {
        imported.clear();
        return;
    }
    uploadedFileNames.forEach((name) => imported.add(name));
}

export function ImportFormShell({
    datasetId,
    action,
    submitLabel,
    pendingLabel = "Importing…",
    resultNoun = "imported",
    showSummary = true,
    uploadFields,
    textSizeGuards,
    children,
}: {
    datasetId: string;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
    submitLabel: string;
    pendingLabel?: string;
    resultNoun?: string;
    showSummary?: boolean;
    /**
     * Media fields whose File bytes upload directly to storage before the action
     * runs; the bytes are replaced with `storageKey` metadata (R1). Omit for
     * text/CSV imports that keep sending file content through the action.
     */
    uploadFields?: IUploadField[];
    /**
     * INLINE text/answer/CSV inputs whose bytes still POST through the Server
     * Action. Client-side guard: reject before submit if a selected file exceeds
     * MAX_TEXT_IMPORT_BYTES, so an oversize file surfaces a friendly message
     * instead of hitting the next.config body limit (R6).
     */
    textSizeGuards?: ITextSizeGuard[];
    children: ReactNode;
}) {
    const [progress, setProgress] =
        useState<IUploadProgress>(IDLE_UPLOAD_PROGRESS);
    const setFile = (key: string, next: IFileUploadState) =>
        setProgress((current) => ({
            ...current,
            files: { ...current.files, [key]: next },
        }));

    // The files each picker left out of the upload, by field name.
    const leftOutRef = useRef(new Map<string, string[]>());
    const reportLeftOut = useCallback((field: string, fileNames: string[]) => {
        leftOutRef.current.set(field, fileNames);
    }, []);
    // Names imported by earlier runs while their answers file or CSV stays
    // selected for a retry.
    const importedRef = useRef(new Set<string>());

    // Once the pickers have pruned the files a completed run imported (child
    // effects run before this one), forget their "done" state: a file picked
    // again must show as a normal, removable row, not as "Uploaded".
    useEffect(() => {
        setProgress((current) => withoutDoneFiles(current));
    }, [progress.completedRun]);

    async function runAction(
        prev: IActionState,
        formData: FormData,
    ): Promise<IActionState> {
        const textSizeError = textSizeGuardMessage(formData, textSizeGuards);
        if (textSizeError) {
            return {
                formError: textSizeError,
                rejected: true,
                importedCount: 0,
                failures: [{ reason: textSizeError }],
                resetKey: Date.now(),
            };
        }
        if (!uploadFields || uploadFields.length === 0) {
            return action(prev, formData);
        }

        setProgress((current) => ({
            ...current,
            phase: "preparing",
            files: {},
        }));
        const { error, fileFailures, uploadedFileNames } =
            await uploadFormMedia(formData, datasetId, uploadFields, {
                onQueued: (field, files) =>
                    setProgress((current) => ({
                        ...current,
                        files: {
                            ...current.files,
                            ...Object.fromEntries(
                                files.map((file) => [
                                    uploadProgressKey(field, file),
                                    {
                                        status: "queued",
                                        loaded: 0,
                                        total: file.size,
                                    } satisfies IFileUploadState,
                                ]),
                            ),
                        },
                    })),
                onPhase: (phase) =>
                    setProgress((current) => ({ ...current, phase })),
                onFileProgress: (field, file, event) =>
                    setFile(uploadProgressKey(field, file), {
                        status: event.status,
                        loaded: event.loaded,
                        total: event.total,
                        error: event.error?.message,
                    }),
            });
        const uploadFailures = fileFailures.map((failure) => ({
            fileName: failure.fileName,
            reason: `Upload failed: ${failure.reason}`,
        }));
        if (error) {
            // Nothing was imported: files that did upload stay selected, so
            // drop their "done" state to leave them removable.
            setProgress((current) => ({
                ...withoutDoneFiles(current),
                phase: "idle",
            }));
            return {
                formError: error.message,
                rejected: true,
                importedCount: 0,
                failures: uploadFailures.length
                    ? uploadFailures
                    : [{ reason: error.message }],
                resetKey: Date.now(),
            };
        }

        setProgress((current) => ({ ...current, phase: "importing" }));
        const result = await action(prev, formData);
        const completed = !result.rejected && (result.importedCount ?? 0) > 0;
        const leftOut = leftOutFileNames(leftOutRef.current, uploadFields);
        const retryPending = fileFailures.length > 0 || leftOut.length > 0;
        const serverFailures = withoutUnsentFailures(
            result.failures,
            [
                ...importedRef.current,
                ...leftOut,
                ...fileFailures.map((failure) => failure.fileName),
            ],
            uploadedFileNames,
        );
        if (completed) {
            rememberImported(
                importedRef.current,
                uploadedFileNames,
                retryPending,
            );
        }
        setProgress((current) =>
            completed
                ? {
                      ...current,
                      phase: "idle",
                      // Pickers drop what was imported and keep failed or
                      // left-out files for the next run.
                      completedRun: current.completedRun + 1,
                      retryPending,
                  }
                : // Nothing was imported: every file stays selected, and
                  // none of them should read as "Uploaded".
                  { ...withoutDoneFiles(current), phase: "idle" },
        );
        return {
            ...result,
            failures: [...uploadFailures, ...serverFailures],
        };
    }

    const [state, formAction] = useActionState(runAction, {} as IActionState);

    // Report each outcome once: a full success toasts; row/file failures live
    // in the summary (or, when there is no summary, one toast with the reason);
    // form-level errors stay inline below.
    useEffect(() => {
        if (state.importedCount === undefined || !state.resetKey) return;
        if (state.rejected || state.formError) return;
        const failures = state.failures ?? [];
        if (failures.length === 0) {
            toast.success(`${state.importedCount} ${resultNoun}.`);
        } else if (!showSummary) {
            const reason = failures[0].reason;
            toast.error(
                failures.length === 1
                    ? reason
                    : `${failures.length} failed. ${reason}`,
            );
        }
    }, [
        state.failures,
        state.formError,
        state.importedCount,
        state.rejected,
        state.resetKey,
        resultNoun,
        showSummary,
    ]);

    // A rejected import with listed failures already explains itself in the
    // summary card.
    const summaryRepeatsFormError =
        showSummary &&
        ((state.rejected && (state.failures ?? []).length > 0) ||
            (state.failures ?? []).some(
                (failure) => failure.reason === state.formError,
            ));

    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="datasetId" value={datasetId} />
            {/* Clear the pickers once an import has gone through; a rejected
                import keeps the files so they can be fixed and resubmitted.
                Media pickers clear themselves instead, keeping files that
                failed or were left out so they can go in the next run. */}
            <UploadProgressContext.Provider
                value={uploadFields?.length ? progress : null}
            >
                <LeftOutFilesContext.Provider value={reportLeftOut}>
                    <Fragment
                        key={
                            !uploadFields?.length &&
                            state.importedCount !== undefined &&
                            !state.rejected
                                ? state.resetKey
                                : undefined
                        }
                    >
                        {children}
                    </Fragment>
                </LeftOutFilesContext.Provider>
            </UploadProgressContext.Provider>
            {/* A rejected import's reason is already in the summary below. */}
            {state.formError && !summaryRepeatsFormError && (
                <p role="alert" className="text-copy-14 text-error">
                    {state.formError}
                </p>
            )}
            <UploadProgressPanel progress={progress} />
            <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
            {showSummary && (
                <ImportResultSummary
                    importedCount={state.importedCount}
                    failures={state.failures}
                    rejected={state.rejected}
                />
            )}
        </form>
    );
}
