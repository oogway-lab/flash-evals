"use client";

import { useEffect, useState } from "react";
import type {
    IRunSetupResponse,
    IWorkflowLlmProjectDefaultState,
    IWorkflowLlmRoute,
    IWorkflowLlmRouteCandidate,
    IWorkflowNodeConfig,
} from "@mosaic/api-contract";
import { isWorkflowModelBackedNodeType } from "@mosaic/api-contract";
import Link from "next/link";
import { Copy, Trash2 } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { validateGenerationFields } from "./generation-validation";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Sheet,
    SheetBody,
    SheetContent,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
    SttConfigFields,
    configForSttSnapshot,
    sttConfigForModel,
} from "@/components/runs/stt-config-fields";
import type { SttCanvasNode, SttNodeData } from "./stt-canvas";
import { InputDatasetUpload } from "./input-dataset-upload";
import {
    REASONING_EFFORT_LABELS,
    TRANSPORT_LABELS,
    labelFor,
} from "@/lib/labels";
import { NewTabIcon } from "@/components/ui/external-link";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";

export function SttNodeInspector({
    node,
    setup,
    onClose,
    onChange,
    onRemove,
    onDuplicate,
    llmRoutes = [],
    projectDefault,
    onCreateLlmRoute,
    onLoadLlmModels,
    onRouteCreated,
}: {
    node?: SttCanvasNode;
    setup: IRunSetupResponse;
    onClose: () => void;
    onChange: (data: SttNodeData) => void;
    onRemove: () => void;
    onDuplicate: () => void;
    llmRoutes?: IWorkflowLlmRoute[];
    projectDefault?: IWorkflowLlmProjectDefaultState;
    onCreateLlmRoute?: (input: {
        transport: "openai" | "gateway" | "openrouter" | "bifrost";
        modelId: string;
        name: string;
        reasoningEffort?:
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    }) => Promise<{ route?: IWorkflowLlmRoute; error?: string }>;
    onLoadLlmModels?: (
        transport: "openai" | "gateway" | "openrouter" | "bifrost",
    ) => Promise<{ candidates?: IWorkflowLlmRouteCandidate[]; error?: string }>;
    onRouteCreated?: (route: IWorkflowLlmRoute) => void;
}) {
    useEffect(() => {
        if (!node || node.data.llmExecutionSelection) return;
        if (!isWorkflowModelBackedNodeType(node.data.nodeType)) return;
        const timer = window.setTimeout(
            () => document.getElementById("node-execution-route")?.focus(),
            0,
        );
        return () => window.clearTimeout(timer);
    }, [node]);
    if (!node) return null;
    const data = node.data;
    const setConfig = (nodeConfig: IWorkflowNodeConfig) =>
        onChange({ ...data, nodeConfig });
    return (
        <Sheet
            open
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
        >
            <SheetContent>
                <SheetHeader>
                    <SheetTitle>{data.label}</SheetTitle>
                </SheetHeader>
                <SheetBody className="flex flex-col gap-6">
                    <div className="space-y-2">
                        <Label htmlFor="stt-node-label">Label</Label>
                        <Input
                            id="stt-node-label"
                            value={data.label}
                            onChange={(event) =>
                                onChange({ ...data, label: event.target.value })
                            }
                        />
                    </div>
                    <NodeConfigFields
                        data={data}
                        setup={setup}
                        onChange={onChange}
                        setConfig={setConfig}
                        llmRoutes={llmRoutes}
                        projectDefault={projectDefault}
                        onCreateLlmRoute={onCreateLlmRoute}
                        onLoadLlmModels={onLoadLlmModels}
                        onRouteCreated={onRouteCreated}
                    />
                    <div className="flex gap-2">
                        {data.nodeType === "stt" ? (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={onDuplicate}
                            >
                                <Copy />
                                Duplicate root
                            </Button>
                        ) : null}
                        <ConfirmDialog
                            trigger={
                                <Button type="button" variant="ghost">
                                    <Trash2 />
                                    Remove
                                </Button>
                            }
                            title={`Remove “${data.label}”?`}
                            description="Its settings and connections are removed from the canvas. Save the canvas to keep the change."
                            confirmLabel="Remove"
                            onConfirm={onRemove}
                        />
                    </div>
                </SheetBody>
            </SheetContent>
        </Sheet>
    );
}

