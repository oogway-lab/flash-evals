"use client";

import type { Dispatch, SetStateAction } from "react";
import {
    sttModelSupportsLanguage,
    type IRunSetupSttModelOption,
    type ISttRunConfig,
    type ReasoningEffort,
} from "@mosaic/api-contract";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SttConfigFields, configForSttSnapshot } from "./stt-config-fields";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { REASONING_EFFORT_LABELS } from "@/lib/labels";
import { Checkbox } from "@/components/ui/checkbox";

interface IAudioTranscriptionSectionProps {
    title?: string;
    sttModels: IRunSetupSttModelOption[];
    sttModelId: string;
    setSttModelId: Dispatch<SetStateAction<string>>;
    sttLanguage: string;
    setSttLanguage: Dispatch<SetStateAction<string>>;
    sttConfig: Record<string, unknown>;
    setSttConfig: Dispatch<SetStateAction<Record<string, unknown>>>;
    transliterationEnabled: boolean;
    setTransliterationEnabled: Dispatch<SetStateAction<boolean>>;
    transliterationModelId: string;
    setTransliterationModelId: Dispatch<SetStateAction<string>>;
    transliterationTargetLanguage: string;
    setTransliterationTargetLanguage: Dispatch<SetStateAction<string>>;
    transliterationPrompt: string;
    setTransliterationPrompt: Dispatch<SetStateAction<string>>;
    transliterationTemperature: string;
    setTransliterationTemperature: Dispatch<SetStateAction<string>>;
    evaluatorEnabled: boolean;
    setEvaluatorEnabled: Dispatch<SetStateAction<boolean>>;
    evaluatorModelId: string;
    setEvaluatorModelId: Dispatch<SetStateAction<string>>;
    evaluatorRubric: string;
    setEvaluatorRubric: Dispatch<SetStateAction<string>>;
    evaluatorReasoningEffort: ReasoningEffort | "default";
    setEvaluatorReasoningEffort: Dispatch<
        SetStateAction<ReasoningEffort | "default">
    >;
    error?: string;
}

