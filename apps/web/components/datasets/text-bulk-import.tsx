"use client";

import { FileDropzone } from "@/components/ui/file-dropzone";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { HelpCallout } from "@/components/datasets/help-callout";
import { ImportFormShell } from "./import-form-shell";
import type { IActionState } from "@/app/actions";
import { RadioCard, RadioGroup } from "@/components/ui/radio-group";

type TextFormat = "jsonl" | "csv";

export function TextBulkImport({
    datasetId,
    withAnswers,
    action,
}: {
    datasetId: string;
    withAnswers: boolean;
    action: (prev: IActionState, formData: FormData) => Promise<IActionState>;
}) {
    const [format, setFormat] = useState<TextFormat>("jsonl");

    return (
        <ImportFormShell
            datasetId={datasetId}
            action={action}
            submitLabel="Import items"
            textSizeGuards={[{ field: "file", label: "Import file" }]}
        >
            <input type="hidden" name="format" value={format} />
            <HelpCallout
                title={withAnswers ? "Row format" : "Input file format"}
            >
                {withAnswers
                    ? "Each row carries the input text and its expected answer fields."
                    : "Each row carries the input text. Outputs are generated at run time."}
            </HelpCallout>

            <div className="flex flex-col gap-2">
                <p
                    id="text-bulk-format"
                    className="text-label-14 text-on-surface"
                >
                    Format
                </p>
                <RadioGroup
                    aria-labelledby="text-bulk-format"
                    value={format}
                    onValueChange={(value) => setFormat(value as TextFormat)}
                    className="flex flex-wrap gap-3"
                >
                    {(["jsonl", "csv"] as TextFormat[]).map((option) => (
                        <RadioCard
                            key={option}
                            value={option}
                            title={option.toUpperCase()}
                        />
                    ))}
                </RadioGroup>
            </div>

            <div className="flex flex-col gap-2">
                <Label htmlFor="text-bulk-file">
                    {format === "csv" ? "CSV file" : "JSONL file"}
                </Label>
                <FileDropzone
                    // Remount when the format changes so a CSV selected for
                    // JSONL (or vice versa) doesn't linger.
                    key={format}
                    id="text-bulk-file"
                    name="file"
                    accept={
                        format === "csv" ? ".csv,text/csv" : ".jsonl,.ndjson"
                    }
                    size="sm"
                    title={
                        format === "csv"
                            ? "Drop a CSV file or click to browse"
                            : "Drop a JSONL file or click to browse"
                    }
                    hint={
                        format === "csv"
                            ? "One item per row"
                            : "One JSON object per line"
                    }
                />
            </div>
        </ImportFormShell>
    );
}
