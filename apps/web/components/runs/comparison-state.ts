"use client";

import { useState } from "react";
import {
    pipelineSetupLabel,
    proposeTaskMapFromSchema,
    taskMapNeedsJudge,
    type IRunSetupDatasetOption,
    type IRunSetupModelOption,
    type IRunSetupVersionOption,
    type ISetupComparisonPipelineOption,
    type ProviderTransport,
} from "@flash-evals/api-contract";
import {
    benchmarkErrors,
    benchmarkJudgeTransport,
    DEFAULT_MAX_DROP_POINTS,
    initialBenchmarkState,
    type IBenchmarkFormState,
} from "./benchmark-settings";
import { estimateComparison } from "./comparison-estimate";
import { filterableTasks, NO_FILTER } from "./item-filter-fields";
import { usableTransport } from "./use-prompt-eval-run-controller";
import { transportLabel } from "@/lib/transport";

export type Step = 1 | 2 | 3 | 4;

export const STEPS: Array<{ step: Step; title: string }> = [
    { step: 1, title: "What runs today" },
    { step: 2, title: "What must stay the same" },
    { step: 3, title: "Setups to try" },
    { step: 4, title: "Check and start" },
];

export const DEFAULT_PILOT = 20;
export const DEFAULT_MAX_TOKENS = 8_000;

/** A model can be chosen when a provider with a key lists it. */
export function runnable(model: IRunSetupModelOption): boolean {
    return model.available && model.transports.length > 0;
}

export function datasetLabel(dataset: IRunSetupDatasetOption): string {
    const n = dataset.itemCount;
    return `${dataset.name} (${n} transcript${n === 1 ? "" : "s"})`;
}

export function storedAnswers(
    dataset: IRunSetupDatasetOption | undefined,
): boolean {
    return (dataset?.labeledItemCount ?? 0) > 0;
}

export function freshBenchmark(
    version: IRunSetupVersionOption | undefined,
    judgeModelId: string,
): IBenchmarkFormState {
    return {
        ...initialBenchmarkState(judgeModelId),
        enabled: true,
        taskMap: version?.outputSchema
            ? proposeTaskMapFromSchema(version.outputSchema)
            : { tasks: [] },
        maxDropPts: String(DEFAULT_MAX_DROP_POINTS),
    };
}

export interface IComparisonInputs {
    datasets: IRunSetupDatasetOption[];
    versionOptions: IRunSetupVersionOption[];
    availableModels: IRunSetupModelOption[];
    /** Saved pipelines; those that read the chosen dataset are offered. */
    pipelines?: ISetupComparisonPipelineOption[];
}

/** Pipelines that can run on a dataset: bound to it, or to any text dataset. */
export function pipelinesForDataset(
    pipelines: ISetupComparisonPipelineOption[] | undefined,
    datasetId: string,
): ISetupComparisonPipelineOption[] {
    return (pipelines ?? []).filter(
        (pipeline) =>
            pipeline.datasetId === undefined ||
            pipeline.datasetId === datasetId,
    );
}

/** "Chain (model-a → model-b)", with model names where they are known. */
export function pipelineLabel(
    pipeline: ISetupComparisonPipelineOption,
    find: (id: string) => IRunSetupModelOption | undefined,
): string {
    return pipelineSetupLabel(
        pipeline.name,
        pipeline.steps.flatMap((step) =>
            step.modelId ? [find(step.modelId)?.label ?? step.modelId] : [],
        ),
    );
}