export function AudioTranscriptionSection({
    title,
    sttModels,
    sttModelId,
    setSttModelId,
    sttLanguage,
    setSttLanguage,
    sttConfig,
    setSttConfig,
    transliterationEnabled,
    setTransliterationEnabled,
    transliterationModelId,
    setTransliterationModelId,
    transliterationTargetLanguage,
    setTransliterationTargetLanguage,
    transliterationPrompt,
    setTransliterationPrompt,
    transliterationTemperature,
    setTransliterationTemperature,
    evaluatorEnabled,
    setEvaluatorEnabled,
    evaluatorModelId,
    setEvaluatorModelId,
    evaluatorRubric,
    setEvaluatorRubric,
    evaluatorReasoningEffort,
    setEvaluatorReasoningEffort,
    error,
}: IAudioTranscriptionSectionProps) {
    const selectedSttModel = sttModels.find((model) => model.id === sttModelId);
    const supportsLanguage = sttModelSupportsLanguage(sttModelId);
    const runConfig = sttRunConfig({
        model: selectedSttModel,
        modelId: sttModelId,
        language: supportsLanguage ? sttLanguage : "",
        config: sttConfig,
        transliteration: {
            enabled: transliterationEnabled,
            modelId: transliterationModelId,
            targetLanguage: transliterationTargetLanguage,
            prompt: transliterationPrompt,
            temperature: transliterationTemperature,
        },
        evaluator: {
            enabled: evaluatorEnabled,
            modelId: evaluatorModelId,
            rubricPrompt: evaluatorRubric,
            reasoningEffort: evaluatorReasoningEffort,
        },
    });

    return (
        <>
            <input type="hidden" name="sttModelId" value={sttModelId} />
            <input
                type="hidden"
                name="sttLanguage"
                value={supportsLanguage ? sttLanguage : ""}
            />
            <input
                type="hidden"
                name="sttConfig"
                value={runConfig ? JSON.stringify(runConfig) : ""}
            />

            <Card>
                <CardHeader>
                    <CardTitle as="h2">
                        {title ?? (
                            <>
                                {/* 2a. is the run-mode choice just above. */}
                                <span className="text-muted-foreground">
                                    2b.
                                </span>{" "}
                                STT model under test
                            </>
                        )}
                    </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    <SttModelPicker
                        models={sttModels}
                        selectedModel={selectedSttModel}
                        value={sttModelId}
                        onChange={setSttModelId}
                        error={error}
                    />
                    <SttConfigFields
                        model={selectedSttModel}
                        language={sttLanguage}
                        config={sttConfig}
                        onLanguageChange={setSttLanguage}
                        onConfigChange={setSttConfig}
                    />
                    <TransliterationSettings
                        enabled={transliterationEnabled}
                        setEnabled={setTransliterationEnabled}
                        modelId={transliterationModelId}
                        setModelId={setTransliterationModelId}
                        targetLanguage={transliterationTargetLanguage}
                        setTargetLanguage={setTransliterationTargetLanguage}
                        prompt={transliterationPrompt}
                        setPrompt={setTransliterationPrompt}
                        temperature={transliterationTemperature}
                        setTemperature={setTransliterationTemperature}
                    />
                    <TranscriptJudgeSettings
                        enabled={evaluatorEnabled}
                        setEnabled={setEvaluatorEnabled}
                        modelId={evaluatorModelId}
                        setModelId={setEvaluatorModelId}
                        rubric={evaluatorRubric}
                        setRubric={setEvaluatorRubric}
                        reasoningEffort={evaluatorReasoningEffort}
                        setReasoningEffort={setEvaluatorReasoningEffort}
                    />
                </CardContent>
            </Card>
        </>
    );
}

