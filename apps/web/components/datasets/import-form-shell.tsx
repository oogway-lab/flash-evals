"use client";

import {
    Fragment,
    useActionState,
    useEffect,
    useState,
    type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { MAX_TEXT_IMPORT_BYTES } from "@mosaic/api-contract";
import { Button } from "@/components/ui/button";
import { ImportResultSummary } from "./import-result-summary";
import { UploadProgressPanel } from "./upload-progress-panel";
import {
    uploadFormMedia,
    type IUploadField,
} from "@/lib/uploads/upload-form-media";
import {
    IDLE_UPLOAD_PROGRESS,
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
        const { error, fileFailures } = await uploadFormMedia(
            formData,
            datasetId,
            uploadFields,
            {
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
            },
        );
        const uploadFailures = fileFailures.map((failure) => ({
            fileName: failure.fileName,
            reason: `Upload failed: ${failure.reason}`,
        }));
        if (error) {
            setProgress((current) => ({ ...current, phase: "idle" }));
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
        setProgress((current) => ({
            ...current,
            phase: "idle",
            // Pickers drop what was imported and keep failed or left-out
            // files for the next run.
            completedRun: result.rejected
                ? current.completedRun
                : current.completedRun + 1,
        }));
        if (uploadFailures.length === 0) return result;
        return {
            ...result,
            failures: [...uploadFailures, ...(result.failures ?? [])],
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
