"use client";

import { useState } from "react";
import type {
    IRunSetupSttModelOption,
    ISttRunConfig,
    ReasoningEffort,
} from "@mosaic/api-contract";

function transcriptionInitialState(
    models: IRunSetupSttModelOption[],
    config?: ISttRunConfig,
) {
    return {
        modelId:
            config?.modelId ??
            models.find((model) => model.available)?.id ??
            models[0]?.id ??
            "",
        language: config?.language ?? "",
        config: config?.config ?? {},
    };
}

function transliterationInitialState(config?: ISttRunConfig) {
    const value = config?.transliteration;
    return {
        enabled: value?.enabled ?? false,
        modelId: value?.modelId ?? "gpt-4o-mini",
        targetLanguage: value?.targetLanguage ?? "",
        prompt: value?.prompt ?? "",
        temperature: value?.temperature?.toString() ?? "",
    };
}

function evaluatorInitialState(config?: ISttRunConfig) {
    const value = config?.evaluator;
    return {
        enabled: value?.enabled ?? false,
        modelId: value?.modelId ?? "gpt-4o-mini",
        rubric: value?.rubricPrompt ?? "",
        reasoningEffort: value?.reasoningEffort ?? "default",
    } as const;
}

export function useAudioTranscriptionController(
    sttModels: IRunSetupSttModelOption[],
    initialConfig?: ISttRunConfig,
) {
    const initial = transcriptionInitialState(sttModels, initialConfig);
    const transliteration = transliterationInitialState(initialConfig);
    const evaluator = evaluatorInitialState(initialConfig);
    const [sttModelId, setSttModelId] = useState(initial.modelId);
    const [sttLanguage, setSttLanguage] = useState(initial.language);
    const [sttConfig, setSttConfig] = useState<Record<string, unknown>>(
        initial.config,
    );
    const [transliterationEnabled, setTransliterationEnabled] = useState(
        transliteration.enabled,
    );
    const [transliterationModelId, setTransliterationModelId] = useState(
        transliteration.modelId,
    );
    const [transliterationTargetLanguage, setTransliterationTargetLanguage] =
        useState(transliteration.targetLanguage);
    const [transliterationPrompt, setTransliterationPrompt] = useState(
        transliteration.prompt,
    );
    const [transliterationTemperature, setTransliterationTemperature] =
        useState(transliteration.temperature);
    const [evaluatorEnabled, setEvaluatorEnabled] = useState(evaluator.enabled);
    const [evaluatorModelId, setEvaluatorModelId] = useState(evaluator.modelId);
    const [evaluatorRubric, setEvaluatorRubric] = useState(evaluator.rubric);
    const [evaluatorReasoningEffort, setEvaluatorReasoningEffort] = useState<
        ReasoningEffort | "default"
    >(evaluator.reasoningEffort);

    return {
        selectedSttModel: sttModels.find((model) => model.id === sttModelId),
        audioTranscriptionProps: {
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
        },
    };
}