export function SttModelPicker({
    models,
    selectedModel,
    value,
    onChange,
    error,
    id = "sttModelId",
}: {
    models: IRunSetupSttModelOption[];
    selectedModel: IRunSetupSttModelOption | undefined;
    value: string;
    onChange: (value: string) => void;
    error?: string;
    id?: string;
}) {
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>
                STT model
                <span className="text-error" aria-hidden="true">
                    {" "}
                    *
                </span>
            </Label>
            <Select
                value={value}
                onValueChange={onChange}
                disabled={models.length === 0}
            >
                <SelectTrigger id={id}>
                    <SelectValue placeholder="Choose an STT model" />
                </SelectTrigger>
                <SelectContent>
                    {models.map((model) => (
                        <SelectItem
                            key={model.id}
                            value={model.id}
                            disabled={!model.available}
                        >
                            {model.providerLabel}: {model.label}
                            {!model.available
                                ? ` (${model.unavailableReason ?? "unavailable"})`
                                : ""}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-copy-14 text-muted-foreground">
                This is the speech-to-text model being evaluated for the audio
                run. Transcript metrics and the optional transcript judge score
                this output.
            </p>
            {selectedModel?.unavailableReason && (
                <p className="text-copy-14 text-error">
                    {selectedModel.unavailableReason}
                </p>
            )}
            {selectedModel && (
                <p className="text-copy-14 text-muted-foreground">
                    {[
                        selectedModel.providerLabel,
                        selectedModel.outputKind
                            ? outputKindLabel(selectedModel.outputKind)
                            : undefined,
                        selectedModel.routeId,
                    ]
                        .filter(Boolean)
                        .join(" / ")}
                </p>
            )}
            {selectedModel?.configFields &&
                selectedModel.configFields.length > 0 && (
                    <p className="text-copy-14 text-muted-foreground">
                        Configurable:{" "}
                        {selectedModel.configFields
                            .map((field) => field.label)
                            .join(", ")}
                    </p>
                )}
            {error && <p className="text-copy-14 text-error">{error}</p>}
        </div>
    );
}

export function TransliterationSettings({
    enabled,
    setEnabled,
    modelId,
    setModelId,
    targetLanguage,
    setTargetLanguage,
    prompt,
    setPrompt,
    temperature,
    setTemperature,
}: {
    enabled: boolean;
    setEnabled: Dispatch<SetStateAction<boolean>>;
    modelId: string;
    setModelId: Dispatch<SetStateAction<string>>;
    targetLanguage: string;
    setTargetLanguage: Dispatch<SetStateAction<string>>;
    prompt: string;
    setPrompt: Dispatch<SetStateAction<string>>;
    temperature: string;
    setTemperature: Dispatch<SetStateAction<string>>;
}) {
    return (
        <Card variant="inset" className="flex flex-col gap-3 p-3">
            <label
                htmlFor="stt-transliteration-enabled"
                className="flex items-center gap-2 text-copy-14"
            >
                <Checkbox
                    id="stt-transliteration-enabled"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                />
                <span className="text-label-14 text-on-surface">
                    Create Latin transcript variant
                </span>
            </label>
            {enabled && (
                <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="stt-transliteration-model">
                            Transliteration model
                        </Label>
                        <Input
                            id="stt-transliteration-model"
                            value={modelId}
                            onChange={(event) => setModelId(event.target.value)}
                            className="text-mono-13"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="stt-transliteration-language">
                            Transcript language
                        </Label>
                        <Input
                            id="stt-transliteration-language"
                            value={targetLanguage}
                            onChange={(event) =>
                                setTargetLanguage(event.target.value)
                            }
                            placeholder="hi-Latn"
                        />
                    </div>
                    <div className="flex flex-col gap-2 md:col-span-2">
                        <Label htmlFor="stt-transliteration-prompt">
                            Transliteration prompt
                        </Label>
                        <Textarea
                            id="stt-transliteration-prompt"
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder="Keep English words as English and convert Hindi to Latin script."
                            className="min-h-24"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="stt-transliteration-temperature">
                            Transliteration temperature
                        </Label>
                        <Input
                            id="stt-transliteration-temperature"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max="2"
                            step="0.1"
                            value={temperature}
                            onChange={(event) =>
                                setTemperature(event.target.value)
                            }
                            placeholder="provider default"
                        />
                    </div>
                </div>
            )}
        </Card>
    );
}

export function TranscriptJudgeSettings({
    enabled,
    setEnabled,
    modelId,
    setModelId,
    rubric,
    setRubric,
    reasoningEffort,
    setReasoningEffort,
}: {
    enabled: boolean;
    setEnabled: Dispatch<SetStateAction<boolean>>;
    modelId: string;
    setModelId: Dispatch<SetStateAction<string>>;
    rubric: string;
    setRubric: Dispatch<SetStateAction<string>>;
    reasoningEffort: ReasoningEffort | "default";
    setReasoningEffort: Dispatch<SetStateAction<ReasoningEffort | "default">>;
}) {
    return (
        <Card variant="inset" className="flex flex-col gap-3 p-3">
            <label
                htmlFor="stt-evaluator-enabled"
                className="flex items-center gap-2 text-copy-14"
            >
                <Checkbox
                    id="stt-evaluator-enabled"
                    checked={enabled}
                    onChange={(event) => setEnabled(event.target.checked)}
                />
                <span className="text-label-14 text-on-surface">
                    Run transcript judge
                </span>
            </label>
            {enabled && (
                <div className="grid gap-4">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="stt-evaluator-model">Judge model</Label>
                        <Input
                            id="stt-evaluator-model"
                            value={modelId}
                            onChange={(event) => setModelId(event.target.value)}
                            className="text-mono-13"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="stt-evaluator-reasoning">
                            Transcript judge reasoning
                        </Label>
                        <Select
                            value={reasoningEffort}
                            onValueChange={(value) =>
                                setReasoningEffort(
                                    value as ReasoningEffort | "default",
                                )
                            }
                        >
                            <SelectTrigger id="stt-evaluator-reasoning">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="default">
                                    Provider default
                                </SelectItem>
                                {REASONING_EFFORT_OPTIONS.map((level) => (
                                    <SelectItem key={level} value={level}>
                                        {REASONING_EFFORT_LABELS[level]}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="stt-evaluator-rubric">
                            Transcript judge rubric
                        </Label>
                        <Textarea
                            id="stt-evaluator-rubric"
                            value={rubric}
                            onChange={(event) => setRubric(event.target.value)}
                            placeholder="Score semantic accuracy, hallucinations, code-switch capture, domain terms, and speaker attribution from 0 to 1."
                            className="min-h-28"
                        />
                    </div>
                </div>
            )}
        </Card>
    );
}

export function sttRunConfig({
    model,
    modelId,
    language,
    config,
    transliteration,
    evaluator,
}: {
    model: IRunSetupSttModelOption | undefined;
    modelId: string;
    language: string;
    config: Record<string, unknown>;
    transliteration: {
        enabled: boolean;
        modelId: string;
        targetLanguage: string;
        prompt: string;
        temperature: string;
    };
    evaluator: {
        enabled: boolean;
        modelId: string;
        rubricPrompt: string;
        reasoningEffort: ReasoningEffort | "default";
    };
}): ISttRunConfig | undefined {
    if (!modelId) return undefined;
    const filtered = configForSttSnapshot(config, model);
    return {
        modelId,
        ...(model?.providerId ? { providerId: model.providerId } : {}),
        ...(model?.routeId ? { routeId: model.routeId } : {}),
        ...(language.trim() ? { language: language.trim() } : {}),
        ...(Object.keys(filtered).length > 0 ? { config: filtered } : {}),
        ...transliterationConfigForSnapshot(transliteration),
        ...evaluatorConfigForSnapshot(evaluator),
    };
}

function transliterationConfigForSnapshot(input: {
    enabled: boolean;
    modelId: string;
    targetLanguage: string;
    prompt: string;
    temperature: string;
}): Pick<ISttRunConfig, "transcriptVariant" | "transliteration"> {
    if (!input.enabled) return { transcriptVariant: "raw" };

    const temperature = finiteTemperature(input.temperature);
    return {
        transcriptVariant: "latin",
        transliteration: {
            enabled: true,
            targetScript: "latin",
            modelId: input.modelId.trim() || "gpt-4o-mini",
            ...(input.targetLanguage.trim()
                ? { targetLanguage: input.targetLanguage.trim() }
                : {}),
            ...(input.prompt.trim() ? { prompt: input.prompt.trim() } : {}),
            ...(temperature !== undefined ? { temperature } : {}),
        },
    };
}

function evaluatorConfigForSnapshot(input: {
    enabled: boolean;
    modelId: string;
    rubricPrompt: string;
    reasoningEffort: ReasoningEffort | "default";
}): Pick<ISttRunConfig, "evaluator"> {
    if (!input.enabled) return {};
    return {
        evaluator: {
            enabled: true,
            modelId: input.modelId.trim() || "gpt-4o-mini",
            rubricPrompt: input.rubricPrompt.trim(),
            ...(input.reasoningEffort !== "default"
                ? { reasoningEffort: input.reasoningEffort }
                : {}),
        },
    };
}

function outputKindLabel(
    kind: NonNullable<IRunSetupSttModelOption["outputKind"]>,
) {
    if (kind === "diarized_transcript") return "diarized transcript";
    if (kind === "audio_understanding_transcript") {
        return "audio-understanding transcript";
    }
    return "plain transcript";
}

const REASONING_EFFORT_OPTIONS: ReasoningEffort[] = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
];

function finiteTemperature(value: string): number | undefined {
    if (!value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}
