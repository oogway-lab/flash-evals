"use client";

import { FileDropzone } from "@/components/ui/file-dropzone";
import { toast } from "sonner";

import { useRef, useState, useTransition } from "react";
import type {
    AnswerImportInterpretation,
    AnswerImportTargetField,
    IAnswerImportFile,
    IAnswerImportMapping,
    IAnswerImportPreview,
    IImportSummary,
} from "@mosaic/api-contract";
import {
    ImportCountBadge,
    ImportRowStatusBadge,
} from "@/components/ui/status-badge";
import { MISSING_VALUE } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { StaleRegion } from "@/components/ui/stale-region";
import { HelpCallout } from "@/components/datasets/help-callout";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { ImportFormShell } from "./import-form-shell";
import { ImportResultSummary } from "./import-result-summary";
import type { IActionState } from "@/app/actions";

type PreviewResult =
    { ok: true; preview: IAnswerImportPreview } | { ok: false; error: string };
type CommitResult =
    { ok: true; result: IImportSummary } | { ok: false; error: string };

const TARGETS: Array<{ value: AnswerImportTargetField; label: string }> = [
    { value: "ignore", label: "Ignore" },
    { value: "expectedTranscript", label: "Gold transcript" },
    { value: "expectedTranscriptLatin", label: "Latin transcript" },
    { value: "expectedLanguage", label: "Language" },
    { value: "expectedSpeakerTurns", label: "Expected speaker turns" },
    { value: "domainTerms", label: "Domain terms" },
    { value: "expectedNumbers", label: "Expected numbers" },
    { value: "referenceKind", label: "Reference kind" },
    { value: "latencySlaMs", label: "Latency SLA" },
    { value: "costOutlierUsd", label: "Cost outlier" },
];

function pairingReason(
    reason: NonNullable<IAnswerImportPreview["rows"][number]["matchReason"]>,
): string {
    if (reason === "filename_stem") return "Matched by filename stem";
    if (reason === "only_unlabeled") return "Only unlabeled audio item";
    return "Selected for this file";
}

function speakerTurnCount(label: Record<string, unknown> | undefined): string {
    const turns = label?.expectedSpeakerTurns;
    return Array.isArray(turns) ? `${turns.length} turns` : MISSING_VALUE;
}

function transcriptSnippet(label: Record<string, unknown> | undefined): string {
    return typeof label?.expectedTranscript === "string"
        ? label.expectedTranscript
        : MISSING_VALUE;
}

function updatedAnswerFile(
    file: IAnswerImportFile,
    update: Pick<
        IAnswerImportFile,
        "itemId" | "interpretation" | "allowOverwrite"
    >,
): IAnswerImportFile {
    const targetChanged =
        update.itemId !== undefined || update.interpretation !== undefined;
    const { allowOverwrite: _previousConsent, ...withoutConsent } = file;
    const base = targetChanged ? withoutConsent : file;
    return { ...base, ...update };
}

