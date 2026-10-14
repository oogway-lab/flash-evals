"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { CircleAlert, CircleCheck, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFieldErrorId } from "@/components/ui/field-error-context";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/cn";
import { plural } from "@/lib/format";
import {
    planUpload,
    type ExclusionReason,
    type IExcludedFile,
} from "@/lib/uploads/upload-plan";
import {
    uploadProgressKey,
    useUploadProgress,
    type IFileUploadState,
} from "@/lib/uploads/upload-progress";

export interface IFileDropzoneProps {
    /** Form field name; omit to handle files only through `onFilesChange`. */
    name?: string;
    id?: string;
    /** Same syntax as `<input accept>`; also enforced on drop. */
    accept: string;
    multiple?: boolean;
    /** Per-file size limit, enforced on drop and selection. */
    maxBytes?: number;
    /** Most files one upload may hold; extra files are left out of it. */
    maxFiles?: number;
    /** Combined size limit for one upload; files past it are left out of it. */
    maxTotalBytes?: number;
    required?: boolean;
    disabled?: boolean;
    title: string;
    hint: string;
    /** `sm` for a compact field-sized target inside forms. */
    size?: "default" | "sm";
    /** Called with the files that will be submitted. */
    onFilesChange?: (files: File[]) => void;
    "aria-describedby"?: string;
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Reasons in the order they are listed, with what to do about each.
const EXCLUSION_ORDER: ExclusionReason[] = [
    "too-large",
    "unsupported-type",
    "over-batch-size",
    "too-many",
    "duplicate",
];

function exclusionCopy(
    reason: ExclusionReason,
    limits: { maxBytes?: number; maxFiles?: number; maxTotalBytes?: number },
    multiple: boolean,
): { title: string; action: string } {
    switch (reason) {
        case "too-large":
            return {
                title: `Larger than the ${formatFileSize(limits.maxBytes ?? 0)} per-file limit`,
                action: "Trim or compress these files below the limit, then add them again.",
            };
        case "unsupported-type":
            return {
                title: "Unsupported file type",
                action: "Convert these to one of the supported formats listed above.",
            };
        case "over-batch-size":
            return {
                title: `Over the ${formatFileSize(limits.maxTotalBytes ?? 0)} limit for one upload`,
                action: "Upload these in a second run after this one finishes.",
            };
        case "too-many":
            return multiple
                ? {
                      title: `Over the ${limits.maxFiles ?? 0}-file limit for one upload`,
                      action: "Upload these in a second run after this one finishes.",
                  }
                : {
                      title: "Only one file can be added here",
                      action: "Remove the file above to use one of these instead.",
                  };
        case "duplicate":
            return {
                title: "Already added",
                action: "The first copy is kept; these are ignored.",
            };
    }
}

/**
 * File picker with drag and drop. Every file picked is checked against
 * `accept`, `maxBytes`, `maxFiles` and `maxTotalBytes` as it arrives: files
 * that fit are listed for upload, the rest are listed separately with the
 * reason they are left out. Only the files that fit are kept in the underlying
 * `<input type="file">` for form submission. Inside an import form that
 * reports upload progress, each listed file shows its own progress.
 */
export function FileDropzone({
    name,
    id,
    accept,
    multiple = false,
    maxBytes,
    maxFiles,
    maxTotalBytes,
    required,
    disabled: disabledProp = false,
    title,
    hint,
    size = "default",
    onFilesChange,
    "aria-describedby": describedBy,
}: IFileDropzoneProps) {
    const generatedId = React.useId();
    const inputId = id ?? name ?? generatedId;
    const excludedId = `${inputId}-excluded`;
    const inputRef = React.useRef<HTMLInputElement>(null);
    // Everything picked, including files left out of the upload.
    const [picked, setPicked] = React.useState<File[]>([]);
    const [missing, setMissing] = React.useState(false);
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const missingId = `${inputId}-missing`;
    // Counts enter/leave pairs so crossing child elements doesn't flicker.
    const [dragDepth, setDragDepth] = React.useState(0);
    const { pending } = useFormStatus();
    const fieldErrorId = useFieldErrorId(name);
    const disabled = disabledProp || pending;

    const limits = React.useMemo(
        () => ({
            accept,
            maxBytes,
            maxFiles: multiple ? maxFiles : 1,
            maxTotalBytes,
        }),
        [accept, maxBytes, maxFiles, maxTotalBytes, multiple],
    );
    const plan = React.useMemo(
        () => planUpload(picked, limits),
        [picked, limits],
    );
    const files = plan.included;

    const filesRef = React.useRef(files);
    React.useEffect(() => {
        filesRef.current = files;
    }, [files]);
    const onFilesChangeRef = React.useRef(onFilesChange);
    React.useEffect(() => {
        onFilesChangeRef.current = onFilesChange;
    });

    const update = React.useCallback(
        (next: File[]) => {
            setPicked(next);
            const included = planUpload(next, limits).included;
            const input = inputRef.current;
            // DataTransfer is the only way to set `input.files`; skip where the
            // environment lacks it (jsdom), since the input already holds them.
            if (input && typeof DataTransfer !== "undefined") {
                const transfer = new DataTransfer();
                included.forEach((file) => transfer.items.add(file));
                input.files = transfer.files;
            }
            // Keep the reset handler below in step before the next render.
            filesRef.current = included;
            onFilesChangeRef.current?.(included);
        },
        [limits],
    );

    function receive(list: FileList | null) {
        const incoming = Array.from(list ?? []);
        if (incoming.length === 0) return;
        setMissing(false);
        update(multiple ? [...picked, ...incoming] : incoming);
    }

    function remove(file: File) {
        update(picked.filter((candidate) => candidate !== file));
    }

    // React 19 resets a form after every action, failed ones included, which
    // empties this file input. Put the selection back so a failed save keeps
    // the user's files. Forms that should clear on success remount this
    // component (e.g. via a key); media import forms prune it instead (see
    // `usePruneAfterImport`).
    React.useEffect(() => {
        const input = inputRef.current;
        const form = input?.form;
        if (!input || !form) return;
        const onReset = () => {
            // The reset event fires before the fields are cleared.
            setTimeout(() => {
                if (typeof DataTransfer === "undefined") return;
                const transfer = new DataTransfer();
                filesRef.current.forEach((file) => transfer.items.add(file));
                input.files = transfer.files;
            }, 0);
        };
        form.addEventListener("reset", onReset);
        return () => form.removeEventListener("reset", onReset);
    }, []);

    const fileState = useFileUploadState(name);
    usePruneAfterImport(name, picked, update);

    const dragging = dragDepth > 0 && !disabled;
    const excluded = plan.excluded;
    return (
        <div className="flex flex-col gap-2">
            <input
                ref={inputRef}
                id={`${inputId}-file`}
                name={name}
                type="file"
                accept={accept}
                multiple={multiple}
                required={required && files.length === 0}
                disabled={disabled}
                tabIndex={-1}
                aria-hidden="true"
                className="sr-only"
                onChange={(event) => receive(event.target.files)}
                // Native validation would focus this hidden input; point the
                // user at the visible control with an inline message instead.
                onInvalid={(event) => {
                    event.preventDefault();
                    setMissing(true);
                    buttonRef.current?.focus();
                }}
            />
            {/* The visible control carries the id, so a <Label htmlFor> names it. */}
            <button
                ref={buttonRef}
                id={inputId}
                type="button"
                disabled={disabled}
                aria-invalid={missing || Boolean(fieldErrorId) || undefined}
                aria-describedby={
                    [
                        describedBy,
                        fieldErrorId,
                        excluded.length ? excludedId : undefined,
                        missing ? missingId : undefined,
                    ]
                        .filter(Boolean)
                        .join(" ") || undefined
                }
                onClick={() => inputRef.current?.click()}
                onDragEnter={(event) => {
                    if (disabled) return;
                    event.preventDefault();
                    setDragDepth((depth) => depth + 1);
                }}
                onDragOver={(event) => {
                    if (disabled) return;
                    event.preventDefault();
                }}
                onDragLeave={() =>
                    setDragDepth((depth) => Math.max(0, depth - 1))
                }
                onDrop={(event) => {
                    event.preventDefault();
                    setDragDepth(0);
                    if (disabled) return;
                    receive(event.dataTransfer.files);
                }}
                className={cn(
                    "flex w-full flex-col items-center justify-center gap-1 rounded-sm border-2 border-dashed text-copy-14 transition-colors",
                    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    size === "sm" ? "px-3 py-4" : "px-4 py-8",
                    disabled
                        ? "cursor-not-allowed border-border opacity-50"
                        : dragging
                          ? "border-primary bg-muted"
                          : "border-border hover:border-on-surface/30 hover:bg-muted",
                )}
            >
                <Upload
                    aria-hidden="true"
                    className={cn(
                        "text-muted-foreground",
                        size === "sm" ? "size-5" : "size-6",
                    )}
                />
                <span className="text-label-14 text-on-surface">{title}</span>
                <span className="text-copy-14 text-muted-foreground">
                    {hint}
                </span>
            </button>
            {missing && (
                <p
                    id={missingId}
                    role="alert"
                    className="text-copy-14 text-error"
                >
                    Choose a file to continue.
                </p>
            )}
            {multiple && picked.length > 0 && (
                <SelectionSummary
                    count={files.length}
                    bytes={plan.includedBytes}
                    maxTotalBytes={maxTotalBytes}
                    excludedCount={excluded.length}
                    disabled={disabled}
                    onClearAll={() => update([])}
                />
            )}
            {files.length > 0 && (
                <ul
                    aria-label="Selected files"
                    className={cn(
                        "flex flex-col gap-1",
                        // A long selection scrolls inside the form instead of
                        // pushing the submit button off the page.
                        multiple && "max-h-80 overflow-y-auto pr-1",
                    )}
                >
                    {files.map((file, index) => (
                        <FileRow
                            key={`${file.name}-${index}`}
                            file={file}
                            state={fileState(file)}
                            disabled={disabled}
                            onRemove={() => remove(file)}
                        />
                    ))}
                </ul>
            )}
            {excluded.length > 0 && (
                <ExcludedFiles
                    id={excludedId}
                    excluded={excluded}
                    limits={limits}
                    multiple={multiple}
                    disabled={disabled}
                    onRemove={remove}
                    onRemoveAll={() =>
                        update(picked.filter((file) => files.includes(file)))
                    }
                />
            )}
        </div>
    );
}

/** Reads a picked file's upload progress from the enclosing import form. */
function useFileUploadState(name: string | undefined) {
    const progress = useUploadProgress();
    return (file: File): IFileUploadState | undefined =>
        name && progress
            ? progress.files[uploadProgressKey(name, file)]
            : undefined;
}

/**
 * After an import goes through, drops the files it took. A picker whose files
 * were uploaded keeps the ones that failed or were left out, so the next
 * submit retries only those. Any other picker clears, unless some file failed
 * and will need it again on the retry.
 */
function usePruneAfterImport(
    name: string | undefined,
    picked: File[],
    update: (next: File[]) => void,
) {
    const progress = useUploadProgress();
    const latest = React.useRef({ picked, update, states: progress?.files });
    React.useEffect(() => {
        latest.current = { picked, update, states: progress?.files };
    });
    const completedRun = progress?.completedRun ?? 0;
    const seenRunRef = React.useRef(completedRun);
    React.useEffect(() => {
        if (completedRun === seenRunRef.current) return;
        seenRunRef.current = completedRun;
        const { picked: current, update: apply, states = {} } = latest.current;
        const stateOf = (file: File) =>
            name ? states[uploadProgressKey(name, file)] : undefined;
        const uploadedHere = current.some((file) => stateOf(file));
        if (uploadedHere) {
            apply(current.filter((file) => stateOf(file)?.status !== "done"));
            return;
        }
        // A companion picker (an answers file or CSV) is needed again to
        // retry the files that failed, so it only clears when none did.
        const retryPending = Object.values(states).some(
            (state) => state.status === "failed",
        );
        if (!retryPending) apply([]);
    }, [completedRun, name]);
}

function SelectionSummary({
    count,
    bytes,
    maxTotalBytes,
    excludedCount,
    disabled,
    onClearAll,
}: {
    count: number;
    bytes: number;
    maxTotalBytes?: number;
    excludedCount: number;
    disabled: boolean;
    onClearAll: () => void;
}) {
    return (
        <div className="flex items-center justify-between gap-2">
            <p
                aria-live="polite"
                className="text-copy-14 text-muted-foreground"
            >
                <span className="text-label-14 text-on-surface">
                    {count === 0
                        ? "No files will be uploaded"
                        : `${plural(count, "file")} will be uploaded`}
                </span>
                {count > 0 && (
                    <>
                        {" · "}
                        {formatFileSize(bytes)}
                        {maxTotalBytes !== undefined &&
                            ` of ${formatFileSize(maxTotalBytes)}`}
                    </>
                )}
                {excludedCount > 0 && (
                    <span className="text-eval-warning">
                        {" · "}
                        {excludedCount} left out
                    </span>
                )}
            </p>
            <Button
                type="button"
                variant="ghost"
                size="sm"
                className="shrink-0"
                disabled={disabled}
                onClick={onClearAll}
            >
                Clear all
            </Button>
        </div>
    );
}

function FileRow({
    file,
    state,
    disabled,
    onRemove,
}: {
    file: File;
    state?: IFileUploadState;
    disabled: boolean;
    onRemove: () => void;
}) {
    const percent =
        state && state.total > 0
            ? Math.round((state.loaded / state.total) * 100)
            : 0;
    return (
        <li
            className={cn(
                "flex flex-col gap-1.5 rounded-sm border bg-neutral px-3 py-1.5 text-copy-14",
                state?.status === "failed"
                    ? "border-error/40"
                    : "border-border",
            )}
        >
            <div className="flex min-h-8 items-center justify-between gap-2">
                <span className="min-w-0 truncate text-on-surface">
                    {file.name}
                    <span className="pl-2 text-muted-foreground">
                        {formatFileSize(file.size)}
                    </span>
                </span>
                {state && state.status !== "failed" ? (
                    <FileStatus state={state} percent={percent} />
                ) : (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0"
                        disabled={disabled}
                        aria-label={`Remove ${file.name}`}
                        onClick={onRemove}
                    >
                        <X className="size-4" aria-hidden="true" />
                    </Button>
                )}
            </div>
            {state?.status === "uploading" && (
                <Progress
                    value={percent}
                    aria-label={`Uploading ${file.name}`}
                    className="h-1"
                />
            )}
            {state?.status === "failed" && (
                <p className="flex items-start gap-1 text-copy-13 text-error">
                    <CircleAlert
                        className="mt-0.5 size-3.5 shrink-0"
                        aria-hidden="true"
                    />
                    {state.error ?? "Upload failed."} It will be retried on the
                    next submit.
                </p>
            )}
        </li>
    );
}

function FileStatus({
    state,
    percent,
}: {
    state: IFileUploadState;
    percent: number;
}) {
    switch (state.status) {
        case "queued":
            return (
                <span className="shrink-0 text-copy-13 text-muted-foreground">
                    Waiting
                </span>
            );
        case "uploading":
            return (
                <span className="shrink-0 text-copy-13 tabular-nums text-muted-foreground">
                    {percent}%
                </span>
            );
        case "done":
            return (
                <span className="flex shrink-0 items-center gap-1 text-copy-13 text-eval-success">
                    <CircleCheck className="size-4" aria-hidden="true" />
                    Uploaded
                </span>
            );
        default:
            return null;
    }
}

function ExcludedFiles({
    id,
    excluded,
    limits,
    multiple,
    disabled,
    onRemove,
    onRemoveAll,
}: {
    id: string;
    excluded: IExcludedFile[];
    limits: { maxBytes?: number; maxFiles?: number; maxTotalBytes?: number };
    multiple: boolean;
    disabled: boolean;
    onRemove: (file: File) => void;
    onRemoveAll: () => void;
}) {
    const groups = EXCLUSION_ORDER.map((reason) => ({
        reason,
        files: excluded.filter((entry) => entry.reason === reason),
    })).filter((group) => group.files.length > 0);

    return (
        <section
            id={id}
            role="alert"
            aria-label="Files left out"
            className="flex flex-col gap-3 rounded-sm border border-eval-warning/40 bg-eval-warning-muted p-3"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="flex gap-2">
                    <CircleAlert
                        className="mt-0.5 size-4 shrink-0 text-eval-warning"
                        aria-hidden="true"
                    />
                    <div className="flex flex-col">
                        <p className="text-label-14 text-on-surface">
                            {plural(excluded.length, "file")} won&apos;t be
                            uploaded in this run
                        </p>
                        <p className="text-copy-13 text-muted-foreground">
                            The other files can still be uploaded now.
                        </p>
                    </div>
                </div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={disabled}
                    onClick={onRemoveAll}
                >
                    Dismiss all
                </Button>
            </div>
            <div className="flex max-h-64 flex-col gap-3 overflow-y-auto pr-1">
                {groups.map((group) => {
                    const copy = exclusionCopy(group.reason, limits, multiple);
                    return (
                        <div key={group.reason} className="flex flex-col gap-1">
                            <p className="text-label-13 text-on-surface">
                                {copy.title}{" "}
                                <span className="text-muted-foreground">
                                    ({group.files.length})
                                </span>
                            </p>
                            <p className="text-copy-13 text-muted-foreground">
                                {copy.action}
                            </p>
                            <ul className="flex flex-col">
                                {group.files.map(({ file }, index) => (
                                    <li
                                        key={`${file.name}-${index}`}
                                        className="flex items-center justify-between gap-2 text-copy-13"
                                    >
                                        <span className="min-w-0 truncate text-on-surface">
                                            {file.name}
                                            <span className="pl-2 text-muted-foreground">
                                                {formatFileSize(file.size)}
                                            </span>
                                        </span>
                                        <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon"
                                            className="size-7 shrink-0"
                                            disabled={disabled}
                                            aria-label={`Dismiss ${file.name}`}
                                            onClick={() => onRemove(file)}
                                        >
                                            <X
                                                className="size-3.5"
                                                aria-hidden="true"
                                            />
                                        </Button>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
