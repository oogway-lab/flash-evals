"use client";

import { useEffect, useState } from "react";
import type {
    IPipelineFieldConfig,
    IReasoningConfig,
    IRunSetupBundleOption,
    IRunSetupDatasetOption,
    IRunSetupModelOption,
    IRunSetupVersionOption,
    ReasoningEffort,
    ProviderTransport,
} from "@mosaic/api-contract";

interface IProviderModelGroup {
    label: string;
    models: IRunSetupModelOption[];
}

interface IUsePromptEvalRunControllerOptions {
    availableModels: IRunSetupModelOption[];
    bundles: IRunSetupBundleOption[];
    versionOptions: IRunSetupVersionOption[];
    defaultPromptVersionId?: string;
    defaultModels?: string[];
    selectedDataset: IRunSetupDatasetOption | undefined;
    generateJudgeAction: (
        promptVersionId: string,
        datasetId: string,
    ) => Promise<
        { ok: true; rubricPrompt: string } | { ok: false; error: string }
    >;
    datasetId: string;
}

function initialControllerState(options: IUsePromptEvalRunControllerOptions) {
    const promptVersionId =
        options.defaultPromptVersionId &&
        options.versionOptions.some(
            (version) => version.id === options.defaultPromptVersionId,
        )
            ? options.defaultPromptVersionId
            : (options.versionOptions[0]?.id ?? "");
    const models =
        options.defaultModels && options.defaultModels.length > 0
            ? options.defaultModels
            : defaultSelection(options.availableModels);
    const providerGroups = modelsByProvider(options.availableModels);
    return {
        promptVersionId,
        models,
        providerGroups,
        providerLabel:
            options.availableModels.find((model) => models.includes(model.id))
                ?.providerLabel ??
            providerGroups[0]?.label ??
            "",
        fieldConfigs:
            options.versionOptions.find(
                (version) => version.id === promptVersionId,
            )?.fieldConfigs ??
            options.bundles[0]?.fieldConfigs ??
            options.versionOptions[0]?.fieldConfigs ??
            [],
    };
}

function selectedProvider(
    providerGroups: IProviderModelGroup[],
    activeProviderLabel: string,
) {
    const effectiveLabel = providerGroups.some(
        (group) => group.label === activeProviderLabel,
    )
        ? activeProviderLabel
        : (providerGroups[0]?.label ?? "");
    return {
        effectiveLabel,
        models:
            providerGroups.find((group) => group.label === effectiveLabel)
                ?.models ?? [],
    };
}

function selectedModelConfiguration(input: {
    selectedModels: string[];
    availableModels: IRunSetupModelOption[];
    versionOptions: IRunSetupVersionOption[];
    promptByModel: Record<string, string>;
    reasoningByModel: Record<string, ReasoningEffort>;
    transportByModel: Record<string, ProviderTransport>;
    promptVersionId: string;
    referenceModel: string;
}) {
    return {
        customModels: input.selectedModels.filter(
            (id) => !input.availableModels.some((model) => model.id === id),
        ),
        effectiveReference: input.selectedModels.includes(input.referenceModel)
            ? input.referenceModel
            : (input.selectedModels[0] ?? ""),
        promptAssignments: input.selectedModels.map((modelId) => ({
            modelId,
            promptVersionId:
                input.promptByModel[modelId] ?? input.promptVersionId,
        })),
        reasoningConfigs: input.selectedModels.map((modelId) => ({
            modelId,
            reasoningConfig: reasoningConfigForModel(
                modelId,
                input.promptByModel[modelId] ?? input.promptVersionId,
                input.availableModels,
                input.versionOptions,
                input.reasoningByModel[modelId],
            ),
        })),
        transportAssignments: input.selectedModels.flatMap((modelId) => {
            const transport =
                input.transportByModel[modelId] ??
                input.availableModels.find((model) => model.id === modelId)
                    ?.transports[0];
            return transport ? [{ modelId, transport }] : [];
        }),
    };
}