function NodeConfigFields({
    data,
    setup,
    onChange,
    setConfig,
    llmRoutes,
    projectDefault,
    onCreateLlmRoute,
    onLoadLlmModels,
    onRouteCreated,
}: {
    data: SttNodeData;
    setup: IRunSetupResponse;
    onChange: (data: SttNodeData) => void;
    setConfig: (config: IWorkflowNodeConfig) => void;
    llmRoutes: IWorkflowLlmRoute[];
    projectDefault?: IWorkflowLlmProjectDefaultState;
    onCreateLlmRoute?: (input: {
        transport: "openai" | "gateway" | "openrouter" | "bifrost";
        modelId: string;
        name: string;
        reasoningEffort?:
            "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
    }) => Promise<{ route?: IWorkflowLlmRoute; error?: string }>;
    onLoadLlmModels?: (
        transport: "openai" | "gateway" | "openrouter" | "bifrost",
    ) => Promise<{ candidates?: IWorkflowLlmRouteCandidate[]; error?: string }>;
    onRouteCreated?: (route: IWorkflowLlmRoute) => void;
}) {
    switch (data.nodeConfig.type) {
        case "input": {
            const config = data.nodeConfig;
            const datasets = setup.datasets.filter(
                (dataset) => dataset.modality === config.modality,
            );
            return (
                <div className="flex flex-col gap-6">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="input-modality">Modality</Label>
                        <Select
                            value={config.modality}
                            onValueChange={(modality) =>
                                setConfig({
                                    type: "input",
                                    modality: modality as
                                        "audio" | "image" | "text",
                                })
                            }
                        >
                            <SelectTrigger id="input-modality">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    <SelectItem value="audio">Audio</SelectItem>
                                    <SelectItem value="image">Image</SelectItem>
                                    <SelectItem value="text">Text</SelectItem>
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="input-dataset">Dataset</Label>
                        <Select
                            value={config.datasetId ?? ""}
                            onValueChange={(datasetId) =>
                                setConfig({ ...config, datasetId })
                            }
                        >
                            <SelectTrigger id="input-dataset">
                                <SelectValue placeholder="Select dataset" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {datasets.map((dataset) => (
                                        <SelectItem
                                            key={dataset.id}
                                            value={dataset.id}
                                        >
                                            {dataset.name} ({dataset.itemCount})
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                        <Link
                            href={`/datasets/new?modality=${config.modality}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={buttonVariants({
                                variant: "link",
                                size: "sm",
                            })}
                        >
                            Create dataset in Datasets
                            <NewTabIcon />
                        </Link>
                    </div>
                    <div className="flex flex-col gap-3">
                        <div className="flex flex-col gap-1">
                            <p className="text-label-14 text-on-surface">
                                Create and upload here
                            </p>
                            <p className="text-copy-14 text-muted-foreground">
                                Creates an evaluation dataset, binds it to this
                                input, then adds items without leaving the
                                canvas.
                            </p>
                        </div>
                        <InputDatasetUpload
                            key={config.modality}
                            modality={config.modality}
                            onBind={(datasetId) =>
                                setConfig({ ...config, datasetId })
                            }
                        />
                    </div>
                </div>
            );
        }
        case "prompt": {
            return (
                <div className="flex flex-col gap-6">
                    <ModelSelect
                        label="Prompt version"
                        value={data.promptVersionId ?? ""}
                        models={setup.versionOptions}
                        onChange={(promptVersionId) =>
                            onChange({ ...data, promptVersionId })
                        }
                    />
                    <LlmRouteFields
                        data={data}
                        setup={setup}
                        routes={llmRoutes}
                        projectDefault={projectDefault}
                        onChange={onChange}
                        onCreateLlmRoute={onCreateLlmRoute}
                        onLoadLlmModels={onLoadLlmModels}
                        onRouteCreated={onRouteCreated}
                    />
                </div>
            );
        }
        case "stt": {
            const config = data.nodeConfig.sttConfig;
            const sttModels = setup.sttModels.filter(
                (model) => model.available,
            );
            const selectedModel = setup.sttModels.find(
                (model) => model.id === config.modelId,
            );
            return (
                <>
                    <ModelSelect
                        label="STT model"
                        value={config.modelId}
                        models={sttModels.map((model) => ({
                            id: model.id,
                            label: model.label,
                        }))}
                        onChange={(modelId) => {
                            const model = sttModels.find(
                                (candidate) => candidate.id === modelId,
                            );
                            if (!model) return;
                            setConfig({
                                type: "stt",
                                sttConfig: sttConfigForModel(config, model),
                            });
                        }}
                    />
                    <SttConfigFields
                        idPrefix={`stt-node-${data.nodeKey}`}
                        model={selectedModel}
                        language={config.language ?? ""}
                        config={config.config ?? {}}
                        onLanguageChange={(language) =>
                            setConfig({
                                type: "stt",
                                sttConfig: {
                                    ...config,
                                    language: language || undefined,
                                },
                            })
                        }
                        onConfigChange={(nextConfig) =>
                            setConfig({
                                type: "stt",
                                sttConfig: {
                                    ...config,
                                    config: configForSttSnapshot(
                                        nextConfig,
                                        selectedModel,
                                    ),
                                },
                            })
                        }
                    />
                </>
            );
        }
        case "llm_text":
            return (
                <>
                    <LlmRouteFields
                        data={data}
                        setup={setup}
                        routes={llmRoutes}
                        projectDefault={projectDefault}
                        onChange={onChange}
                        onCreateLlmRoute={onCreateLlmRoute}
                        onLoadLlmModels={onLoadLlmModels}
                        onRouteCreated={onRouteCreated}
                    />
                    <div className="space-y-2">
                        <Label htmlFor="llm-prompt">Prompt</Label>
                        <Textarea
                            id="llm-prompt"
                            value={data.nodeConfig.promptText}
                            onChange={(event) =>
                                setConfig({
                                    type: "llm_text",
                                    promptText: event.target.value,
                                })
                            }
                        />
                    </div>
                </>
            );
        case "transliterate": {
            return (
                <LlmRouteFields
                    data={data}
                    setup={setup}
                    routes={llmRoutes}
                    projectDefault={projectDefault}
                    onChange={onChange}
                    onCreateLlmRoute={onCreateLlmRoute}
                    onLoadLlmModels={onLoadLlmModels}
                    onRouteCreated={onRouteCreated}
                />
            );
        }
        case "judge":
            return (
                <>
                    <LlmRouteFields
                        data={data}
                        setup={setup}
                        routes={llmRoutes}
                        projectDefault={projectDefault}
                        onChange={onChange}
                        onCreateLlmRoute={onCreateLlmRoute}
                        onLoadLlmModels={onLoadLlmModels}
                        onRouteCreated={onRouteCreated}
                    />
                    <div className="space-y-2">
                        <Label htmlFor="judge-rubric">Rubric</Label>
                        <Textarea
                            id="judge-rubric"
                            value={data.nodeConfig.rubricPrompt}
                            onChange={(event) =>
                                setConfig({
                                    type: "judge",
                                    rubricPrompt: event.target.value,
                                })
                            }
                        />
                    </div>
                </>
            );
        case "metric_compare":
            return (
                <ModelSelect
                    label="Reference field"
                    value={data.nodeConfig.referenceField}
                    models={[
                        {
                            id: "expectedTranscript",
                            label: "Expected transcript",
                        },
                        {
                            id: "expectedTranscriptLatin",
                            label: "Expected transcript (Latin)",
                        },
                    ]}
                    onChange={(referenceField) =>
                        setConfig({
                            type: "metric_compare",
                            referenceField: referenceField as
                                | "expectedTranscript"
                                | "expectedTranscriptLatin",
                        })
                    }
                />
            );
        default:
            return null;
    }
}

// eslint-disable-next-line complexity -- inspector fields are gated by transport and capability state.
function LlmRouteFields({
    data,
    setup,
    routes,
    projectDefault,
    onChange,
    onCreateLlmRoute,
    onLoadLlmModels,
    onRouteCreated,
}: {
    data: SttNodeData;
    setup: IRunSetupResponse;
    routes: IWorkflowLlmRoute[];
    projectDefault?: IWorkflowLlmProjectDefaultState;
    onChange: (data: SttNodeData) => void;
    onCreateLlmRoute?: (input: {
        transport: "openai" | "gateway" | "openrouter" | "bifrost";
        modelId: string;
        name: string;
        generation?: {
            maxOutputTokens: number;
            temperature?: number;
            topP?: number;
            seed?: number;
            reasoningEffort?:
                "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
        };
        timeoutMs?: number;
        maxAttempts?: number;
        mosaicReuse?: "allow" | "force_fresh";
    }) => Promise<{ route?: IWorkflowLlmRoute; error?: string }>;
    onLoadLlmModels?: (
        transport: "openai" | "gateway" | "openrouter" | "bifrost",
    ) => Promise<{ candidates?: IWorkflowLlmRouteCandidate[]; error?: string }>;
    onRouteCreated?: (route: IWorkflowLlmRoute) => void;
}) {
    const activeVersions = routes
        .filter((route) => !route.disabledAt)
        .flatMap((route) =>
            routeVersions(route).map((version) => ({ route, version })),
        );
    const providers = Object.entries(TRANSPORT_LABELS) as Array<
        [keyof typeof TRANSPORT_LABELS, string]
    >;
    const defaultVersion = activeVersions.find(
        ({ version }) => version.id === projectDefault?.routeVersionId,
    );
    const pinnedRouteVersionId =
        data.llmExecutionSelection?.mode === "pinned_route"
            ? data.llmExecutionSelection.routeVersionId
            : undefined;
    const pinnedVersion = pinnedRouteVersionId
        ? activeVersions.find(
              ({ version }) => version.id === pinnedRouteVersionId,
          )
        : undefined;
    const effectiveVersion =
        data.llmExecutionSelection?.mode === "project_default"
            ? defaultVersion
            : pinnedVersion;
    const value =
        data.llmExecutionSelection?.mode === "project_default"
            ? "project_default"
            : data.llmExecutionSelection?.mode === "pinned_route"
              ? data.llmExecutionSelection.routeVersionId
              : "legacy_unresolved";
    const repairMessage = !data.llmExecutionSelection
        ? "This legacy node needs an explicit LLM route before it can run."
        : data.llmExecutionSelection.mode === "project_default" &&
            !defaultVersion
          ? "This node uses the project default, but no active default is configured."
          : data.llmExecutionSelection.mode === "pinned_route" && !pinnedVersion
            ? "The pinned route is unavailable. Choose an active route."
            : undefined;
    const version = effectiveVersion?.version;
    const [selectedTransport, setSelectedTransport] = useState<
        "" | "openai" | "gateway" | "openrouter" | "bifrost"
    >(
        version?.config.transportConfig.transport ??
            (data.llmExecutionSelection?.mode === "simple"
                ? data.llmExecutionSelection.transport
                : ""),
    );
    const [selectedModelId, setSelectedModelId] = useState(
        version?.config.modelId ?? data.modelId ?? "",
    );
    const [maxOutputTokens, setMaxOutputTokens] = useState(
        String(version?.config.generation.maxOutputTokens ?? 4096),
    );
    const [temperature, setTemperature] = useState(
        numberInputValue(version?.config.generation.temperature),
    );
    const [topP, setTopP] = useState(
        numberInputValue(version?.config.generation.topP),
    );
    const [seed, setSeed] = useState(
        numberInputValue(version?.config.generation.seed),
    );
    const [reasoningEffort, setReasoningEffort] = useState(
        version?.config.generation.reasoningEffort ?? "",
    );
    const [timeoutMs, setTimeoutMs] = useState(
        String(version?.config.retry.timeoutMs ?? 60_000),
    );
    const [maxAttempts, setMaxAttempts] = useState(
        String(
            version?.config.retry.owner === "mosaic"
                ? version.config.retry.maxAttempts
                : 1,
        ),
    );
    const generationErrors = validateGenerationFields({
        maxOutputTokens,
        timeoutMs,
        temperature,
        topP,
        seed,
        ...(selectedTransport !== "gateway" ? { maxAttempts } : {}),
    });
    const hasGenerationErrors = Object.keys(generationErrors).length > 0;
    const [creating, setCreating] = useState(false);
    const [createError, setCreateError] = useState<string>();
    const [simpleCandidates, setSimpleCandidates] = useState<
        IWorkflowLlmRouteCandidate[]
    >([]);
    const [simpleLoadError, setSimpleLoadError] = useState<string>();
    // Which provider (and retry attempt) the current candidates belong to;
    // models are loading until it matches the selected provider.
    const [simpleReloadToken, setSimpleReloadToken] = useState(0);
    const [simpleLoadedKey, setSimpleLoadedKey] = useState<string>();
    const simpleLoadKey = selectedTransport
        ? `${selectedTransport}:${simpleReloadToken}`
        : undefined;
    const simpleLoading =
        Boolean(onLoadLlmModels) &&
        simpleLoadKey !== undefined &&
        simpleLoadedKey !== simpleLoadKey;
    // A node that needs repair must show its route controls, so the
    // auto-focused route select is visible rather than hidden in a closed
    // collapsible.
    const [advancedOpen, setAdvancedOpen] = useState(Boolean(repairMessage));
    const modelOptions = selectedTransport
        ? setup.availableModels.filter(
              (model) =>
                  model.available &&
                  model.transports.includes(selectedTransport),
          )
        : [];
    const selectedModel = modelOptions.find(
        (model) => model.id === selectedModelId,
    );
    const simpleModelOptions =
        simpleCandidates.length > 0
            ? simpleCandidates
            : modelOptions.map((model) => ({
                  modelId: model.id,
                  label: model.label,
                  modelProviderLabel: model.providerLabel,
              }));

    useEffect(() => {
        if (repairMessage) setAdvancedOpen(true);
    }, [repairMessage]);

    useEffect(() => {
        if (!selectedTransport || !onLoadLlmModels || !simpleLoadKey) return;
        let cancelled = false;
        onLoadLlmModels(selectedTransport)
            .then((result) => {
                if (cancelled) return;
                setSimpleCandidates(result.candidates ?? []);
                setSimpleLoadError(result.error);
                setSimpleLoadedKey(simpleLoadKey);
            })
            .catch(() => {
                if (cancelled) return;
                setSimpleCandidates([]);
                setSimpleLoadError(
                    "Couldn’t load models for this provider. Try again.",
                );
                setSimpleLoadedKey(simpleLoadKey);
            });
        return () => {
            cancelled = true;
        };
    }, [onLoadLlmModels, selectedTransport, simpleLoadKey]);

    function selectRoute(next: string) {
        const route =
            next === "project_default"
                ? defaultVersion
                : activeVersions.find(
                      ({ version: candidate }) => candidate.id === next,
                  );
        const config = route?.version.config;
        const nodeConfig =
            data.nodeConfig.type === "transliterate" && config
                ? {
                      ...data.nodeConfig,
                      transliteration: {
                          ...data.nodeConfig.transliteration,
                          modelId: config.modelId,
                      },
                  }
                : data.nodeConfig;
        onChange({
            ...data,
            nodeConfig,
            ...(config ? { modelId: config.modelId } : {}),
            reasoningConfig:
                config?.generation.reasoningEffort !== undefined
                    ? { effort: config.generation.reasoningEffort }
                    : undefined,
            llmExecutionSelection:
                next === "project_default"
                    ? { mode: "project_default" }
                    : { mode: "pinned_route", routeVersionId: next },
        });
    }

    function selectModel(modelId: string) {
        setSelectedModelId(modelId);
        setCreateError(undefined);
    }

    function selectSimpleModel(modelId: string) {
        if (!selectedTransport) return;
        const nodeConfig =
            data.nodeConfig.type === "transliterate"
                ? {
                      ...data.nodeConfig,
                      transliteration: {
                          ...data.nodeConfig.transliteration,
                          modelId,
                      },
                  }
                : data.nodeConfig;
        setSelectedModelId(modelId);
        onChange({
            ...data,
            nodeConfig,
            modelId,
            llmExecutionSelection: {
                mode: "simple",
                transport: selectedTransport,
            },
        });
    }

    function selectProvider(transport: string) {
        if (
            transport !== "openai" &&
            transport !== "gateway" &&
            transport !== "openrouter" &&
            transport !== "bifrost"
        )
            return;
        setSelectedTransport(transport);
        setSelectedModelId("");
        setSimpleCandidates([]);
        setSimpleLoadError(undefined);
        setCreateError(undefined);
    }

    async function createRoute() {
        if (!onCreateLlmRoute || !selectedTransport || !selectedModel) return;
        if (hasGenerationErrors) return;
        setCreating(true);
        setCreateError(undefined);
        const result = await onCreateLlmRoute({
            transport: selectedTransport,
            modelId: selectedModel.id,
            name: `${transportLabel(selectedTransport)} · ${selectedModel.id}`,
            generation: {
                maxOutputTokens: positiveNumber(maxOutputTokens, 4096),
                ...optionalNumberValue(temperature, "temperature"),
                ...optionalNumberValue(topP, "topP"),
                ...optionalNumberValue(seed, "seed", true),
                ...(reasoningEffort
                    ? {
                          reasoningEffort: reasoningEffort as
                              | "none"
                              | "minimal"
                              | "low"
                              | "medium"
                              | "high"
                              | "xhigh",
                      }
                    : {}),
            },
            timeoutMs: positiveNumber(timeoutMs, 60_000),
            ...(selectedTransport === "gateway"
                ? {}
                : { maxAttempts: positiveNumber(maxAttempts, 1) }),
            mosaicReuse: "force_fresh",
        });
        setCreating(false);
        if (!result.route?.latestVersion) {
            setCreateError(result.error ?? "Route could not be created.");
            return;
        }
        onRouteCreated?.(result.route);
        selectRoute(result.route.latestVersion.id);
    }

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 rounded-sm bg-surface p-3">
                <div className="flex flex-col gap-1">
                    <p className="text-label-14 text-on-surface">Simple mode</p>
                    <p className="text-copy-14 text-muted-foreground">
                        Choose any model available through your provider key.
                    </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="node-simple-provider">Provider</Label>
                        <Select
                            value={selectedTransport}
                            onValueChange={selectProvider}
                        >
                            <SelectTrigger id="node-simple-provider">
                                <SelectValue placeholder="Select provider" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {providers.map(([transport, label]) => (
                                        <SelectItem
                                            key={transport}
                                            value={transport}
                                        >
                                            {label}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="node-simple-model">Model</Label>
                        <Select
                            value={
                                data.llmExecutionSelection?.mode === "simple"
                                    ? (data.modelId ?? "")
                                    : ""
                            }
                            onValueChange={selectSimpleModel}
                            disabled={!selectedTransport}
                        >
                            <SelectTrigger id="node-simple-model">
                                <SelectValue
                                    placeholder={
                                        simpleLoading
                                            ? "Loading models…"
                                            : "Select model"
                                    }
                                />
                                {simpleLoading && (
                                    <Spinner
                                        size="sm"
                                        label="Loading models"
                                        className="ml-auto"
                                    />
                                )}
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {simpleModelOptions.map((model) => (
                                        <SelectItem
                                            key={model.modelId}
                                            value={model.modelId}
                                        >
                                            {model.label} ·{" "}
                                            {model.modelProviderLabel}
                                        </SelectItem>
                                    ))}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                </div>
                {simpleLoadError && !simpleLoading ? (
                    <div
                        className="flex flex-wrap items-center gap-2"
                        role="alert"
                    >
                        <p className="text-copy-14 text-error">
                            {simpleLoadError}
                        </p>
                        <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() =>
                                setSimpleReloadToken((token) => token + 1)
                            }
                        >
                            Retry
                        </Button>
                    </div>
                ) : null}
            </div>
            {repairMessage ? (
                <Alert variant="destructive">
                    <AlertTitle>Choose a provider and model</AlertTitle>
                    <AlertDescription>
                        {repairMessage} Configure this node below, then save the
                        canvas before running it.
                    </AlertDescription>
                </Alert>
            ) : null}
            <Collapsible
                className="rounded-sm bg-surface p-3"
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
            >
                <CollapsibleTrigger>
                    Advanced verified route configuration
                </CollapsibleTrigger>
                <CollapsibleContent
                    keepMounted
                    className="flex flex-col gap-3 pt-3 data-closed:hidden"
                >
                    <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="node-execution-provider">
                                Provider
                            </Label>
                            <Select
                                value={selectedTransport}
                                onValueChange={selectProvider}
                            >
                                <SelectTrigger id="node-execution-provider">
                                    <SelectValue placeholder="Select provider" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {providers.map(([transport, label]) => (
                                            <SelectItem
                                                key={transport}
                                                value={transport}
                                            >
                                                {label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex flex-col gap-2">
                            <Label htmlFor="node-execution-model">Model</Label>
                            <Select
                                value={selectedModelId}
                                onValueChange={selectModel}
                                disabled={!selectedTransport}
                            >
                                <SelectTrigger id="node-execution-model">
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {modelOptions.map((model) => (
                                            <SelectItem
                                                key={model.id}
                                                value={model.id}
                                            >
                                                {model.label} ·{" "}
                                                {model.providerLabel}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    {selectedModel ? (
                        <div className="grid gap-3 sm:grid-cols-2">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="node-max-output-tokens">
                                    Max output tokens
                                </Label>
                                <Input
                                    id="node-max-output-tokens"
                                    type="number"
                                    min="1"
                                    value={maxOutputTokens}
                                    onChange={(event) =>
                                        setMaxOutputTokens(event.target.value)
                                    }
                                    invalid={Boolean(
                                        generationErrors.maxOutputTokens,
                                    )}
                                    aria-describedby={
                                        generationErrors.maxOutputTokens
                                            ? "node-max-output-tokens-error"
                                            : undefined
                                    }
                                />
                                {generationErrors.maxOutputTokens ? (
                                    <p
                                        id="node-max-output-tokens-error"
                                        className="text-copy-14 text-error"
                                    >
                                        {generationErrors.maxOutputTokens}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="node-timeout-ms">
                                    Timeout (ms)
                                </Label>
                                <Input
                                    id="node-timeout-ms"
                                    type="number"
                                    min="1"
                                    value={timeoutMs}
                                    onChange={(event) =>
                                        setTimeoutMs(event.target.value)
                                    }
                                    invalid={Boolean(
                                        generationErrors.timeoutMs,
                                    )}
                                    aria-describedby={
                                        generationErrors.timeoutMs
                                            ? "node-timeout-ms-error"
                                            : undefined
                                    }
                                />
                                {generationErrors.timeoutMs ? (
                                    <p
                                        id="node-timeout-ms-error"
                                        className="text-copy-14 text-error"
                                    >
                                        {generationErrors.timeoutMs}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="node-temperature">
                                    Temperature
                                </Label>
                                <Input
                                    id="node-temperature"
                                    type="number"
                                    min="0"
                                    step="0.01"
                                    value={temperature}
                                    onChange={(event) =>
                                        setTemperature(event.target.value)
                                    }
                                    placeholder="Provider default"
                                    invalid={Boolean(
                                        generationErrors.temperature,
                                    )}
                                    aria-describedby={
                                        generationErrors.temperature
                                            ? "node-temperature-error"
                                            : undefined
                                    }
                                />
                                {generationErrors.temperature ? (
                                    <p
                                        id="node-temperature-error"
                                        className="text-copy-14 text-error"
                                    >
                                        {generationErrors.temperature}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="node-seed">Seed</Label>
                                <Input
                                    id="node-seed"
                                    type="number"
                                    step="1"
                                    value={seed}
                                    onChange={(event) =>
                                        setSeed(event.target.value)
                                    }
                                    placeholder="Provider default"
                                    invalid={Boolean(generationErrors.seed)}
                                    aria-describedby={
                                        generationErrors.seed
                                            ? "node-seed-error"
                                            : undefined
                                    }
                                />
                                {generationErrors.seed ? (
                                    <p
                                        id="node-seed-error"
                                        className="text-copy-14 text-error"
                                    >
                                        {generationErrors.seed}
                                    </p>
                                ) : null}
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="node-top-p">Top P</Label>
                                <Input
                                    id="node-top-p"
                                    type="number"
                                    min="0"
                                    max="1"
                                    step="0.01"
                                    value={topP}
                                    onChange={(event) =>
                                        setTopP(event.target.value)
                                    }
                                    placeholder="Provider default"
                                    invalid={Boolean(generationErrors.topP)}
                                    aria-describedby={
                                        generationErrors.topP
                                            ? "node-top-p-error"
                                            : undefined
                                    }
                                />
                                {generationErrors.topP ? (
                                    <p
                                        id="node-top-p-error"
                                        className="text-copy-14 text-error"
                                    >
                                        {generationErrors.topP}
                                    </p>
                                ) : null}
                            </div>
                            {selectedModel.reasoningEffort ? (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="node-reasoning-effort">
                                        Reasoning effort
                                    </Label>
                                    <Select
                                        value={reasoningEffort}
                                        onValueChange={setReasoningEffort}
                                    >
                                        <SelectTrigger id="node-reasoning-effort">
                                            <SelectValue placeholder="Provider default" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectGroup>
                                                {selectedModel.reasoningEffort.supportedLevels.map(
                                                    (level) => (
                                                        <SelectItem
                                                            key={level}
                                                            value={level}
                                                        >
                                                            {labelFor(
                                                                REASONING_EFFORT_LABELS,
                                                                level,
                                                            )}
                                                        </SelectItem>
                                                    ),
                                                )}
                                            </SelectGroup>
                                        </SelectContent>
                                    </Select>
                                </div>
                            ) : null}
                            {selectedTransport !== "gateway" ? (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="node-max-attempts">
                                        Retry attempts
                                    </Label>
                                    <Input
                                        id="node-max-attempts"
                                        type="number"
                                        min="1"
                                        value={maxAttempts}
                                        onChange={(event) =>
                                            setMaxAttempts(event.target.value)
                                        }
                                        invalid={Boolean(
                                            generationErrors.maxAttempts,
                                        )}
                                        aria-describedby={
                                            generationErrors.maxAttempts
                                                ? "node-max-attempts-error"
                                                : undefined
                                        }
                                    />
                                    {generationErrors.maxAttempts ? (
                                        <p
                                            id="node-max-attempts-error"
                                            className="text-copy-14 text-error"
                                        >
                                            {generationErrors.maxAttempts}
                                        </p>
                                    ) : null}
                                </div>
                            ) : null}
                        </div>
                    ) : (
                        <p className="text-copy-14 text-muted-foreground">
                            Choose a provider and model to configure this node.
                        </p>
                    )}
                    <div className="flex flex-col gap-2">
                        <p className="text-copy-14 text-muted-foreground">
                            These settings become an immutable execution
                            snapshot for this node.
                        </p>
                        {onCreateLlmRoute ? (
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => void createRoute()}
                                loading={creating}
                                loadingText="Saving node configuration…"
                                disabled={!selectedModel || hasGenerationErrors}
                            >
                                Use this configuration
                            </Button>
                        ) : null}
                        {createError ? (
                            <p className="text-copy-14 text-error" role="alert">
                                {createError}
                            </p>
                        ) : null}
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="node-execution-route">
                            Saved configuration
                        </Label>
                        <Select value={value} onValueChange={selectRoute}>
                            <SelectTrigger id="node-execution-route">
                                <SelectValue placeholder="Repair route selection" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectGroup>
                                    {!data.llmExecutionSelection ? (
                                        <SelectItem
                                            value="legacy_unresolved"
                                            disabled
                                        >
                                            Legacy unresolved
                                        </SelectItem>
                                    ) : null}
                                    <SelectItem value="project_default">
                                        Use project default
                                        {defaultVersion
                                            ? ` · ${defaultVersion.route.name} v${defaultVersion.version.version}`
                                            : " · not configured"}
                                    </SelectItem>
                                    {activeVersions.map(
                                        ({ route, version }) => (
                                            <SelectItem
                                                key={version.id}
                                                value={version.id}
                                            >
                                                {route.name} · v
                                                {version.version}
                                            </SelectItem>
                                        ),
                                    )}
                                </SelectGroup>
                            </SelectContent>
                        </Select>
                    </div>
                    {version ? (
                        <div className="rounded-sm bg-surface p-3">
                            <p className="text-mono-13 text-on-surface">
                                {version.config.transportConfig.transport} ·{" "}
                                {version.config.modelId}
                            </p>
                            <p className="text-copy-14 text-muted-foreground">
                                {routeSettingsSummary(version.config)}
                            </p>
                            <p className="text-copy-14 text-muted-foreground">
                                This saved configuration is immutable. Create
                                another node configuration to change it.
                            </p>
                        </div>
                    ) : data.modelId ? (
                        <p className="text-copy-14 text-muted-foreground">
                            Legacy model{" "}
                            <span className="text-mono-13 text-on-surface">
                                {data.modelId}
                            </span>{" "}
                            is retained for reading only and will be replaced
                            when a route is selected.
                        </p>
                    ) : null}
                </CollapsibleContent>
            </Collapsible>
        </div>
    );
}

function numberInputValue(value: number | undefined): string {
    return value === undefined ? "" : String(value);
}

function positiveNumber(value: string, fallback: number): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0
        ? Math.trunc(parsed)
        : fallback;
}

function optionalNumberValue(
    value: string,
    key: "temperature" | "topP" | "seed",
    integer = false,
): Record<string, number> {
    if (!value.trim()) return {};
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return {};
    return { [key]: integer ? Math.trunc(parsed) : parsed };
}

function routeSettingsSummary(
    config: NonNullable<IWorkflowLlmRoute["latestVersion"]>["config"],
): string {
    const generation = [
        `${config.generation.maxOutputTokens} max tokens`,
        config.generation.temperature !== undefined
            ? `temperature ${config.generation.temperature}`
            : undefined,
        config.generation.topP !== undefined
            ? `top P ${config.generation.topP}`
            : undefined,
        config.generation.seed !== undefined
            ? `seed ${config.generation.seed}`
            : undefined,
        config.generation.reasoningEffort
            ? `reasoning ${config.generation.reasoningEffort}`
            : undefined,
    ]
        .filter(Boolean)
        .join(" · ");
    const reuse =
        config.cache.mosaicReuse === "force_fresh"
            ? "always call provider"
            : "exact reuse allowed";
    return `${generation} · ${reuse}`;
}

function transportLabel(transport: string): string {
    return labelFor(
        TRANSPORT_LABELS,
        transport as keyof typeof TRANSPORT_LABELS,
    );
}

function routeVersions(
    route: IWorkflowLlmRoute,
): NonNullable<IWorkflowLlmRoute["latestVersion"]>[] {
    if (route.versions?.length) return route.versions;
    return route.latestVersion ? [route.latestVersion] : [];
}

function ModelSelect({
    label,
    value,
    models,
    onChange,
}: {
    label: string;
    value: string;
    models: Array<{ id: string; label: string }>;
    onChange: (value: string) => void;
}) {
    const id = `node-${label.toLowerCase().replace(/ /g, "-")}`;
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger id={id}>
                    <SelectValue
                        placeholder={`Select ${label.toLowerCase()}`}
                    />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {models.map((model) => (
                            <SelectItem key={model.id} value={model.id}>
                                {model.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
        </div>
    );
}
