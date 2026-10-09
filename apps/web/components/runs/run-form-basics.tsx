"use client";

import Link from "next/link";
import type {
    AudioRunMode,
    IRunSetupDatasetOption,
    IRunSetupVersionOption,
} from "@mosaic/api-contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { AudioRunModeSelector } from "./audio-run-mode-selector";

export function RequiredMark() {
    return (
        <span className="text-error" aria-hidden="true">
            {" "}
            *
        </span>
    );
}

export function DatasetSection({
    datasets,
    datasetId,
    onDatasetChange,
}: {
    datasets: IRunSetupDatasetOption[];
    datasetId: string;
    onDatasetChange: (datasetId: string) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">1.</span> Dataset
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <Label htmlFor="datasetId">
                    Dataset
                    <RequiredMark />
                </Label>
                <Select
                    name="datasetId"
                    value={datasetId}
                    onValueChange={onDatasetChange}
                    disabled={datasets.length === 0}
                >
                    <SelectTrigger id="datasetId">
                        <SelectValue placeholder="Choose a dataset" />
                    </SelectTrigger>
                    <SelectContent>
                        {datasets.map((dataset) => (
                            <SelectItem key={dataset.id} value={dataset.id}>
                                {dataset.name} ({dataset.itemCount} items
                                {dataset.purpose === "golden"
                                    ? `, ${dataset.labeledItemCount} labeled`
                                    : ""}
                                )
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {datasets.length === 0 && (
                    <p className="text-copy-14 text-muted-foreground">
                        No runnable datasets yet.{" "}
                        <Link
                            href="/datasets/new"
                            className="text-label-14 text-on-surface underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        >
                            Create a dataset
                        </Link>{" "}
                        to get started.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

function PromptVersionSection({
    versionOptions,
    promptVersionId,
    onPromptVersionChange,
}: {
    versionOptions: IRunSetupVersionOption[];
    promptVersionId: string;
    onPromptVersionChange: (promptVersionId: string) => void;
}) {
    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">2.</span> Prompt
                    version
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
                <Label htmlFor="promptVersionId">
                    Prompt version
                    <RequiredMark />
                </Label>
                <Select
                    name="promptVersionId"
                    value={promptVersionId}
                    onValueChange={onPromptVersionChange}
                    disabled={versionOptions.length === 0}
                >
                    <SelectTrigger id="promptVersionId">
                        <SelectValue placeholder="Choose a prompt version" />
                    </SelectTrigger>
                    <SelectContent>
                        {versionOptions.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                {versionOptions.length === 0 ? (
                    <p className="text-copy-14 text-muted-foreground">
                        No runnable prompt versions yet.{" "}
                        <Link
                            href="/prompts/new"
                            className="text-label-14 text-on-surface underline underline-offset-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                        >
                            Create a prompt
                        </Link>{" "}
                        and validate a version to run it.
                    </p>
                ) : (
                    <p className="text-copy-14 text-muted-foreground">
                        This prompt&apos;s schema defines the structured output
                        for the run.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export function RunSetupHeader({
    datasets,
    datasetId,
    onDatasetChange,
    usesPromptEval,
    versionOptions,
    promptVersionId,
    onPromptVersionChange,
    audioRunMode,
    onAudioRunModeChange,
}: {
    datasets: IRunSetupDatasetOption[];
    datasetId: string;
    onDatasetChange: (datasetId: string) => void;
    usesPromptEval: boolean;
    versionOptions: IRunSetupVersionOption[];
    promptVersionId: string;
    onPromptVersionChange: (promptVersionId: string) => void;
    audioRunMode: AudioRunMode;
    onAudioRunModeChange: (mode: AudioRunMode) => void;
}) {
    return (
        <div className="grid gap-6 md:grid-cols-2">
            <DatasetSection
                datasets={datasets}
                datasetId={datasetId}
                onDatasetChange={onDatasetChange}
            />
            {usesPromptEval ? (
                <PromptVersionSection
                    versionOptions={versionOptions}
                    promptVersionId={promptVersionId}
                    onPromptVersionChange={onPromptVersionChange}
                />
            ) : (
                <AudioRunModeSelector
                    audioRunMode={audioRunMode}
                    onAudioRunModeChange={onAudioRunModeChange}
                    step="2."
                    sttMetricsDescription="Transcribe audio, then score WER, CER, diarization, transcript judge, and related metrics."
                    promptEvalDescription="Send the transcript into a Flash Evals prompt and compare downstream structured outputs."
                />
            )}
        </div>
    );
}