export function usePromptEvalRunController({
    availableModels,
    bundles,
    versionOptions,
    defaultPromptVersionId,
    defaultModels,
    selectedDataset,
    generateJudgeAction,
    datasetId,
}: IUsePromptEvalRunControllerOptions) {
    const initial = initialControllerState({
        availableModels,
        bundles,
        versionOptions,
        defaultPromptVersionId,
        defaultModels,
        selectedDataset,
        generateJudgeAction,
        datasetId,
    });
    const providerGroups = modelsByProvider(availableModels);
    const [promptVersionId, setPromptVersionId] = useState(
        initial.promptVersionId,
    );
    const [promptByModel, setPromptByModel] = useState<Record<string, string>>(
        {},
    );
    const [reasoningByModel, setReasoningByModel] = useState<
        Record<string, ReasoningEffort>
    >({});
    const [transportByModel, setTransportByModel] = useState<
        Record<string, ProviderTransport>
    >({});
    const [fieldConfigs, setFieldConfigs] = useState<IPipelineFieldConfig[]>(
        initial.fieldConfigs,
    );
    const [selectedModels, setSelectedModels] = useState<string[]>(
        initial.models,
    );
    const [activeProviderLabel, setActiveProviderLabel] = useState(
        initial.providerLabel,
    );
    const [manualModel, setManualModel] = useState("");
    const [referenceModel, setReferenceModel] = useState(
        () => initial.models[0] ?? "",
    );
    const [judgeRubric, setJudgeRubric] = useState("");
    const [judgePromptVersionId, setJudgePromptVersionId] = useState("none");
    const [judgeModelId, setJudgeModelId] = useState(() =>
        defaultJudgeModel(availableModels),
    );
    const [judgeTransport, setJudgeTransport] = useState<ProviderTransport>();
    const [judgeReasoningEffort, setJudgeReasoningEffort] = useState<
        ReasoningEffort | undefined
    >(undefined);
    const [judgeGenerating, setJudgeGenerating] = useState(false);
    const [judgeError, setJudgeError] = useState<string | undefined>(undefined);

    useEffect(() => {
        if (selectedDataset?.modality !== "image") return;
        setSelectedModels((previous) => {
            const next = previous.filter((id) =>
                modelCanRunOnDataset(
                    availableModels.find((model) => model.id === id),
                    selectedDataset,
                ),
            );
            return next.length === previous.length ? previous : next;
        });
    }, [availableModels, selectedDataset]);

    const provider = selectedProvider(providerGroups, activeProviderLabel);
    const modelConfiguration = selectedModelConfiguration({
        selectedModels,
        availableModels,
        versionOptions,
        promptByModel,
        reasoningByModel,
        transportByModel,
        promptVersionId,
        referenceModel,
    });
    const judgeEffortCapability = availableModels.find(
        (model) => model.id === judgeModelId,
    )?.reasoningEffort;
    const effectiveJudgeEffort = judgeEffortCapability
        ? (judgeReasoningEffort ?? judgeEffortCapability.defaultLevel)
        : undefined;

    const addManualModel = () => {
        const value = manualModel.trim();
        if (!value) return;
        if (
            !modelCanRunOnDataset(
                availableModels.find((model) => model.id === value),
                selectedDataset,
            )
        ) {
            return;
        }
        setSelectedModels((previous) =>
            previous.includes(value) ? previous : [...previous, value],
        );
        setManualModel("");
    };

    const selectPromptVersion = (id: string) => {
        setPromptVersionId(id);
        const option = versionOptions.find((version) => version.id === id);
        setFieldConfigs(option?.fieldConfigs ?? []);
    };

    const toggleModel = (modelId: string) => {
        setSelectedModels((previous) =>
            previous.includes(modelId)
                ? previous.filter((id) => id !== modelId)
                : [...previous, modelId],
        );
    };

    const removeModel = (modelId: string) => {
        setSelectedModels((previous) =>
            previous.filter((id) => id !== modelId),
        );
    };

    const handleGenerateJudge = async () => {
        if (!datasetId || !promptVersionId) return;
        setJudgeGenerating(true);
        setJudgeError(undefined);
        try {
            const result = await generateJudgeAction(
                promptVersionId,
                datasetId,
            );
            if (result.ok) {
                setJudgePromptVersionId("none");
                setJudgeRubric(result.rubricPrompt);
            } else {
                setJudgeError(result.error);
            }
        } catch {
            setJudgeError("Could not generate a judge. Try again.");
        } finally {
            setJudgeGenerating(false);
        }
    };

    return {
        promptVersionId,
        promptByModel,
        setPromptByModel,
        reasoningByModel,
        setReasoningByModel,
        transportByModel,
        setTransportByModel,
        fieldConfigs,
        selectedModels,
        providerGroups,
        activeProviderModels: provider.models,
        effectiveProviderLabel: provider.effectiveLabel,
        setActiveProviderLabel,
        manualModel,
        setManualModel,
        customModels: modelConfiguration.customModels,
        effectiveReference: modelConfiguration.effectiveReference,
        setReferenceModel,
        promptAssignments: modelConfiguration.promptAssignments,
        reasoningConfigs: modelConfiguration.reasoningConfigs,
        transportAssignments: modelConfiguration.transportAssignments,
        selectPromptVersion,
        toggleModel,
        removeModel,
        addManualModel,
        judgeRubric,
        setJudgeRubric,
        judgePromptVersionId,
        setJudgePromptVersionId,
        judgeModelId,
        setJudgeModelId,
        judgeTransport:
            judgeTransport ??
            availableModels.find((model) => model.id === judgeModelId)
                ?.transports[0],
        setJudgeTransport,
        judgeReasoningEffort,
        setJudgeReasoningEffort,
        judgeGenerating,
        judgeError,
        setJudgeError,
        judgeEffortCapability,
        effectiveJudgeEffort,
        usingSavedJudge: judgePromptVersionId !== "none",
        canGenerateJudge: Boolean(datasetId) && Boolean(promptVersionId),
        handleGenerateJudge,
    };
}

