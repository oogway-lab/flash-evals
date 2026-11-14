"use client";

import Link from "next/link";
import { useActionState } from "react";
import type {
    IRunSetupDatasetOption,
    IRunSetupModelOption,
    IRunSetupVersionOption,
    ISetupComparisonPipelineOption,
    ProviderTransport,
} from "@flash-evals/api-contract";
import type { IActionState } from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { serializeBenchmark } from "./benchmark-settings";
import {
    activeItemFilter,
    comparisonView,
    pipelineLabel,
    stepReadiness,
    stepSummaries,
    useComparisonState,
    type ComparisonState,
    type ComparisonView,
} from "./comparison-state";
import {
    CostPanel,
    StepCard,
    StepModels,
    StepStart,
    StepTasks,
    StepToday,
} from "./comparison-steps";
import type { ProposeTaskMapAction } from "./run-benchmark-controls";
import { RunFormHiddenInputs } from "./run-form-hidden-inputs";
import { transportAssignmentFor } from "./provider-select";
import { reasoningConfigForModel } from "./use-prompt-eval-run-controller";
import {
    useItemFilterCount,
    type CountItemFilterAction,
} from "./use-item-filter-count";

/**
 * "Compare setups" in four short steps: what runs today, what must stay
 * the same, which models and pipelines to try, and what it will cost.
 * Submits the full form's fields plus the chosen pipelines; the action
 * starts a setup comparison when pipelines are chosen, else a run.
 */
