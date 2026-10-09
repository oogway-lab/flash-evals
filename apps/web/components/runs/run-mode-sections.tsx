"use client";

import type {
    AudioRunMode,
    IRunSetupDatasetOption,
    IRunSetupJudgePromptOption,
    IRunSetupModelOption,
    IRunSetupVersionOption,
} from "@mosaic/api-contract";
import type { IActionState } from "@/app/actions";
import { AudioRunModeSelector } from "./audio-run-mode-selector";
import { AudioTranscriptionSection } from "./audio-transcription-section";
import { SttVariantsSection } from "./stt-variants-section";
import { PromptEvalModelsSection } from "./prompt-eval-models-section";
import { RunJudgeSection } from "./run-judge-section";
import type { useAudioTranscriptionController } from "./use-audio-transcription-controller";
import type { usePromptEvalRunController } from "./use-prompt-eval-run-controller";
import type { useSttVariantsController } from "./use-stt-variants-controller";

type AudioController = ReturnType<typeof useAudioTranscriptionController>;
type PromptEvalController = ReturnType<typeof usePromptEvalRunController>;
type SttVariantsController = ReturnType<typeof useSttVariantsController>;

export function RunModeSections({
    selectedDatasetIsAudio,
    selectedDataset,
    usesPromptEval,
    audioRunMode,
    onAudioRunModeChange,
    audioController,
    sttVariantsController,
    promptEvalController,
    availableModels,
    versionOptions,
    modelsDegraded,
    judgePrompts,
    fieldErrors,
}: {
    selectedDatasetIsAudio: boolean;
    selectedDataset: IRunSetupDatasetOption | undefined;
    usesPromptEval: boolean;
    audioRunMode: AudioRunMode;
    onAudioRunModeChange: (mode: AudioRunMode) => void;
    audioController: AudioController;
    sttVariantsController: SttVariantsController;
    promptEvalController: PromptEvalController;
    availableModels: IRunSetupModelOption[];
    versionOptions: IRunSetupVersionOption[];
    modelsDegraded: boolean;
    judgePrompts: IRunSetupJudgePromptOption[];
    fieldErrors: IActionState["fieldErrors"];
}) {
    return (
        <>
            {selectedDatasetIsAudio && usesPromptEval && (
                <AudioRunModeSelector
                    audioRunMode={audioRunMode}
                    onAudioRunModeChange={onAudioRunModeChange}
                    step="2a."
                    sttMetricsDescription="Score the transcript directly."
                    promptEvalDescription="Also evaluate downstream prompt output."
                />
            )}
            {selectedDatasetIsAudio && usesPromptEval && (
                <AudioTranscriptionSection
                    {...audioController.audioTranscriptionProps}
                    error={fieldErrors?.sttModelId?.[0]}
                />
            )}
            {selectedDatasetIsAudio && !usesPromptEval && (
                <SttVariantsSection
                    controller={sttVariantsController}
                    evaluation={audioController.audioTranscriptionProps}
                    fieldErrors={fieldErrors}
                />
            )}
            {usesPromptEval && (
                <PromptEvalModelsSection
                    controller={promptEvalController}
                    availableModels={availableModels}
                    versionOptions={versionOptions}
                    selectedDataset={selectedDataset}
                    modelsDegraded={modelsDegraded}
                />
            )}
            {!selectedDatasetIsAudio && (
                <RunJudgeSection
                    controller={promptEvalController}
                    judgePrompts={judgePrompts}
                    availableModels={availableModels}
                    fieldError={fieldErrors?.judgePromptVersionId?.[0]}
                />
            )}
        </>
    );
}