export function modelCanRunOnDataset(
    model: IRunSetupModelOption | undefined,
    dataset: IRunSetupDatasetOption | undefined,
): boolean {
    if (!model) return true;
    if (dataset?.modality !== "image") return true;
    return Boolean(model.vision);
}

export function modelDisabledReason(
    model: IRunSetupModelOption,
    dataset: IRunSetupDatasetOption | undefined,
): string | undefined {
    if (!model.available) {
        return (
            model.disabledReason ??
            model.unavailableReason ??
            "Not enabled for your API key"
        );
    }
    // A current provider listing is the authority for whether a model can be
    // selected. Registry capabilities enrich the UI, but cannot hide a newly
    // listed model that has not been catalogued yet.
    if (!model.structuredOutput && !model.providerListed) {
        return "Structured output is not supported";
    }
    if (!modelCanRunOnDataset(model, dataset)) {
        return "Image input is not supported";
    }
    return model.disabledReason ?? model.unavailableReason;
}

export function reasoningConfigForModel(
    modelId: string,
    promptVersionId: string,
    availableModels: IRunSetupModelOption[],
    versionOptions: IRunSetupVersionOption[],
    override?: ReasoningEffort,
): IReasoningConfig | undefined {
    const capability = availableModels.find(
        (model) => model.id === modelId,
    )?.reasoningEffort;
    if (!capability) return undefined;

    const versionEffort = versionOptions.find(
        (option) => option.id === promptVersionId,
    )?.reasoningConfig?.effort;
    const requested = override ?? versionEffort ?? capability.defaultLevel;
    return capability.supportedLevels.includes(requested)
        ? { effort: requested }
        : undefined;
}

function availableIds(availableModels: IRunSetupModelOption[]): string[] {
    return availableModels
        .filter((model) => model.available && !model.disabledReason)
        .map((model) => model.id);
}

function defaultSelection(availableModels: IRunSetupModelOption[]): string[] {
    const available = availableIds(availableModels);
    const preferred = ["gpt-4o", "gpt-4o-mini"].filter((id) =>
        available.includes(id),
    );
    if (preferred.length > 0) return preferred;
    return availableModels
        .filter(
            (model) =>
                model.available &&
                !model.disabledReason &&
                model.structuredOutput,
        )
        .map((model) => model.id)
        .slice(0, 2);
}

function defaultJudgeModel(availableModels: IRunSetupModelOption[]): string {
    return (
        availableModels.find(
            (model) =>
                model.id === "gpt-5.4-mini" &&
                model.available &&
                model.judgeSuitable &&
                model.structuredOutput,
        )?.id ??
        availableModels.find(
            (model) =>
                model.available &&
                model.judgeSuitable &&
                model.structuredOutput,
        )?.id ??
        availableModels.find((model) => model.available)?.id ??
        availableModels[0]?.id ??
        ""
    );
}

function modelsByProvider(
    availableModels: IRunSetupModelOption[],
): IProviderModelGroup[] {
    const groups = new Map<string, IProviderModelGroup>();
    for (const model of availableModels) {
        const group = groups.get(model.providerLabel) ?? {
            label: model.providerLabel,
            models: [],
        };
        group.models.push(model);
        groups.set(model.providerLabel, group);
    }
    return [...groups.values()];
}
