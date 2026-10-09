"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFieldErrorId } from "@/components/ui/field-error-context";
import { cn } from "@/lib/cn";

export interface IFileDropzoneProps {
    /** Form field name; omit to handle files only through `onFilesChange`. */
    name?: string;
    id?: string;
    /** Same syntax as `<input accept>`; also enforced on drop. */
    accept: string;
    multiple?: boolean;
    /** Per-file size limit, enforced on drop and selection. */
    maxBytes?: number;
    required?: boolean;
    disabled?: boolean;
    title: string;
    hint: string;
    /** `sm` for a compact field-sized target inside forms. */
    size?: "default" | "sm";
    onFilesChange?: (files: File[]) => void;
    "aria-describedby"?: string;
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

/**
 * File picker with drag and drop. Files are checked against `accept` and
 * `maxBytes` however they arrive, listed with remove/clear, kept in sync with
 * the underlying `<input type="file">` for form submission, cleared on form
 * reset, and disabled while the form is submitting.
 */
export function FileDropzone({
    name,
    id,
    accept,
    multiple = false,
    maxBytes,
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
    const rejectionId = `${inputId}-rejected`;
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [files, setFiles] = React.useState<File[]>([]);
    const [rejected, setRejected] = React.useState<string[]>([]);
    const [missing, setMissing] = React.useState(false);
    const buttonRef = React.useRef<HTMLButtonElement>(null);
    const missingId = `${inputId}-missing`;
    // Counts enter/leave pairs so crossing child elements doesn't flicker.
    const [dragDepth, setDragDepth] = React.useState(0);
    const { pending } = useFormStatus();
    const fieldErrorId = useFieldErrorId(name);
    const disabled = disabledProp || pending;

    const onFilesChangeRef = React.useRef(onFilesChange);
    React.useEffect(() => {
        onFilesChangeRef.current = onFilesChange;
    });

    const commit = React.useCallback((next: File[]) => {
        setFiles(next);
        const input = inputRef.current;
        // DataTransfer is the only way to set `input.files`; skip where the
        // environment lacks it (jsdom), since the input already holds them.
        if (input && typeof DataTransfer !== "undefined") {
            const transfer = new DataTransfer();
            next.forEach((file) => transfer.items.add(file));
            input.files = transfer.files;
        }
        onFilesChangeRef.current?.(next);
    }, []);

    function receive(list: FileList | null) {
        const incoming = Array.from(list ?? []);
        if (incoming.length === 0) return;
        setMissing(false);
        const problems: string[] = [];
        const valid = incoming.filter((file) => {
            if (!fileMatchesAccept(file, accept)) {
                problems.push(`${file.name}: unsupported file type.`);
                return false;
            }
            if (maxBytes !== undefined && file.size > maxBytes) {
                problems.push(
                    `${file.name}: larger than ${formatFileSize(maxBytes)}.`,
                );
                return false;
            }
            return true;
        });
        if (!multiple && valid.length > 1) {
            problems.push("Only one file can be added here.");
        }
        setRejected(problems);
        commit(multiple ? valid : valid.slice(0, 1));
    }

    // React 19 resets a form after every action, failed ones included, which
    // empties this file input. Put the selection back so a failed save keeps
    // the user's files; forms that should clear on success remount this
    // component (e.g. via a key) instead.
    const filesRef = React.useRef(files);
    React.useEffect(() => {
        filesRef.current = files;
    }, [files]);
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

    const dragging = dragDepth > 0 && !disabled;
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
                        rejected.length ? rejectionId : undefined,
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
            {rejected.length > 0 && (
                <ul
                    id={rejectionId}
                    role="alert"
                    className="flex flex-col gap-1 text-copy-14 text-error"
                >
                    {rejected.map((problem) => (
                        <li key={problem}>{problem}</li>
                    ))}
                </ul>
            )}
            {files.length > 0 && (
                <div className="flex flex-col gap-1">
                    <ul
                        aria-label="Selected files"
                        className="flex flex-col gap-1"
                    >
                        {files.map((file, index) => (
                            <li
                                key={`${file.name}-${index}`}
                                className="flex items-center justify-between gap-2 rounded-sm border border-border bg-neutral px-3 py-1.5 text-copy-14"
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
                                    className="size-8 shrink-0"
                                    disabled={disabled}
                                    aria-label={`Remove ${file.name}`}
                                    onClick={() =>
                                        commit(
                                            files.filter((_, i) => i !== index),
                                        )
                                    }
                                >
                                    <X className="size-4" aria-hidden="true" />
                                </Button>
                            </li>
                        ))}
                    </ul>
                    {files.length > 1 && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="self-end"
                            disabled={disabled}
                            onClick={() => commit([])}
                        >
                            Clear all
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
