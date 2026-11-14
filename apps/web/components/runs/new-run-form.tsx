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
    ProviderTransport,
} from "@flash-evals/api-contract";
import type { IActionState } from "@/app/actions";
import { useBenchmarkForm } from "./benchmark-settings";
import { RunBenchmarkSection } from "./run-benchmark-section";
import { ItemFilterFields } from "./item-filter-fields";
import type { ProposeTaskMapAction } from "./run-benchmark-controls";
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
    /** Providers with a key, from Settings or the repo's .env files. */
    savedKeyProviders?: ProviderTransport[];
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
    /** Has a model draft the benchmark Task Map; the button is hidden without it. */
    proposeTaskMapAction?: ProposeTaskMapAction;
}

/** A rerun keeps the data rules of the run it repeats. */
function rerunDataPolicy(snapshot: IRunConfigSnapshot | undefined) {
    return snapshot?.dataPolicy;
}

/** Whether the dataset's stored answers can serve as the benchmark. */
function hasStoredAnswers(dataset: IRunSetupDatasetOption | undefined) {
    return dataset?.purpose === "golden" && (dataset.labeledItemCount ?? 0) > 0;
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
    readyModelCount,
    benchmarkProblemCount,
    selectedSttModel,
}: {
    selectedDataset: IRunSetupDatasetOption | undefined;
    usesPromptEval: boolean;
    promptVersionId: string;
    hasPrompt: boolean;
    hasPromptVersions: boolean;
    /** Selected models, or 0 when any has no provider key in Settings. */
    readyModelCount: number;
    benchmarkProblemCount: number;
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
            readyModelCount > 0);
    const transcriptionReady =
        selectedDataset?.modality !== "audio" ||
        Boolean(selectedSttModel?.available);
    return (
        hasItems &&
        hasGoldenLabels &&
        promptReady &&
        transcriptionReady &&
        benchmarkProblemCount === 0
    );
}

export function NewRunForm({
    datasets,
    bundles,
    versionOptions,
    availableModels,
    modelsDegraded,
    savedKeyProviders,
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
    proposeTaskMapAction,
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
    // Benchmark comparison is offered with the judge section: text and
    // image prompt runs.
    const showBenchmark = !selectedDatasetIsAudio;
    const storedAnswersAvailable = hasStoredAnswers(selectedDataset);
    const benchmark = useBenchmarkForm({
        show: showBenchmark,
        storedAnswersAvailable,
        versionOptions,
        promptVersionId: promptEval.promptVersionId,
        modelCount: modelList.length,
        availableModels,
        defaultJudgeModelId: promptEval.judgeModelId,
        rerunConfig: initialRunConfig,
    });
    const canSubmit = runCanSubmit({
        selectedDataset,
        usesPromptEval,
        promptVersionId: promptEval.promptVersionId,
        hasPrompt,
        hasPromptVersions: versionOptions.length > 0,
        readyModelCount: promptEval.readyModelCount,
        benchmarkProblemCount: benchmark.problems.length,
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
                        // Speech-to-text metric runs make no model calls, so
                        // their request leaves temperatures out.
                        temperatureAssignments={
                            promptEval.temperatureAssignments
                        }
                        transportAssignments={
                            usesPromptEval
                                ? promptEval.transportAssignments
                                : []
                        }
                        models={modelList}
                        sourceRunId={sourceRunId}
                        benchmark={benchmark.request}
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
                        savedKeyProviders={savedKeyProviders}
                        initialDataPolicy={rerunDataPolicy(initialRunConfig)}
                        judgePrompts={judgePrompts}
                        fieldErrors={runState.fieldErrors}
                    />
                    {showBenchmark && (
                        <RunBenchmarkSection
                            state={benchmark.state}
                            onChange={benchmark.setState}
                            selectedModels={modelList}
                            benchmarkModel={promptEval.effectiveReference}
                            onBenchmarkModelChange={
                                promptEval.setReferenceModel
                            }
                            availableModels={availableModels}
                            outputSchema={benchmark.outputSchema}
                            errors={benchmark.problems}
                            serverError={runState.fieldErrors?.benchmark?.[0]}
                            promptVersionId={promptEval.promptVersionId}
                            proposeTaskMapAction={proposeTaskMapAction}
                            canUseStoredAnswers={storedAnswersAvailable}
                        />
                    )}
                    {/* Task filters need the benchmark; a path filter kept
                        from the repeated run shows on any run. */}
                    <ItemFilterFields
                        tasks={
                            showBenchmark && benchmark.state.enabled
                                ? benchmark.state.taskMap.tasks
                                : []
                        }
                        initial={initialRunConfig?.itemFilter}
                    />
                    <RunReviewSection
                        selectedDataset={selectedDataset}
                        selectedSttModel={
                            usesPromptEval
                                ? audioController.selectedSttModel
                                : firstVariantModel
                        }
                        sttVolumeLevelled={
                            audioController.audioTranscriptionProps
                                .sttLevelVolume
                        }
                        usesPromptEval={usesPromptEval}
                        evaluationModelCount={
                            usesPromptEval
                                ? modelList.length
                                : sttVariantsController.variants.length
                        }
                        canSubmit={canSubmit}
                        formError={runState.formError}
                        fieldErrors={runState.fieldErrors}
                    />
                </PendingFieldset>
            </form>
        </div>
    );
}
