"use client";

import { PendingFieldset } from "@/components/ui/pending-fieldset";
import { useActionState, useState } from "react";
import type {
    AudioRunMode,
    IRunConfigSnapshot,
    IRunSetupBundleOption,
    IRunSetupDatasetOption,
    IRunSetupJudgePromptOption,
    IRunSetupModelOption,
    IRunSetupSttModelOption,
    IRunSetupVersionOption,
} from "@mosaic/api-contract";
import type { IActionState } from "@/app/actions";
import { RunFormHiddenInputs } from "./run-form-hidden-inputs";
import { RunSetupHeader } from "./run-form-basics";
import { RunModeSections } from "./run-mode-sections";
import { RunReviewSection } from "./run-review-section";
import { useAudioTranscriptionController } from "./use-audio-transcription-controller";
import { useSttVariantsController } from "./use-stt-variants-controller";
import { useFocusFirstRunError } from "./use-focus-first-run-error";
import { usePromptEvalRunController } from "./use-prompt-eval-run-controller";

export type IModelOption = IRunSetupModelOption;

interface INewRunFormProps {
    datasets: IRunSetupDatasetOption[];
    bundles: IRunSetupBundleOption[];
    versionOptions: IRunSetupVersionOption[];
    availableModels: IRunSetupModelOption[];
    modelsDegraded: boolean;
    sttModels: IRunSetupSttModelOption[];
    defaultDatasetId?: string;
    defaultPromptVersionId?: string;
    defaultModels?: string[];
    sourceRunId?: string;
    initialRunConfig?: IRunConfigSnapshot;
    hasPrompt: boolean;
    judgePrompts: IRunSetupJudgePromptOption[];
    createRunAction: (
        previousState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    generateJudgeAction: (
        promptVersionId: string,
        datasetId: string,
    ) => Promise<
        { ok: true; rubricPrompt: string } | { ok: false; error: string }
    >;
}

function initialAudioSettings(snapshot?: IRunConfigSnapshot) {
    const variants = Object.values(snapshot?.sttVariants ?? {});
    if (variants.length === 0 && snapshot?.sttConfig) {
        variants.push({
            variantKey: "v1",
            label: "Variant 1",
            config: snapshot.sttConfig,
        });
    }
    const mode: AudioRunMode =
        snapshot?.audioRunMode === "prompt_eval"
            ? "prompt_eval"
            : "stt_metrics";
    return {
        mode,
        variants,
        config: snapshot?.sttConfig ?? variants[0]?.config,
    };
}

function runCanSubmit({
    selectedDataset,
    usesPromptEval,
    promptVersionId,
    hasPrompt,
    hasPromptVersions,
    modelCount,
    selectedSttModel,
}: {
    selectedDataset: IRunSetupDatasetOption | undefined;
    usesPromptEval: boolean;
    promptVersionId: string;
    hasPrompt: boolean;
    hasPromptVersions: boolean;
    modelCount: number;
    selectedSttModel: IRunSetupSttModelOption | undefined;
}) {
    const hasItems = (selectedDataset?.itemCount ?? 0) > 0;
    const hasGoldenLabels =
        selectedDataset?.purpose !== "golden" ||
        (selectedDataset.labeledItemCount ?? 0) > 0;
    const promptReady =
        !usesPromptEval ||
        (Boolean(promptVersionId) &&
            hasPrompt &&
            hasPromptVersions &&
            modelCount > 0);
    const transcriptionReady =
        selectedDataset?.modality !== "audio" ||
        Boolean(selectedSttModel?.available);
    return hasItems && hasGoldenLabels && promptReady && transcriptionReady;
}

export function NewRunForm({
    datasets,
    bundles,
    versionOptions,
    availableModels,
    modelsDegraded,
    sttModels,
    defaultDatasetId,
    defaultPromptVersionId,
    defaultModels,
    sourceRunId,
    initialRunConfig,
    hasPrompt,
    judgePrompts,
    createRunAction,
    generateJudgeAction,
}: INewRunFormProps) {
    const [runState, createRunFormAction] = useActionState(createRunAction, {});
    useFocusFirstRunError(runState.fieldErrors);
    const [datasetId, setDatasetId] = useState(
        defaultDatasetId ?? datasets[0]?.id ?? "",
    );
    const initialAudio = initialAudioSettings(initialRunConfig);
    const [audioRunMode, setAudioRunMode] = useState(initialAudio.mode);
    const selectedDataset = datasets.find(
        (dataset) => dataset.id === datasetId,
    );
    const selectedDatasetIsAudio = selectedDataset?.modality === "audio";
    const usesPromptEval =
        !selectedDatasetIsAudio || audioRunMode === "prompt_eval";
    const promptEval = usePromptEvalRunController({
        availableModels,
        bundles,
        versionOptions,
        defaultPromptVersionId,
        defaultModels,
        selectedDataset,
        generateJudgeAction,
        datasetId,
    });
    const audioController = useAudioTranscriptionController(
        sttModels,
        initialAudio.config,
    );
    const sttVariantsController = useSttVariantsController(
        sttModels,
        initialAudio.variants,
    );
    const firstVariantModel = sttModels.find(
        (model) => model.id === sttVariantsController.variants[0]?.modelId,
    );
    const modelList = usesPromptEval ? promptEval.selectedModels : [];
    const canSubmit = runCanSubmit({
        selectedDataset,
        usesPromptEval,
        promptVersionId: promptEval.promptVersionId,
        hasPrompt,
        hasPromptVersions: versionOptions.length > 0,
        modelCount: modelList.length,
        selectedSttModel: usesPromptEval
            ? audioController.selectedSttModel
            : firstVariantModel,
    });

    return (
        <div>
            <form action={createRunFormAction}>
                <PendingFieldset className="flex flex-col gap-6">
                    <RunFormHiddenInputs
                        fieldConfigs={
                            usesPromptEval ? promptEval.fieldConfigs : []
                        }
                        audioRunMode={
                            selectedDatasetIsAudio
                                ? audioRunMode
                                : "prompt_eval"
                        }
                        promptAssignments={
                            usesPromptEval ? promptEval.promptAssignments : []
                        }
                        reasoningConfigs={
                            usesPromptEval ? promptEval.reasoningConfigs : []
                        }
                        transportAssignments={
                            usesPromptEval
                                ? promptEval.transportAssignments
                                : []
                        }
                        models={modelList}
                        sourceRunId={sourceRunId}
                    />
                    <RunSetupHeader
                        datasets={datasets}
                        datasetId={datasetId}
                        onDatasetChange={setDatasetId}
                        usesPromptEval={usesPromptEval}
                        versionOptions={versionOptions}
                        promptVersionId={promptEval.promptVersionId}
                        onPromptVersionChange={promptEval.selectPromptVersion}
                        audioRunMode={audioRunMode}
                        onAudioRunModeChange={setAudioRunMode}
                    />
                    <RunModeSections
                        selectedDatasetIsAudio={selectedDatasetIsAudio}
                        selectedDataset={selectedDataset}
                        usesPromptEval={usesPromptEval}
                        audioRunMode={audioRunMode}
                        onAudioRunModeChange={setAudioRunMode}
                        audioController={audioController}
                        sttVariantsController={sttVariantsController}
                        promptEvalController={promptEval}
                        availableModels={availableModels}
                        versionOptions={versionOptions}
                        modelsDegraded={modelsDegraded}
                        judgePrompts={judgePrompts}
                        fieldErrors={runState.fieldErrors}
                    />
                    <RunReviewSection
                        selectedDataset={selectedDataset}
                        selectedSttModel={
                            usesPromptEval
                                ? audioController.selectedSttModel
                                : firstVariantModel
                        }
                        usesPromptEval={usesPromptEval}
                        evaluationModelCount={
                            usesPromptEval
                                ? modelList.length
                                : sttVariantsController.variants.length
                        }
                        canSubmit={canSubmit}
                        formError={runState.formError}
                    />
                </PendingFieldset>
            </form>
        </div>
    );
}