/** Everything the four steps edit. */
export function useComparisonState({
    datasets,
    versionOptions,
    availableModels,
}: IComparisonInputs) {
    const textDatasets = datasets.filter((d) => d.modality !== "audio");
    const judgeDefault =
        availableModels.find(
            (m) => runnable(m) && m.judgeSuitable && m.structuredOutput,
        )?.id ?? "";
    const [step, setStep] = useState<Step>(1);
    const [datasetId, setDatasetId] = useState(textDatasets[0]?.id ?? "");
    const [versionId, setVersionId] = useState(versionOptions[0]?.id ?? "");
    const [referenceId, setReferenceId] = useState("");
    const [candidates, setCandidates] = useState<string[]>([]);
    const [pipelineIds, setPipelineIds] = useState<string[]>([]);
    const [transportByModel, setTransportByModel] = useState<
        Record<string, ProviderTransport>
    >({});
    const [benchmark, setBenchmark] = useState(() =>
        freshBenchmark(versionOptions[0], judgeDefault),
    );
    const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_TOKENS));
    const [pilot, setPilot] = useState(true);
    const [pilotSize, setPilotSize] = useState(String(DEFAULT_PILOT));
    const [itemFilter, setItemFilter] = useState({
        taskKey: NO_FILTER,
        equals: "",
    });
    return {
        textDatasets,
        step,
        setStep,
        datasetId,
        setDatasetId,
        versionId,
        referenceId,
        candidates,
        pipelineIds,
        transportByModel,
        benchmark,
        setBenchmark,
        maxTokens,
        setMaxTokens,
        pilot,
        setPilot,
        pilotSize,
        setPilotSize,
        itemFilter,
        setItemFilter,
        chooseVersion: (id: string) => {
            setVersionId(id);
            setBenchmark(
                freshBenchmark(
                    versionOptions.find((v) => v.id === id),
                    benchmark.judgeModelId || judgeDefault,
                ),
            );
        },
        chooseReference: (id: string) => {
            setReferenceId(id);
            setCandidates((previous) => previous.filter((c) => c !== id));
        },
        togglePipeline: (id: string) =>
            setPipelineIds((previous) =>
                previous.includes(id)
                    ? previous.filter((p) => p !== id)
                    : [...previous, id],
            ),
        toggleCandidate: (id: string) =>
            setCandidates((previous) =>
                previous.includes(id)
                    ? previous.filter((c) => c !== id)
                    : [...previous, id],
            ),
        setTransport: (id: string, transport: ProviderTransport) =>
            setTransportByModel((previous) => ({
                ...previous,
                [id]: transport,
            })),
    };
}

export type ComparisonState = ReturnType<typeof useComparisonState>;

/** A label filter the start step sends: a one-field task and a label. */
export interface IActiveItemFilter {
    taskName: string;
    path: string;
    equals: string;
}

/** How many items the filter keeps, as the API counted them. */
export type ItemFilterCount =
    | { status: "loading" }
    | { status: "done"; matching: number }
    | { status: "error"; error: string };

/** The filter the form will send, or undefined while every item runs. */
export function activeItemFilter(
    state: Pick<ComparisonState, "itemFilter" | "benchmark">,
): IActiveItemFilter | undefined {
    const equals = state.itemFilter.equals.trim();
    const task = filterableTasks(state.benchmark.taskMap.tasks).find(
        (option) => option.key === state.itemFilter.taskKey,
    );
    return task && equals !== ""
        ? { taskName: task.name, path: task.path, equals }
        : undefined;
}

/** What the estimate says about a label filter's items. */
export function itemFilterNote(
    filter: IActiveItemFilter | undefined,
    count: ItemFilterCount | undefined,
    datasetItems: number,
): string | undefined {
    if (!filter) return undefined;
    const label = `labelled "${filter.equals}" for ${filter.taskName}`;
    if (count?.status === "loading") return `Counting the items ${label}…`;
    if (count?.status === "done")
        return count.matching === 0
            ? `No transcript is ${label}, so the run would be refused. Change the label or choose All items.`
            : `Only transcripts ${label}: ${count.matching} of ${datasetItems}.`;
    const reason = count?.status === "error" ? ` (${count.error})` : "";
    return `Couldn't count the transcripts ${label}${reason}; the estimate counts all ${datasetItems}.`;
}