export function ComparisonSetup({
    datasets,
    versionOptions,
    availableModels,
    pipelines,
    savedKeyProviders,
    createRunAction,
    proposeTaskMapAction,
    countItemFilterAction,
}: {
    datasets: IRunSetupDatasetOption[];
    versionOptions: IRunSetupVersionOption[];
    availableModels: IRunSetupModelOption[];
    pipelines?: ISetupComparisonPipelineOption[];
    savedKeyProviders?: ProviderTransport[];
    createRunAction: (
        previousState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    proposeTaskMapAction?: ProposeTaskMapAction;
    /** Counts a label filter's items so the estimate covers only those. */
    countItemFilterAction?: CountItemFilterAction;
}) {
    const inputs = { datasets, versionOptions, availableModels, pipelines };
    const [runState, formAction] = useActionState(createRunAction, {});
    const state = useComparisonState(inputs);
    const itemFilterCount = useItemFilterCount(
        countItemFilterAction,
        state.datasetId,
        activeItemFilter(state),
    );
    const view = comparisonView(state, inputs, itemFilterCount);
    const ready = stepReadiness(state, view);
    const summary = stepSummaries(state, view);
    const lineFor = (id: string) =>
        [...view.estimate.lines, ...view.estimate.pipelineLines].find(
            (line) => line.modelId === id,
        )?.perCall;
    return (
        <form action={formAction} className="flex flex-col gap-6">
            <ComparisonHiddenInputs
                state={state}
                view={view}
                availableModels={availableModels}
                versionOptions={versionOptions}
            />
            {savedKeyProviders?.length === 0 && <NoKeysWarning />}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
                <ol className="flex flex-col gap-4">
                    <StepCard
                        step={1}
                        current={state.step}
                        done={ready[1]}
                        summary={summary[1]}
                        canContinue={ready[1]}
                        onOpen={state.setStep}
                    >
                        <StepToday
                            datasets={state.textDatasets}
                            datasetId={state.datasetId}
                            onDataset={state.setDatasetId}
                            versions={versionOptions}
                            versionId={state.versionId}
                            onVersion={state.chooseVersion}
                            models={availableModels}
                            referenceId={state.referenceId}
                            onReference={state.chooseReference}
                            transportOf={view.transportOf}
                            onTransport={state.setTransport}
                        />
                    </StepCard>
                    <StepCard
                        step={2}
                        current={state.step}
                        done={ready[2]}
                        summary={summary[2]}
                        canContinue={ready[2]}
                        onOpen={state.setStep}
                    >
                        <StepTasks
                            benchmark={state.benchmark}
                            onChange={state.setBenchmark}
                            version={view.version}
                            dataset={view.dataset}
                            referenceName={view.find(state.referenceId)?.label}
                            errors={view.taskErrors}
                            models={availableModels}
                            judgeTransport={view.judgeTransport}
                            proposeTaskMapAction={proposeTaskMapAction}
                        />
                    </StepCard>
                    <StepCard
                        step={3}
                        current={state.step}
                        done={ready[3]}
                        summary={summary[3]}
                        canContinue={ready[3]}
                        onOpen={state.setStep}
                    >
                        <StepModels
                            models={availableModels}
                            referenceId={state.referenceId}
                            selected={state.candidates}
                            onToggle={state.toggleCandidate}
                            transportOf={view.transportOf}
                            onTransport={state.setTransport}
                            perCall={lineFor}
                            referencePerCall={lineFor(state.referenceId)}
                            pipelines={view.offeredPipelines}
                            selectedPipelines={state.pipelineIds}
                            onTogglePipeline={state.togglePipeline}
                            pipelineLabel={(pipeline) =>
                                pipelineLabel(pipeline, view.find)
                            }
                        />
                    </StepCard>
                    <StepCard
                        step={4}
                        current={state.step}
                        done={false}
                        canContinue={false}
                        onOpen={state.setStep}
                    >
                        <StepStart
                            estimate={view.estimate}
                            fullItems={view.fullItems}
                            fullTotal={view.fullEstimate.total}
                            pilot={state.pilot}
                            onPilot={state.setPilot}
                            pilotSize={state.pilotSize}
                            onPilotSize={state.setPilotSize}
                            maxTokens={state.maxTokens}
                            onMaxTokens={state.setMaxTokens}
                            ready={
                                ready[1] &&
                                ready[2] &&
                                ready[3] &&
                                !view.itemFilterEmpty
                            }
                            state={runState}
                            tasks={state.benchmark.taskMap.tasks}
                            onItemFilter={state.setItemFilter}
                            itemFilterNote={view.itemFilterNote}
                        />
                    </StepCard>
                </ol>
                <CostPanel
                    estimate={view.estimate}
                    pilot={state.pilot}
                    fullItems={view.fullItems}
                    fullTotal={view.fullEstimate.total}
                    itemFilterNote={view.itemFilterNote}
                />
            </div>
        </form>
    );
}

function NoKeysWarning() {
    return (
        <Alert variant="warning">
            <AlertDescription>
                No provider has a key, so no model can run. Add one in{" "}
                <Link href="/settings" className="underline underline-offset-4">
                    Settings
                </Link>{" "}
                or the repo&apos;s .env files.
            </AlertDescription>
        </Alert>
    );
}

/** The same fields the full form submits, from the four steps. */
function ComparisonHiddenInputs({
    state,
    view,
    availableModels,
    versionOptions,
}: {
    state: ComparisonState;
    view: ComparisonView;
    availableModels: IRunSetupModelOption[];
    versionOptions: IRunSetupVersionOption[];
}) {
    return (
        <>
            <RunFormHiddenInputs
                fieldConfigs={view.version?.fieldConfigs ?? []}
                audioRunMode="prompt_eval"
                promptAssignments={view.models.map((modelId) => ({
                    modelId,
                    promptVersionId: state.versionId,
                }))}
                reasoningConfigs={view.models.map((modelId) => ({
                    modelId,
                    reasoningConfig: reasoningConfigForModel(
                        modelId,
                        state.versionId,
                        availableModels,
                        versionOptions,
                    ),
                }))}
                transportAssignments={view.models.flatMap((modelId) =>
                    transportAssignmentFor(
                        availableModels.find((model) => model.id === modelId),
                        modelId,
                        view.transportOf(modelId),
                    ),
                )}
                models={view.models}
                benchmark={serializeBenchmark(
                    state.benchmark,
                    view.judgeTransport,
                )}
            />
            <input type="hidden" name="datasetId" value={state.datasetId} />
            <input
                type="hidden"
                name="promptVersionId"
                value={state.versionId}
            />
            <input
                type="hidden"
                name="referenceModel"
                value={state.referenceId}
            />
            <input type="hidden" name="maxTokens" value={state.maxTokens} />
            {view.pipelines.map((pipeline) => (
                <input
                    key={pipeline.id}
                    type="hidden"
                    name="comparisonPipelineId"
                    value={pipeline.id}
                />
            ))}
            {state.pilot && (
                <input type="hidden" name="itemLimit" value={view.items} />
            )}
        </>
    );
}