export function SttGoldenAnswersImport({
    datasetId,
    previewAction,
    commitAction,
}: {
    datasetId: string;
    previewAction: (formData: FormData) => Promise<PreviewResult>;
    commitAction: (formData: FormData) => Promise<CommitResult>;
}) {
    const [answerFiles, setAnswerFiles] = useState<IAnswerImportFile[]>([]);
    const [preview, setPreview] = useState<IAnswerImportPreview>();
    const [mapping, setMapping] = useState<IAnswerImportMapping>({});
    const [result, setResult] = useState<IImportSummary>();
    const [error, setError] = useState<string>();
    const [, startTransition] = useTransition();
    const [operation, setOperation] = useState<
        "reading" | "previewing" | "committing"
    >();
    const previewRequest = useRef(0);
    const operationRequest = useRef(0);

    function previewWith(
        nextMapping?: IAnswerImportMapping,
        nextFiles = answerFiles,
    ) {
        const request = ++previewRequest.current;
        const operationId = ++operationRequest.current;
        setError(undefined);
        setResult(undefined);
        setOperation("previewing");
        const data = new FormData();
        data.set("datasetId", datasetId);
        data.set("answersContent", "");
        data.set("answerFiles", JSON.stringify(nextFiles));
        if (nextMapping) data.set("mapping", JSON.stringify(nextMapping));
        startTransition(async () => {
            const response = await previewAction(data);
            if (request !== previewRequest.current) return;
            if (!response.ok) {
                setError(response.error);
                setPreview(undefined);
                if (operationId === operationRequest.current) {
                    setOperation(undefined);
                }
                return;
            }
            setPreview(response.preview);
            setMapping(nextMapping ?? response.preview.proposedMapping);
            if (operationId === operationRequest.current) {
                setOperation(undefined);
            }
        });
    }

    function updateMapping(field: string, target: AnswerImportTargetField) {
        const next = { ...mapping, [field]: target };
        if (target === "expectedTranscript") {
            for (const [source, mappedTarget] of Object.entries(next)) {
                if (source !== field && mappedTarget === "expectedTranscript") {
                    next[source] = "ignore";
                }
            }
        }
        setMapping(next);
        previewWith(next);
    }

    function updateFile(
        fileName: string,
        update: Pick<
            IAnswerImportFile,
            "itemId" | "interpretation" | "allowOverwrite"
        >,
        resetMapping = false,
    ) {
        const next = answerFiles.map((file) =>
            file.fileName === fileName ? updatedAnswerFile(file, update) : file,
        );
        setAnswerFiles(next);
        previewWith(resetMapping ? undefined : mapping, next);
    }

    function commit() {
        const operationId = ++operationRequest.current;
        const data = new FormData();
        data.set("datasetId", datasetId);
        data.set("answersContent", "");
        data.set("answerFiles", JSON.stringify(answerFiles));
        data.set("mapping", JSON.stringify(mapping));
        setError(undefined);
        setOperation("committing");
        startTransition(async () => {
            const response = await commitAction(data);
            if (operationId !== operationRequest.current) return;
            if (!response.ok) {
                setError(response.error);
                setOperation(undefined);
                return;
            }
            setResult(response.result);
            setOperation(undefined);
            toast.success(
                `Imported ${response.result.importedCount} golden ${
                    response.result.importedCount === 1 ? "answer" : "answers"
                }.`,
            );
        });
    }

    // A mapping or file change re-runs the preview; the current preview stays
    // on screen, dimmed and locked, until the new one arrives.
    const reanalyzing = operation === "previewing" && preview !== undefined;
    const locked = operation === "committing" || reanalyzing;
    return (
        <div className="flex flex-col gap-6">
            <ol
                className="grid gap-2 text-copy-14 sm:grid-cols-3"
                aria-label="Import steps"
            >
                {[
                    "1. Choose files",
                    "2. Map fields",
                    "3. Preview and commit",
                ].map((step) => (
                    <li key={step} className="text-muted-foreground">
                        {step}
                    </li>
                ))}
            </ol>

            <div className="flex flex-col gap-2">
                <Label htmlFor="golden-answers">
                    Golden answers (one or more JSON or JSONL files)
                </Label>
                <FileDropzone
                    id="golden-answers"
                    accept=".json,.jsonl,application/json"
                    multiple
                    disabled={operation === "committing"}
                    size="sm"
                    title="Drop JSON or JSONL files or click to browse"
                    hint="One file per item, or one file keyed by item"
                    onFilesChange={(files) => {
                        if (files.length === 0) {
                            // Removed or cleared: drop the loaded answers too.
                            ++previewRequest.current;
                            setAnswerFiles([]);
                            setPreview(undefined);
                            setResult(undefined);
                            setError(undefined);
                            return;
                        }
                        const request = ++previewRequest.current;
                        const operationId = ++operationRequest.current;
                        setOperation("reading");
                        setAnswerFiles([]);
                        setPreview(undefined);
                        setResult(undefined);
                        setError(undefined);
                        void Promise.all(
                            files.map(async (file) => ({
                                fileName: file.name,
                                content: await file.text(),
                            })),
                        )
                            .then((values) => {
                                if (request !== previewRequest.current) return;
                                setAnswerFiles(values);
                                if (operationId === operationRequest.current) {
                                    setOperation(undefined);
                                }
                            })
                            .catch(() => {
                                if (request !== previewRequest.current) return;
                                setError(
                                    "One or more answer files could not be read.",
                                );
                                if (operationId === operationRequest.current) {
                                    setOperation(undefined);
                                }
                            });
                    }}
                />
            </div>
            <Button
                type="button"
                className="self-start"
                onClick={() => previewWith()}
                loading={operation === "reading" || operation === "previewing"}
                loadingText={
                    operation === "reading"
                        ? "Reading files…"
                        : preview
                          ? "Re-analyzing…"
                          : "Analyzing…"
                }
                disabled={answerFiles.length === 0 || operation !== undefined}
            >
                Analyze fields
            </Button>

            {preview && (
                <>
                    <StaleRegion
                        stale={reanalyzing}
                        className="overflow-x-auto rounded-sm border border-border"
                    >
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Detected field</TableHead>
                                    <TableHead>Sample</TableHead>
                                    <TableHead>Map to</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {preview.fields.map((field) => (
                                    <TableRow key={field.name}>
                                        <TableCell className="text-mono-13">
                                            {field.derivedFrom
                                                ? "Gold transcript"
                                                : field.name}
                                            {field.derivedFrom && (
                                                <span className="block pt-1 font-sans text-copy-14 text-muted-foreground">
                                                    derived from transcript
                                                    turns
                                                </span>
                                            )}
                                        </TableCell>
                                        <TableCell className="max-w-64 truncate text-mono-13">
                                            {JSON.stringify(field.sample)}
                                        </TableCell>
                                        <TableCell>
                                            <Select
                                                disabled={locked}
                                                value={
                                                    mapping[field.name] ??
                                                    "ignore"
                                                }
                                                onValueChange={(value) =>
                                                    updateMapping(
                                                        field.name,
                                                        value as AnswerImportTargetField,
                                                    )
                                                }
                                            >
                                                <SelectTrigger
                                                    aria-label={`Map ${field.name}`}
                                                >
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectGroup>
                                                        {TARGETS.map(
                                                            (target) => (
                                                                <SelectItem
                                                                    key={
                                                                        target.value
                                                                    }
                                                                    value={
                                                                        target.value
                                                                    }
                                                                >
                                                                    {
                                                                        target.label
                                                                    }
                                                                </SelectItem>
                                                            ),
                                                        )}
                                                    </SelectGroup>
                                                </SelectContent>
                                            </Select>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </StaleRegion>

                    <div className="flex flex-wrap gap-2" aria-live="polite">
                        <ImportCountBadge
                            status="importable"
                            count={preview.importableCount}
                        />
                        <ImportCountBadge
                            status="warning"
                            count={preview.warningCount}
                        />
                        <ImportCountBadge
                            status="failing"
                            count={preview.failingCount}
                        />
                    </div>
                    <StaleRegion
                        stale={reanalyzing}
                        className="max-h-80 overflow-auto rounded-sm border border-border"
                    >
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>File</TableHead>
                                    <TableHead>Item</TableHead>
                                    <TableHead>Speaker turns</TableHead>
                                    <TableHead>Gold transcript</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Details</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {preview.rows.map((row) => (
                                    <TableRow
                                        key={`${row.fileName ?? "answers"}-${row.row}-${row.key ?? "unknown"}`}
                                    >
                                        <TableCell className="text-mono-13">
                                            {row.fileName ?? `Row ${row.row}`}
                                            {row.interpretationAmbiguous && (
                                                <Select
                                                    disabled={locked}
                                                    onValueChange={(value) =>
                                                        updateFile(
                                                            row.fileName!,
                                                            {
                                                                interpretation:
                                                                    value as AnswerImportInterpretation,
                                                            },
                                                            true,
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger
                                                        className="mt-2"
                                                        aria-label={`Interpret ${row.fileName}`}
                                                    >
                                                        <SelectValue placeholder="Choose interpretation" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="single_record">
                                                            Treat as one
                                                            item&apos;s answer
                                                        </SelectItem>
                                                        <SelectItem value="keyed_map">
                                                            Treat keys as item
                                                            names
                                                        </SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            )}
                                        </TableCell>
                                        <TableCell className="min-w-56 text-mono-13">
                                            {row.requiresItemSelection &&
                                            row.fileName ? (
                                                <Select
                                                    disabled={locked}
                                                    onValueChange={(itemId) =>
                                                        updateFile(
                                                            row.fileName!,
                                                            { itemId },
                                                        )
                                                    }
                                                >
                                                    <SelectTrigger
                                                        aria-label={`Choose audio item for ${row.fileName}`}
                                                    >
                                                        <SelectValue placeholder="Choose audio item" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectGroup>
                                                            {preview.itemOptions?.map(
                                                                (item) => (
                                                                    <SelectItem
                                                                        key={
                                                                            item.itemId
                                                                        }
                                                                        value={
                                                                            item.itemId
                                                                        }
                                                                    >
                                                                        {
                                                                            item.sourceName
                                                                        }
                                                                    </SelectItem>
                                                                ),
                                                            )}
                                                        </SelectGroup>
                                                    </SelectContent>
                                                </Select>
                                            ) : (
                                                (row.itemSourceName ??
                                                row.key ??
                                                MISSING_VALUE)
                                            )}
                                            {row.matchReason && (
                                                <span className="block pt-1 font-sans text-copy-14 text-muted-foreground">
                                                    {pairingReason(
                                                        row.matchReason,
                                                    )}
                                                </span>
                                            )}
                                            {row.requiresOverwriteConfirmation &&
                                                row.fileName && (
                                                    <Button
                                                        type="button"
                                                        variant="secondary"
                                                        size="sm"
                                                        className="mt-2"
                                                        disabled={locked}
                                                        onClick={() =>
                                                            updateFile(
                                                                row.fileName!,
                                                                {
                                                                    allowOverwrite: true,
                                                                },
                                                            )
                                                        }
                                                    >
                                                        Replace existing answer
                                                    </Button>
                                                )}
                                        </TableCell>
                                        <TableCell>
                                            {speakerTurnCount(row.label)}
                                        </TableCell>
                                        <TableCell className="max-w-64 truncate">
                                            {transcriptSnippet(row.label)}
                                        </TableCell>
                                        <TableCell>
                                            <ImportRowStatusBadge
                                                status={row.status}
                                            />
                                        </TableCell>
                                        <TableCell>
                                            {row.messages.join(" ") ||
                                                "Ready to import."}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </StaleRegion>
                    <Button
                        type="button"
                        className="self-start"
                        onClick={commit}
                        loading={operation === "committing"}
                        loadingText="Committing…"
                        disabled={
                            operation !== undefined ||
                            // Committed already; a change re-runs the preview
                            // and clears this.
                            result !== undefined ||
                            preview.importableCount + preview.warningCount === 0
                        }
                    >
                        Commit import
                    </Button>
                </>
            )}

            {error && (
                <p role="alert" className="text-copy-14 text-error">
                    {error}
                </p>
            )}
            {result && (
                <ImportResultSummary
                    importedCount={result.importedCount}
                    failures={result.failures}
                />
            )}
        </div>
    );
}

export function GoldenAnswersImport({
    datasetId,
    action,
}: {
    datasetId: string;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    return (
        <ImportFormShell
            datasetId={datasetId}
            action={action}
            submitLabel="Import golden answers"
            resultNoun="answers imported"
            textSizeGuards={[{ field: "answers", label: "Answer file" }]}
        >
            <HelpCallout title="Answer file format">
                Upload a JSONL file or JSON array pairing each item with its
                golden answer. Use <code>key</code> (item id),{" "}
                <code>itemId</code>, or <code>filename</code> to match items.
                Example line:{" "}
                <code>{`{"key":"<item-id>","label":{"score":8}}`}</code>
            </HelpCallout>
            <div className="flex flex-col gap-2">
                <Label htmlFor="golden-answers">
                    Golden answers (JSONL or JSON)
                </Label>
                <FileDropzone
                    id="golden-answers"
                    name="answers"
                    accept=".json,.jsonl,application/json"
                    required
                    size="sm"
                    title="Drop a JSON or JSONL file or click to browse"
                    hint="A JSON array, or one JSON object per line"
                />
            </div>
        </ImportFormShell>
    );
}