/** Values worked out from the state: selections, readiness, estimates. */
export function comparisonView(
    state: ComparisonState,
    inputs: IComparisonInputs,
    itemFilterCount?: ItemFilterCount,
) {
    const dataset = state.textDatasets.find((d) => d.id === state.datasetId);
    const version = inputs.versionOptions.find((v) => v.id === state.versionId);
    const find = (id: string) =>
        inputs.availableModels.find((m) => m.id === id);
    const transportOf = (id: string) =>
        usableTransport(find(id), state.transportByModel[id]);
    const models = state.referenceId
        ? [state.referenceId, ...state.candidates]
        : state.candidates;
    const offeredPipelines = pipelinesForDataset(
        inputs.pipelines,
        state.datasetId,
    );
    // Only chosen pipelines that read this dataset and can be compared.
    const pipelines = offeredPipelines.filter(
        (pipeline) =>
            state.pipelineIds.includes(pipeline.id) &&
            !pipeline.unavailableReason,
    );
    const taskErrors = benchmarkErrors({
        state: state.benchmark,
        schema: version?.outputSchema,
        modelCount: 2,
        storedAnswersAvailable: storedAnswers(dataset),
    });
    const judgeTransport = benchmarkJudgeTransport(
        inputs.availableModels,
        state.benchmark,
    );
    const datasetItems = dataset?.itemCount ?? 0;
    // A label filter runs only the items it keeps, the pilot's among them.
    const itemFilter = activeItemFilter(state);
    const filteredCount =
        itemFilter && itemFilterCount?.status === "done"
            ? itemFilterCount.matching
            : undefined;
    const fullItems = filteredCount ?? datasetItems;
    const items = state.pilot
        ? Math.min(Number(state.pilotSize) || DEFAULT_PILOT, fullItems)
        : fullItems;
    const estimateFor = (count: number) =>
        estimateComparison({
            items: count,
            promptChars: version?.promptChars ?? 0,
            avgInputChars: dataset?.avgInputChars ?? 0,
            maxTokens: Number(state.maxTokens) || DEFAULT_MAX_TOKENS,
            models: models.map((id) => ({ id, transport: transportOf(id) })),
            referenceModelId: state.referenceId,
            availableModels: inputs.availableModels,
            taskMap: state.benchmark.taskMap,
            ...judgeFor(state.benchmark, judgeTransport),
            pipelines: pipelines.map((pipeline) => ({
                id: pipeline.id,
                label: pipelineLabel(pipeline, find),
                steps: pipeline.steps,
            })),
        });
    return {
        dataset,
        version,
        find,
        transportOf,
        models,
        offeredPipelines,
        pipelines,
        taskErrors,
        judgeTransport,
        fullItems,
        items,
        itemFilter,
        itemFilterNote: itemFilterNote(
            itemFilter,
            itemFilterCount,
            datasetItems,
        ),
        /** The filter keeps no item: the run would be refused. */
        itemFilterEmpty: filteredCount === 0,
        estimate: estimateFor(items),
        fullEstimate: estimateFor(fullItems),
    };
}

export type ComparisonView = ReturnType<typeof comparisonView>;

function judgeFor(
    benchmark: IBenchmarkFormState,
    transport: ProviderTransport | undefined,
) {
    return taskMapNeedsJudge(benchmark.taskMap) && benchmark.judgeModelId
        ? { judge: { modelId: benchmark.judgeModelId, transport } }
        : {};
}

/** Whether each step is complete enough to move on. */
export function stepReadiness(
    state: ComparisonState,
    view: ComparisonView,
): Record<Step, boolean> {
    const referenceReady = Boolean(
        state.referenceId && view.transportOf(state.referenceId),
    );
    return {
        1: Boolean(view.dataset && view.version) && referenceReady,
        2:
            view.taskErrors.length === 0 &&
            state.benchmark.taskMap.tasks.length > 0,
        3:
            state.candidates.length + view.pipelines.length > 0 &&
            state.candidates.every((id) => view.transportOf(id)),
        4: true,
    };
}

/** One line per finished step, shown when it's folded. */
export function stepSummaries(
    state: ComparisonState,
    view: ComparisonView,
): Record<1 | 2 | 3, string | undefined> {
    const label = (id: string) => view.find(id)?.label ?? id;
    const transport = view.transportOf(state.referenceId);
    const today =
        view.dataset && view.version && state.referenceId
            ? `${datasetLabel(view.dataset)} · ${view.version.label} · ${label(state.referenceId)}${transport ? ` via ${transportLabel(transport)}` : ""}`
            : undefined;
    const judged =
        taskMapNeedsJudge(state.benchmark.taskMap) &&
        state.benchmark.judgeModelId
            ? ` · judged by ${label(state.benchmark.judgeModelId)}`
            : "";
    return {
        1: today,
        2: `${state.benchmark.taskMap.tasks.length} tasks${judged}`,
        3: setupsSummary(
            state.candidates.map(label),
            view.pipelines.map((pipeline) => pipeline.name),
        ),
    };
}

/** "2 models: A, B", "1 pipeline: C", "1 model and 2 pipelines: A, C, D". */
function setupsSummary(
    models: string[],
    pipelines: string[],
): string | undefined {
    const count = (n: number, noun: string) =>
        `${n} ${noun}${n === 1 ? "" : "s"}`;
    const parts = [
        ...(models.length > 0 ? [count(models.length, "model")] : []),
        ...(pipelines.length > 0 ? [count(pipelines.length, "pipeline")] : []),
    ];
    if (parts.length === 0) return undefined;
    return `${parts.join(" and ")}: ${[...models, ...pipelines].join(", ")}`;
}
