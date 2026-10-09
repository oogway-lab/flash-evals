"use client";

import { Check, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { KeyboardEvent } from "react";
import type {
    IRunSetupDatasetOption,
    IRunSetupModelOption,
    IRunSetupVersionOption,
    ReasoningEffort,
} from "@mosaic/api-contract";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { RequiredMark } from "./run-form-basics";
import { transportLabel } from "@/lib/transport";
import type { usePromptEvalRunController } from "./use-prompt-eval-run-controller";
import {
    modelCanRunOnDataset,
    modelDisabledReason,
    reasoningConfigForModel,
} from "./use-prompt-eval-run-controller";
import { Hint } from "@/components/ui/hint";
import { REASONING_EFFORT_LABELS } from "@/lib/labels";

type PromptEvalController = ReturnType<typeof usePromptEvalRunController>;

function ModelOptionButton({
    model,
    selected,
    selectedDataset,
    onToggle,
}: {
    model: IRunSetupModelOption;
    selected: boolean;
    selectedDataset: IRunSetupDatasetOption | undefined;
    onToggle: (modelId: string) => void;
}) {
    const disabledReason = modelDisabledReason(model, selectedDataset);
    const disabled = !model.available || Boolean(disabledReason);
    let capabilitySuffix = "";
    if (!model.structuredOutput) capabilitySuffix = " (no structured output)";
    else if (!modelCanRunOnDataset(model, selectedDataset)) {
        capabilitySuffix = " (no image input)";
    }

    // aria-disabled rather than disabled, so the chip stays focusable and
    // its tooltip can say why it can't be picked.
    const reason = disabledReason ?? "Model unavailable";
    return (
        <Hint
            content={
                disabled ? (
                    reason
                ) : (
                    <span className="text-mono-13">{model.id}</span>
                )
            }
        >
            <button
                type="button"
                data-model-id={model.id}
                aria-disabled={disabled || undefined}
                aria-pressed={selected}
                onClick={() => {
                    if (!disabled) onToggle(model.id);
                }}
                className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            >
                <Badge
                    variant={selected ? "default" : "outline"}
                    className={cn(
                        "gap-1",
                        !disabled && "cursor-pointer hover:bg-muted",
                    )}
                >
                    {selected ? (
                        <Check className="size-3.5" aria-hidden="true" />
                    ) : null}
                    {model.label}
                    {capabilitySuffix}
                    {disabled && <span className="sr-only">: {reason}</span>}
                </Badge>
            </button>
        </Hint>
    );
}

function ModelFamilySelector({
    controller,
    selectedDataset,
}: {
    controller: PromptEvalController;
    selectedDataset: IRunSetupDatasetOption | undefined;
}) {
    return (
        <div className="space-y-3">
            <Select
                value={controller.effectiveProviderLabel ?? ""}
                onValueChange={controller.setActiveProviderLabel}
                disabled={controller.providerGroups.length === 0}
            >
                <SelectTrigger
                    aria-label="Model family"
                    className="max-w-[260px]"
                >
                    <SelectValue placeholder="Choose a model family" />
                </SelectTrigger>
                <SelectContent>
                    {controller.providerGroups.map((group) => (
                        <SelectItem key={group.label} value={group.label}>
                            {group.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2">
                {controller.activeProviderModels.map((model) => (
                    <ModelOptionButton
                        key={model.id}
                        model={model}
                        selected={controller.selectedModels.includes(model.id)}
                        selectedDataset={selectedDataset}
                        onToggle={controller.toggleModel}
                    />
                ))}
            </div>
            {controller.selectedModels.length > 0 && (
                <p className="text-copy-14 text-muted-foreground">
                    {controller.selectedModels.length} selected across all model
                    families.
                </p>
            )}
        </div>
    );
}

function ManualModelInput({
    controller,
}: {
    controller: PromptEvalController;
}) {
    const addOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        controller.addManualModel();
    };

    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor="manualModel">Add a transcript consumer by id</Label>
            <p className="text-copy-14 text-muted-foreground">
                Use fine-tuned ids in OpenAI modes or Gateway ids like
                anthropic/... in Gateway mode.
            </p>
            <div className="flex gap-2">
                <Input
                    id="manualModel"
                    value={controller.manualModel}
                    onChange={(event) =>
                        controller.setManualModel(event.target.value)
                    }
                    onKeyDown={addOnEnter}
                    placeholder="anthropic/claude-sonnet-4.5"
                    className="text-mono-13"
                />
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={controller.addManualModel}
                >
                    Add
                </Button>
            </div>
            {controller.customModels.length > 0 && (
                <div className="flex flex-wrap gap-2">
                    {controller.customModels.map((modelId) => (
                        <Hint key={modelId} content={`Remove ${modelId}`}>
                            <button
                                type="button"
                                onClick={() => controller.removeModel(modelId)}
                                aria-label={`Remove ${modelId}`}
                                className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                            >
                                <Badge variant="outline" className="gap-1">
                                    {modelId}
                                    <X
                                        className="size-3.5"
                                        aria-hidden="true"
                                    />
                                </Badge>
                            </button>
                        </Hint>
                    ))}
                </div>
            )}
        </div>
    );
}

function PerModelConfigurationRow({
    modelId,
    controller,
    availableModels,
    versionOptions,
}: {
    modelId: string;
    controller: PromptEvalController;
    availableModels: IRunSetupModelOption[];
    versionOptions: IRunSetupVersionOption[];
}) {
    const assignedPromptVersionId =
        controller.promptByModel[modelId] ?? controller.promptVersionId;
    const selectedModel = availableModels.find((model) => model.id === modelId);
    const capability = selectedModel?.reasoningEffort;
    const transports = selectedModel?.transports ?? [];
    const reasoningConfig = reasoningConfigForModel(
        modelId,
        assignedPromptVersionId,
        availableModels,
        versionOptions,
        controller.reasoningByModel[modelId],
    );

    return (
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_minmax(160px,0.6fr)_minmax(160px,0.6fr)]">
            <Card variant="inset" className="px-3 py-2 text-mono-13">
                {modelId}
            </Card>
            <Select
                value={assignedPromptVersionId}
                onValueChange={(value) =>
                    controller.setPromptByModel((previous) => ({
                        ...previous,
                        [modelId]: value,
                    }))
                }
            >
                <SelectTrigger aria-label={`Prompt version for ${modelId}`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {versionOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {transports.length > 1 ? (
                <Select
                    value={controller.transportByModel[modelId] ?? ""}
                    onValueChange={(value) =>
                        controller.setTransportByModel((previous) => ({
                            ...previous,
                            [modelId]: value as (typeof transports)[number],
                        }))
                    }
                >
                    <SelectTrigger aria-label={`Transport for ${modelId}`}>
                        <SelectValue placeholder="Default transport" />
                    </SelectTrigger>
                    <SelectContent>
                        {transports.map((transport) => (
                            <SelectItem key={transport} value={transport}>
                                {transportLabel(transport)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : (
                <div aria-hidden="true" />
            )}
            {capability ? (
                <Select
                    value={reasoningConfig?.effort ?? ""}
                    onValueChange={(value) =>
                        controller.setReasoningByModel((previous) => ({
                            ...previous,
                            [modelId]: value as ReasoningEffort,
                        }))
                    }
                >
                    <SelectTrigger
                        aria-label={`Reasoning effort for ${modelId}`}
                    >
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        {capability.supportedLevels.map((level) => (
                            <SelectItem key={level} value={level}>
                                {REASONING_EFFORT_LABELS[level]}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : (
                <p className="px-3 py-2 text-copy-14 text-muted-foreground">
                    Reasoning unsupported
                </p>
            )}
        </div>
    );
}

function PerModelConfiguration({
    controller,
    availableModels,
    versionOptions,
}: {
    controller: PromptEvalController;
    availableModels: IRunSetupModelOption[];
    versionOptions: IRunSetupVersionOption[];
}) {
    if (controller.selectedModels.length === 0) return null;
    return (
        <div className="space-y-3">
            <Label>Per-model configuration</Label>
            <div className="hidden gap-2 px-1 text-label-12 text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(180px,0.7fr)_minmax(160px,0.6fr)_minmax(160px,0.6fr)]">
                <span>Model</span>
                <span>Prompt version</span>
                <span>Transport</span>
                <span>Reasoning effort</span>
            </div>
            {controller.selectedModels.map((modelId) => (
                <PerModelConfigurationRow
                    key={modelId}
                    modelId={modelId}
                    controller={controller}
                    availableModels={availableModels}
                    versionOptions={versionOptions}
                />
            ))}
        </div>
    );
}

export function PromptEvalModelsSection({
    controller,
    availableModels,
    versionOptions,
    selectedDataset,
    modelsDegraded,
}: {
    controller: PromptEvalController;
    availableModels: IRunSetupModelOption[];
    versionOptions: IRunSetupVersionOption[];
    selectedDataset: IRunSetupDatasetOption | undefined;
    modelsDegraded: boolean;
}) {
    const isAudio = selectedDataset?.modality === "audio";
    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">3.</span>{" "}
                    {isAudio ? "Transcript consumers" : "Models"}
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {modelsDegraded && (
                    <Alert role="status">
                        <AlertDescription>
                            Couldn&apos;t verify which models your API key
                            supports. Showing the full list. Selecting an
                            unavailable model may fail at run time.
                        </AlertDescription>
                    </Alert>
                )}
                <div className="flex flex-col gap-2">
                    <Label>
                        {isAudio
                            ? "Transcript consumer models"
                            : "Candidate models"}
                        <RequiredMark />
                    </Label>
                    <p className="text-copy-14 text-muted-foreground">
                        {isAudio
                            ? "These LLMs receive the STT transcript after transcription. The STT model above is the audio model under test."
                            : "Choose a model family, then pick the models to compare. Greyed-out models aren't enabled for your API key."}
                    </p>
                    <ModelFamilySelector
                        controller={controller}
                        selectedDataset={selectedDataset}
                    />
                </div>
                <ManualModelInput controller={controller} />
                <PerModelConfiguration
                    controller={controller}
                    availableModels={availableModels}
                    versionOptions={versionOptions}
                />
                <div className="flex flex-col gap-2">
                    <Label htmlFor="referenceModel">
                        {isAudio
                            ? "Reference transcript consumer"
                            : "Reference model"}
                    </Label>
                    <Select
                        name="referenceModel"
                        value={controller.effectiveReference}
                        onValueChange={controller.setReferenceModel}
                    >
                        <SelectTrigger id="referenceModel">
                            <SelectValue placeholder="Choose a reference model" />
                        </SelectTrigger>
                        <SelectContent>
                            {controller.selectedModels.map((modelId) => (
                                <SelectItem key={modelId} value={modelId}>
                                    {modelId}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <p className="text-label-12 text-muted-foreground">
                        {isAudio
                            ? "The downstream LLM baseline for transcript-to-output comparison. STT baseline comparison comes from rerunning with a different STT model."
                            : "The incumbent baseline (e.g. gpt-4o) for comparison."}
                    </p>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="maxTokens">Max output tokens</Label>
                    <Input
                        id="maxTokens"
                        name="maxTokens"
                        type="number"
                        defaultValue={500}
                        className="max-w-[200px]"
                    />
                </div>
            </CardContent>
        </Card>
    );
}
