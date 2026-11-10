"use client";

import { useId, useState } from "react";
import type { IPipelineComparisonRunOption } from "@flash-evals/api-contract";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { fmtDateShort, plural } from "@/lib/format";
import { runTitle } from "@/components/runs/run-title";

const NONE = "none";

/** "Acme baseline · reference Big Model · 3 tasks · Nov 1". */
export function comparisonRunLabel(run: IPipelineComparisonRunOption): string {
    return [
        runTitle(run.id, run.noteTitle),
        run.referenceModelId
            ? `reference ${run.referenceModelId}`
            : "stored answers",
        plural(run.taskCount, "task"),
        fmtDateShort(run.createdAt),
    ].join(" · ");
}

/**
 * Picks the eval run whose test a pipeline run takes: its Task Map, verdict
 * targets, judge and data rules, against its reference model. Only finished
 * runs on the chosen dataset that have a Task Map are listed, and only a
 * pipeline with a final answer can be compared.
 */
export function CompareRunField({
    runs,
    datasetId,
    hasFinalAnswer,
}: {
    /** Eligible runs on every dataset; filtered to `datasetId` here. */
    runs: IPipelineComparisonRunOption[];
    datasetId: string;
    hasFinalAnswer: boolean;
}) {
    const id = useId();
    const [chosen, setChosen] = useState(NONE);
    const options = runs.filter((run) => run.datasetId === datasetId);
    // A run on another dataset no longer applies once the dataset changes.
    const value = options.some((run) => run.id === chosen) ? chosen : NONE;
    const disabled = !hasFinalAnswer || options.length === 0;
    const items = [
        { value: NONE, label: "Don't compare" },
        ...options.map((run) => ({
            value: run.id,
            label: comparisonRunLabel(run),
        })),
    ];
    return (
        <div className="flex flex-col gap-2">
            <input
                type="hidden"
                name="compareWithRunId"
                value={value === NONE ? "" : value}
            />
            <Label htmlFor={id}>Compare with an eval run (optional)</Label>
            <Select
                value={value}
                onValueChange={(next) => setChosen(String(next ?? NONE))}
                disabled={disabled}
            >
                <SelectTrigger id={id} aria-describedby={`${id}-help`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {items.map((item) => (
                            <SelectItem
                                key={item.value}
                                value={item.value}
                                // Long run names wrap on a phone.
                                className="whitespace-normal break-words"
                            >
                                {item.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <p id={`${id}-help`} className="text-copy-14 text-muted-foreground">
                {!hasFinalAnswer
                    ? "Add a final answer under the canvas and save it to compare this pipeline with an eval run."
                    : options.length === 0
                      ? "No finished eval run on this dataset has a Task Map to compare with."
                      : "Each item's final answer is compared with that run's reference, on the items both have. The Task Map, targets, judge and data rules come from that run unchanged, so the pipeline takes the same test as its models. Judging adds to this run's cost and spend limit."}
            </p>
        </div>
    );
}
