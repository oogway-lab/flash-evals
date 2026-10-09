"use client";

import { Fragment, useActionState, useEffect, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { toast } from "sonner";
import { MAX_TEXT_IMPORT_BYTES } from "@mosaic/api-contract";
import { Button } from "@/components/ui/button";
import { ImportResultSummary } from "./import-result-summary";
import {
    uploadFormMedia,
    type IUploadField,
} from "@/lib/uploads/upload-form-media";
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
        if (uploadFields && uploadFields.length > 0) {
            const uploadError = await uploadFormMedia(
                formData,
                datasetId,
                uploadFields,
            );
            if (uploadError) {
                return {
                    formError: uploadError.message,
                    rejected: true,
                    importedCount: 0,
                    failures: [{ reason: uploadError.message }],
                    resetKey: Date.now(),
                };
            }
        }
        return action(prev, formData);
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

    const summaryRepeatsFormError =
        showSummary &&
        (state.failures ?? []).some(
            (failure) => failure.reason === state.formError,
        );

    return (
        <form action={formAction} className="flex flex-col gap-4">
            <input type="hidden" name="datasetId" value={datasetId} />
            {/* Clear the pickers once an import has gone through; a rejected
                import keeps the files so they can be fixed and resubmitted. */}
            <Fragment
                key={
                    state.importedCount !== undefined && !state.rejected
                        ? state.resetKey
                        : undefined
                }
            >
                {children}
            </Fragment>
            {/* A rejected import's reason is already in the summary below. */}
            {state.formError && !summaryRepeatsFormError && (
                <p role="alert" className="text-copy-14 text-error">
                    {state.formError}
                </p>
            )}
            <SubmitButton label={submitLabel} pendingLabel={pendingLabel} />
            {showSummary && (
                <ImportResultSummary
                    importedCount={state.importedCount}
                    failures={state.failures}
                />
            )}
        </form>
    );
}
