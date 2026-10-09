"use client";

import { ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "@mosaic/api-contract";

import { KeepFieldsOnReset } from "@/components/ui/keep-fields-on-reset";
import { PendingFieldset } from "@/components/ui/pending-fieldset";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import {
    CircleStop,
    Info,
    Play,
    Save,
    Sparkles,
    Trash2,
    Wand2,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { transportLabel } from "@/lib/transport";
import type {
    IGenerateSchemaActionState,
    IPromptJudgeTestActionState,
    IPromptTestRunActionState,
    IPromptWorkbenchState,
} from "@/app/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Spinner } from "@/components/ui/spinner";
import { StaleRegion } from "@/components/ui/stale-region";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FileDropzone } from "@/components/ui/file-dropzone";
import { useActionToast } from "@/components/layout/use-action-toast";
import { UnsavedChangesGuard } from "@/components/layout/unsaved-changes-guard";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { TagInput } from "@/components/ui/tag-input";
import { OptimizationReview } from "./optimization-review";
import type {
    ISchemaCompatibilityIssue,
    JudgeDeclaredInput,
    PromptKind,
} from "@/server/db/jsonTypes";
import type { ReasoningEffort } from "@mosaic/llm-core";
import type { ProviderTransport } from "@mosaic/api-contract";
import { ScorePill } from "@/components/ui/score-pill";
import {
    PromptTestResultBadge,
    PromptTestStatusBadge,
} from "@/components/ui/status-badge";
import { formatCostColumn } from "@/lib/format";
import { SectionTitle } from "@/components/layout/section-title";
import { Hint } from "@/components/ui/hint";
import { REASONING_EFFORT_LABELS } from "@/lib/labels";
import { ExternalLink } from "@/components/ui/external-link";
import { Checkbox } from "@/components/ui/checkbox";

const TEST_IMAGE_ACCEPT = ALLOWED_IMAGE_TYPES.join(",");
const TEST_IMAGE_MAX_BYTES = MAX_IMAGE_BYTES;

const JUDGE_INPUT_ORDER: JudgeDeclaredInput[] = [
    "task_input",
    "candidate_output",
    "reference",
];
const JUDGE_INPUT_OPTIONS: {
    value: JudgeDeclaredInput;
    label: string;
    hint: string;
}[] = [
    {
        value: "task_input",
        label: "Task input",
        hint: "The original input the model received.",
    },
    {
        value: "candidate_output",
        label: "Candidate output",
        hint: "The model output being judged.",
    },
    {
        value: "reference",
        label: "Reference",
        hint: "The golden / expected answer, when available.",
    },
];

interface IWorkbenchModelOption {
    id: string;
    label: string;
    providerLabel?: string;
    reasoning: boolean;
    vision: boolean;
    available: boolean;
    structuredOutput: boolean;
    transports?: ProviderTransport[];
    reasoningEffort?: {
        supportedLevels: readonly ReasoningEffort[];
        defaultLevel: ReasoningEffort;
    };
}

interface IWorkbenchModelGroup {
    label: string;
    models: IWorkbenchModelOption[];
}

interface ITestHistoryEntry {
    id: number;
    result: NonNullable<IPromptTestRunActionState["result"]>;
    config: {
        modelId: string;
        reasoningEffort?: ReasoningEffort;
        schemaVersion: number;
    };
}

// Save and Optimize submit the same form, so `useFormStatus().pending` is
// shared; gate each button's pending label on the submitter's intent. Only
// Save carries `name="intent"`: React reserves `name` on buttons whose
// `formAction` is a function, so an Optimize submission has no intent.
/** The saved prompt's id, only while the form is still on the same kind. */
function savedPromptIdFor(
    saved: { id: string; kind: PromptKind } | undefined,
    kind: PromptKind,
): string | undefined {
    return saved?.kind === kind ? saved.id : undefined;
}

function SaveButton({ promptKind }: { promptKind: PromptKind }) {
    const { pending: formPending, data } = useFormStatus();
    const pending = formPending && data?.get("intent") === "save";
    return (
        <Button
            type="submit"
            name="intent"
            value="save"
            disabled={formPending}
            loading={pending}
            loadingText={
                promptKind === "judge" ? "Saving judge…" : "Saving prompt…"
            }
        >
            <Save className="h-4 w-4" />
            {promptKind === "judge" ? "Save judge" : "Save prompt"}
        </Button>
    );
}

/**
 * "Optimizing… 12s": mounted only while the request runs, so the counter
 * starts at 0 each time. The seconds are hidden from screen readers so the
 * status is announced once rather than every tick.
 */
function ElapsedStatus({ label }: { label: string }) {
    const [seconds, setSeconds] = useState(0);
    useEffect(() => {
        const started = Date.now();
        const id = setInterval(
            () => setSeconds(Math.floor((Date.now() - started) / 1000)),
            1000,
        );
        return () => clearInterval(id);
    }, []);
    return (
        <span role="status" className="flex items-center gap-2">
            <Spinner size="sm" />
            {label}
            <span aria-hidden="true" className="tabular-nums">
                {seconds}s
            </span>
        </span>
    );
}

// Shares the Optimize button's form, so it can read the same pending state.
function PromptHint() {
    const { pending: formPending, data } = useFormStatus();
    const optimizing = formPending && data?.get("intent") !== "save";
    return (
        <p className="min-h-10 flex-1 text-label-12 text-muted-foreground">
            {optimizing ? (
                <ElapsedStatus label="Optimizing…" />
            ) : (
                "Instructions the model follows for every input: task, constraints, output shape."
            )}
        </p>
    );
}

function SchemaHint({ generating }: { generating: boolean }) {
    return (
        <p className="min-h-10 flex-1 text-label-12 text-muted-foreground">
            {generating ? (
                <ElapsedStatus label="Generating schema…" />
            ) : (
                "The JSON the model returns. Generate it, then edit. This is not your answer data."
            )}
        </p>
    );
}

function OptimizePromptButton({
    optimizeAction,
}: {
    optimizeAction: (formData: FormData) => void;
}) {
    const { pending: formPending, data } = useFormStatus();
    const pending = formPending && data?.get("intent") !== "save";
    return (
        <Button
            type="submit"
            size="sm"
            disabled={formPending}
            loading={pending}
            loadingText="Optimizing…"
            formAction={optimizeAction}
        >
            <Wand2 className="h-4 w-4" />
            Optimize with AI
        </Button>
    );
}

export function PromptWorkbench({
    saveAction,
    optimizeAction,
    testRunAction,
    judgeTestAction,
    generateSchemaAction,
    availableModels,
    modelsDegraded,
    initialPrompt,
    initialKind,
    workflowNodeKey,
    tagSuggestions = [],
}: {
    saveAction: (
        prevState: IPromptWorkbenchState,
        formData: FormData,
    ) => Promise<IPromptWorkbenchState>;
    optimizeAction: (
        prevState: IPromptWorkbenchState,
        formData: FormData,
    ) => Promise<IPromptWorkbenchState>;
    testRunAction: (formData: FormData) => Promise<IPromptTestRunActionState>;
    judgeTestAction: (
        formData: FormData,
    ) => Promise<IPromptJudgeTestActionState>;
    generateSchemaAction: (
        formData: FormData,
    ) => Promise<IGenerateSchemaActionState>;
    availableModels: IWorkbenchModelOption[];
    modelsDegraded: boolean;
    initialPrompt?: {
        promptId: string;
        name: string;
        description?: string;
        kind: PromptKind;
        content: string;
        jsonSchema: string;
        targetModelId?: string;
        reasoningEffort?: ReasoningEffort;
        fitTags?: string[];
    };
    initialKind?: PromptKind;
    workflowNodeKey?: string;
    tagSuggestions?: string[];
}) {
    const [saveState, saveFormAction] = useActionState(saveAction, {});
    const router = useRouter();
    // Edits since the last successful save; leaving the page asks first.
    const [unsaved, setUnsaved] = useState(false);
    useEffect(() => {
        if (saveState.ok) setUnsaved(false);
    }, [saveState]);

    useActionToast(
        saveState,
        (state) =>
            state.ok && state.promptId
                ? state.promptKind === "judge"
                    ? "Judge prompt saved."
                    : "Prompt saved."
                : undefined,
        (state) => ({
            action: {
                label: "Open prompt",
                onClick: () => router.push(`/prompts/${state.promptId}`),
            },
        }),
    );
    const [optimizeState, optimizeFormAction] = useActionState(
        optimizeAction,
        {},
    );
    const formRef = useRef<HTMLFormElement>(null);
    const postedPromptVersionRef = useRef<string | undefined>(undefined);
    const [content, setContent] = useState(initialPrompt?.content ?? "");
    const [acceptedOptimizerAttemptId, setAcceptedOptimizerAttemptId] =
        useState<string>();
    const [dismissedOptimizerAttemptId, setDismissedOptimizerAttemptId] =
        useState<string>();
    // The first save on /prompts/new creates the prompt; later saves add
    // versions to it rather than create a duplicate (eval and judge alike).
    // Remember its kind too: the API rejects an eval save that names a judge
    // prompt (and vice versa), so a kind switch starts a new prompt.
    const [savedPrompt, setSavedPrompt] = useState<
        { id: string; kind: PromptKind } | undefined
    >(
        initialPrompt
            ? { id: initialPrompt.promptId, kind: initialPrompt.kind }
            : undefined,
    );
    useEffect(() => {
        if (saveState.promptId && saveState.promptKind) {
            setSavedPrompt({
                id: saveState.promptId,
                kind: saveState.promptKind,
            });
        }
    }, [saveState.promptId, saveState.promptKind]);
    const [promptKind, setPromptKind] = useState<PromptKind>(
        initialPrompt?.kind ?? initialKind ?? "eval",
    );
    const savedPromptId = savedPromptIdFor(savedPrompt, promptKind);
    useEffect(() => {
        if (
            !workflowNodeKey ||
            !saveState.ok ||
            !saveState.promptVersionId ||
            postedPromptVersionRef.current === saveState.promptVersionId
        ) {
            return;
        }
        postedPromptVersionRef.current = saveState.promptVersionId;
        const name = formRef.current
            ? String(new FormData(formRef.current).get("name") || "New prompt")
            : "New prompt";
        window.opener?.postMessage(
            {
                type: "mosaic:workflow-prompt-created",
                kind: promptKind,
                nodeKey: workflowNodeKey,
                promptVersionId: saveState.promptVersionId,
                label: name,
            },
            window.location.origin,
        );
    }, [promptKind, saveState, workflowNodeKey]);
    const [jsonSchema, setJsonSchema] = useState(
        initialPrompt?.jsonSchema ?? "",
    );
    const [generateState, setGenerateState] = useState<{
        running?: boolean;
        error?: string;
        proposal?: string;
        compatibilityErrors?: ISchemaCompatibilityIssue[];
    }>({});
    const [schemaGateHint, setSchemaGateHint] = useState(false);
    const [targetModelId, setTargetModelId] = useState(
        () =>
            initialPrompt?.targetModelId ??
            firstSelectableModelId(availableModels) ??
            "gpt-4o",
    );
    const [transport, setTransport] = useState<ProviderTransport>();
    const workbenchModels = useMemo(
        () =>
            modelsWithCurrentTarget(
                availableModels,
                initialPrompt?.targetModelId,
            ),
        [availableModels, initialPrompt?.targetModelId],
    );
    const modelGroups = useMemo(
        () => modelsByProvider(workbenchModels),
        [workbenchModels],
    );
    const initialModelFamily =
        workbenchModels.find((model) => model.id === targetModelId)
            ?.providerLabel ??
        modelGroups[0]?.label ??
        "OpenAI";
    const [activeModelFamily, setActiveModelFamily] =
        useState(initialModelFamily);
    const activeModelOptions =
        modelGroups.find((group) => group.label === activeModelFamily)
            ?.models ??
        modelGroups[0]?.models ??
        [];
    const effectiveTargetModelId = activeModelOptions.some(
        (model) => model.id === targetModelId,
    )
        ? targetModelId
        : (firstSelectableModelId(activeModelOptions) ??
          firstSelectableModelId(workbenchModels) ??
          "gpt-4o");
    const [testInput, setTestInput] = useState("");
    const [testImage, setTestImage] = useState<File>();
    // Bumped to clear the picker (it keeps its own file list).
    const [testImageResetKey, setTestImageResetKey] = useState(0);
    const [fitTags, setFitTags] = useState(() =>
        (initialPrompt?.fitTags ?? []).join(", "),
    );
    // Schema versions seen this session, so each test result can be annotated
    // with which schema produced it. Bumped whenever the schema text changes.
    const [schemaVersion, setSchemaVersion] = useState(1);
    const lastSchemaRef = useRef(initialPrompt?.jsonSchema ?? "");
    const [testHistory, setTestHistory] = useState<ITestHistoryEntry[]>([]);
    const historyIdRef = useRef(0);
    const selectedModel = useMemo(
        () =>
            workbenchModels.find(
                (model) => model.id === effectiveTargetModelId,
            ),
        [workbenchModels, effectiveTargetModelId],
    );
    const selectedTransports = selectedModel?.transports ?? [];
    const effectiveTransport =
        transport && selectedTransports.includes(transport)
            ? transport
            : selectedTransports[0];
    const selectedEffortCapability = selectedModel?.reasoningEffort;
    const modelSupportsVision = selectedModel?.vision ?? true;
    useEffect(() => {
        // A non-vision model can't take an image; drop any staged file.
        if (!modelSupportsVision) {
            setTestImage(undefined);
            setTestImageResetKey((key) => key + 1);
        }
    }, [modelSupportsVision]);
    const [reasoningEffort, setReasoningEffort] = useState<
        ReasoningEffort | undefined
    >(initialPrompt?.reasoningEffort ?? selectedEffortCapability?.defaultLevel);
    const [testState, setTestState] = useState<
        IPromptTestRunActionState & { running?: boolean; cancelled?: boolean }
    >({});
    const [judgeDeclaredInputPreset, setJudgeDeclaredInputPreset] = useState(
        "candidate_output,reference",
    );
    const [judgeTaskInput, setJudgeTaskInput] = useState("");
    const [judgeCandidateOutput, setJudgeCandidateOutput] = useState("");
    const [judgeReference, setJudgeReference] = useState("");
    const [judgeTestState, setJudgeTestState] = useState<
        IPromptJudgeTestActionState & { running?: boolean; cancelled?: boolean }
    >({});
    const activeRunId = useRef(0);
    const activeJudgeRunId = useRef(0);
    const fieldErrors =
        saveState.fieldErrors ?? optimizeState.fieldErrors ?? {};
    // On validation failure, focus the first errored field (keys map to input ids).
    useEffect(() => {
        const errors = saveState.fieldErrors ?? optimizeState.fieldErrors;
        if (!errors) return;
        const fieldOrder = [
            "name",
            "targetModelId",
            "description",
            "content",
            "jsonSchema",
            "judgeDeclaredInputs",
        ];
        const orderedKeys = [
            ...fieldOrder.filter((key) => errors[key]?.length),
            ...Object.keys(errors).filter(
                (key) => !fieldOrder.includes(key) && errors[key]?.length,
            ),
        ];
        for (const key of orderedKeys) {
            const element = document.getElementById(key);
            if (element) {
                element.focus();
                return;
            }
        }
    }, [saveState, optimizeState]);
    const declaredJudgeInputs = useMemo(
        () =>
            judgeDeclaredInputPreset
                .split(",")
                .filter(Boolean) as JudgeDeclaredInput[],
        [judgeDeclaredInputPreset],
    );
    const selectedJudgeInputs = new Set(declaredJudgeInputs);
    function toggleJudgeInput(value: JudgeDeclaredInput) {
        const next = new Set(selectedJudgeInputs);
        if (next.has(value)) next.delete(value);
        else next.add(value);
        setJudgeDeclaredInputPreset(
            JUDGE_INPUT_ORDER.filter((v) => next.has(v)).join(","),
        );
    }

    const optimizationReviewVisible =
        promptKind === "eval" &&
        optimizeState.optimizedPrompt &&
        optimizeState.optimizerAttemptId &&
        dismissedOptimizerAttemptId !== optimizeState.optimizerAttemptId &&
        acceptedOptimizerAttemptId !== optimizeState.optimizerAttemptId;
    const optimizationApplied =
        promptKind === "eval" &&
        optimizeState.optimizerAttemptId &&
        acceptedOptimizerAttemptId === optimizeState.optimizerAttemptId;

    useEffect(() => {
        if (!selectedEffortCapability) {
            setReasoningEffort(undefined);
            return;
        }
        setReasoningEffort((current) =>
            current &&
            selectedEffortCapability.supportedLevels.includes(current)
                ? current
                : selectedEffortCapability.defaultLevel,
        );
    }, [selectedEffortCapability]);

    function selectModelFamily(family: string) {
        setActiveModelFamily(family);
        const models =
            modelGroups.find((group) => group.label === family)?.models ?? [];
        const nextModel = firstSelectableModelId(models) ?? models[0]?.id;
        if (nextModel) setTargetModelId(nextModel);
    }

    function currentSchemaVersion(): number {
        if (jsonSchema !== lastSchemaRef.current) {
            const next = schemaVersion + 1;
            lastSchemaRef.current = jsonSchema;
            setSchemaVersion(next);
            return next;
        }
        return schemaVersion;
    }

    async function runTest() {
        // R11: a schema is required to run; nudge the author to generate one.
        if (jsonSchema.trim() === "") {
            setSchemaGateHint(true);
            document.getElementById("generateSchemaBtn")?.focus();
            return;
        }
        const runId = activeRunId.current + 1;
        activeRunId.current = runId;
        const usedSchemaVersion = currentSchemaVersion();
        const usedModelId = effectiveTargetModelId;
        const usedEffort = reasoningEffort;
        // Keep the last result on screen (dimmed) while the new run is in flight.
        setTestState((prev) =>
            prev.ok && prev.result
                ? { ok: true, result: prev.result, running: true }
                : { running: true },
        );
        const formData = new FormData();
        formData.set("content", content);
        formData.set("jsonSchema", jsonSchema);
        formData.set("targetModelId", effectiveTargetModelId);
        if (effectiveTransport) formData.set("transport", effectiveTransport);
        formData.set("testMode", "single");
        formData.set("testInput", testInput);
        if (testImage) formData.set("imageFile", testImage);
        if (reasoningEffort) formData.set("reasoningEffort", reasoningEffort);

        let result: IPromptTestRunActionState;
        try {
            result = await testRunAction(formData);
        } catch {
            result = { formError: "Test run failed. Try again." };
        }
        if (activeRunId.current !== runId) return;
        setTestState(result);
        if (result.ok && result.result) {
            const entry: ITestHistoryEntry = {
                id: (historyIdRef.current += 1),
                result: result.result,
                config: {
                    modelId: usedModelId,
                    reasoningEffort: usedEffort,
                    schemaVersion: usedSchemaVersion,
                },
            };
            setTestHistory((prev) => [entry, ...prev]);
        }
    }

    async function runGenerate() {
        if (generateState.running) return;
        setGenerateState({ running: true });
        const formData = new FormData();
        formData.set("content", content);
        formData.set("targetModelId", effectiveTargetModelId);
        let result: IGenerateSchemaActionState;
        try {
            result = await generateSchemaAction(formData);
        } catch {
            result = {};
        }
        if (!result.ok || !result.schema) {
            setGenerateState({
                error:
                    result.formError ??
                    Object.values(result.fieldErrors ?? {})[0]?.[0] ??
                    "Could not generate a schema. Try again.",
            });
            return;
        }
        setSchemaGateHint(false);
        // Fill an empty editor directly; otherwise propose a replacement the
        // author explicitly accepts so their existing schema isn't clobbered.
        if (jsonSchema.trim() === "") {
            setJsonSchema(result.schema);
            setGenerateState({
                compatibilityErrors: result.compatibilityErrors,
            });
            return;
        }
        setGenerateState({
            proposal: result.schema,
            compatibilityErrors: result.compatibilityErrors,
        });
    }

    function acceptGeneratedSchema() {
        if (generateState.proposal) setJsonSchema(generateState.proposal);
        setGenerateState((state) => ({
            compatibilityErrors: state.compatibilityErrors,
        }));
    }

    function discardGeneratedSchema() {
        setGenerateState({});
    }

    function cancelTestRun() {
        activeRunId.current += 1;
        setTestState({ cancelled: true });
    }

    function clearTestHistory() {
        setTestHistory([]);
    }

    async function runJudgeTest() {
        const runId = activeJudgeRunId.current + 1;
        activeJudgeRunId.current = runId;
        setJudgeTestState((prev) =>
            prev.ok && prev.result
                ? { ok: true, result: prev.result, running: true }
                : { running: true },
        );
        const formData = new FormData();
        formData.set("content", content);
        formData.set("targetModelId", effectiveTargetModelId);
        formData.set("judgeDeclaredInputs", judgeDeclaredInputPreset);
        formData.set("judgeTaskInput", judgeTaskInput);
        formData.set("judgeCandidateOutput", judgeCandidateOutput);
        formData.set("judgeReference", judgeReference);
        if (reasoningEffort) formData.set("reasoningEffort", reasoningEffort);

        let result: IPromptJudgeTestActionState;
        try {
            result = await judgeTestAction(formData);
        } catch {
            result = { formError: "Judge test failed. Try again." };
        }
        if (activeJudgeRunId.current !== runId) return;
        setJudgeTestState(result);
    }

    function cancelJudgeTestRun() {
        activeJudgeRunId.current += 1;
        setJudgeTestState({ cancelled: true });
    }

    function acceptOptimization() {
        if (
            !optimizeState.optimizedPrompt ||
            !optimizeState.optimizerAttemptId
        ) {
            return;
        }
        setContent(optimizeState.optimizedPrompt);
        setUnsaved(true);
        setAcceptedOptimizerAttemptId(optimizeState.optimizerAttemptId);
        setFitTags((current) =>
            mergeTagText(current, [
                ...(optimizeState.fitTags ?? []),
                effectiveTargetModelId,
            ]),
        );
    }

    function discardOptimization() {
        if (!optimizeState.optimizerAttemptId) return;
        setDismissedOptimizerAttemptId(optimizeState.optimizerAttemptId);
        if (acceptedOptimizerAttemptId === optimizeState.optimizerAttemptId) {
            setAcceptedOptimizerAttemptId(undefined);
        }
    }

    return (
        <>
            <UnsavedChangesGuard when={unsaved} />
            <section aria-label="Prompt workbench">
                <form
                    ref={formRef}
                    action={saveFormAction}
                    onChange={() => setUnsaved(true)}
                >
                    <KeepFieldsOnReset />
                    {/* Locks the editor while Save or Optimize is in flight. */}
                    <PendingFieldset className="flex flex-col gap-6">
                        <input type="hidden" name="kind" value={promptKind} />
                        <input
                            type="hidden"
                            name="transport"
                            value={effectiveTransport ?? ""}
                        />
                        {savedPromptId && (
                            <input
                                type="hidden"
                                name="promptId"
                                value={savedPromptId}
                            />
                        )}
                        <div className="grid gap-4 sm:grid-cols-6">
                            <div className="flex flex-col gap-2 sm:col-span-2">
                                <Label htmlFor="name">Name</Label>
                                <Input
                                    id="name"
                                    name="name"
                                    placeholder="Prompt name"
                                    defaultValue={initialPrompt?.name}
                                />
                                <FieldError errors={fieldErrors.name} />
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="kind">Kind</Label>
                                <Select
                                    value={promptKind}
                                    onValueChange={(value) =>
                                        setPromptKind(value as PromptKind)
                                    }
                                >
                                    <SelectTrigger id="kind">
                                        <SelectValue placeholder="Eval" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="eval">
                                            Eval
                                        </SelectItem>
                                        <SelectItem value="judge">
                                            Judge
                                        </SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div
                                className={
                                    selectedEffortCapability
                                        ? "sm:col-span-2"
                                        : "sm:col-span-3"
                                }
                            >
                                <div className="grid gap-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(220px,1.2fr)]">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <Label htmlFor="modelFamily">
                                                Model family
                                            </Label>
                                            <Hint content="The model this prompt is authored against; runs can still pair it with any model.">
                                                <button
                                                    type="button"
                                                    aria-label="About model family"
                                                    className="inline-flex items-center justify-center rounded-sm align-middle text-muted-foreground hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                                >
                                                    <Info
                                                        className="h-3.5 w-3.5"
                                                        aria-hidden="true"
                                                    />
                                                </button>
                                            </Hint>
                                        </div>
                                        <Select
                                            value={activeModelFamily}
                                            onValueChange={selectModelFamily}
                                            disabled={modelGroups.length === 0}
                                        >
                                            <SelectTrigger id="modelFamily">
                                                <SelectValue placeholder="Choose a model family" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {modelGroups.map((group) => (
                                                    <SelectItem
                                                        key={group.label}
                                                        value={group.label}
                                                    >
                                                        {group.label}
                                                    </SelectItem>
                                                ))}
                                                {modelGroups.length === 0 && (
                                                    <SelectItem value="OpenAI">
                                                        OpenAI
                                                    </SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <Label htmlFor="targetModelId">
                                            Model
                                        </Label>
                                        <Select
                                            name="targetModelId"
                                            value={effectiveTargetModelId}
                                            onValueChange={setTargetModelId}
                                        >
                                            <SelectTrigger id="targetModelId">
                                                <SelectValue placeholder="Choose a model" />
                                            </SelectTrigger>
                                            <SelectContent>
                                                {activeModelOptions.map(
                                                    (model) => (
                                                        <SelectItem
                                                            key={model.id}
                                                            value={model.id}
                                                            disabled={
                                                                !model.available ||
                                                                !model.structuredOutput
                                                            }
                                                        >
                                                            {model.label}
                                                            {!model.available
                                                                ? " (unavailable)"
                                                                : !model.structuredOutput
                                                                  ? " (no structured output)"
                                                                  : ""}
                                                        </SelectItem>
                                                    ),
                                                )}
                                                {activeModelOptions.length ===
                                                    0 && (
                                                    <SelectItem value="gpt-4o">
                                                        GPT-4o
                                                    </SelectItem>
                                                )}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {selectedTransports.length > 1 && (
                                        <div className="flex flex-col gap-2">
                                            <Label htmlFor="promptTransport">
                                                Transport
                                            </Label>
                                            <Select
                                                value={effectiveTransport}
                                                onValueChange={(value) =>
                                                    setTransport(
                                                        value as ProviderTransport,
                                                    )
                                                }
                                            >
                                                <SelectTrigger
                                                    id="promptTransport"
                                                    aria-label={`Transport for ${effectiveTargetModelId}`}
                                                >
                                                    <SelectValue placeholder="Default transport" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    {selectedTransports.map(
                                                        (option) => (
                                                            <SelectItem
                                                                key={option}
                                                                value={option}
                                                            >
                                                                {transportLabel(
                                                                    option,
                                                                )}
                                                            </SelectItem>
                                                        ),
                                                    )}
                                                </SelectContent>
                                            </Select>
                                        </div>
                                    )}
                                </div>
                                <FieldError
                                    errors={fieldErrors.targetModelId}
                                />
                            </div>
                            {selectedEffortCapability && (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="reasoningEffort">
                                        Reasoning effort
                                    </Label>
                                    <Select
                                        value={
                                            reasoningEffort ??
                                            selectedEffortCapability.defaultLevel
                                        }
                                        onValueChange={(value) =>
                                            setReasoningEffort(
                                                value as ReasoningEffort,
                                            )
                                        }
                                    >
                                        <SelectTrigger id="reasoningEffort">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {selectedEffortCapability.supportedLevels.map(
                                                (level) => (
                                                    <SelectItem
                                                        key={level}
                                                        value={level}
                                                    >
                                                        {
                                                            REASONING_EFFORT_LABELS[
                                                                level
                                                            ]
                                                        }
                                                    </SelectItem>
                                                ),
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            )}
                        </div>

                        <div className="flex flex-col gap-2">
                            <Label htmlFor="description">Description</Label>
                            <Textarea
                                id="description"
                                name="description"
                                rows={2}
                                placeholder="What is this prompt for? (optional)"
                                defaultValue={initialPrompt?.description}
                                className="font-sans"
                            />
                            <FieldError errors={fieldErrors.description} />
                        </div>

                        {optimizationReviewVisible && (
                            <div className="flex flex-col gap-3">
                                <Alert>
                                    <AlertDescription>
                                        Optimized prompt ready. Review the
                                        proposal below, then use it to replace
                                        the prompt editor.
                                    </AlertDescription>
                                </Alert>
                                <OptimizationReview
                                    originalPrompt={
                                        optimizeState.originalPrompt ?? content
                                    }
                                    proposedPrompt={
                                        optimizeState.optimizedPrompt ?? ""
                                    }
                                    rationale={
                                        optimizeState.optimizationRationale ??
                                        ""
                                    }
                                    fitTags={optimizeState.fitTags ?? []}
                                    structuredOutputNotes={
                                        optimizeState.structuredOutputNotes ??
                                        []
                                    }
                                    guidanceSource={
                                        optimizeState.optimizationGuidanceSource
                                    }
                                    optimizerModelId={
                                        optimizeState.optimizerModelId
                                    }
                                    targetModelId={
                                        optimizeState.optimizationTargetModelId
                                    }
                                    onAccept={acceptOptimization}
                                    onDiscard={discardOptimization}
                                />
                            </div>
                        )}

                        {optimizationApplied && (
                            <Alert>
                                <AlertDescription>
                                    Optimized prompt applied to the editor. Run
                                    a test, then save when the output looks
                                    good.
                                </AlertDescription>
                            </Alert>
                        )}

                        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="content">
                                    {promptKind === "judge"
                                        ? "Judge rubric"
                                        : "Prompt"}
                                </Label>
                                {promptKind === "eval" ? (
                                    <div className="flex items-start justify-between gap-3">
                                        <PromptHint />
                                        <OptimizePromptButton
                                            optimizeAction={optimizeFormAction}
                                        />
                                    </div>
                                ) : null}
                                <Textarea
                                    id="content"
                                    name="content"
                                    rows={13}
                                    placeholder="Describe the task and what the model should do with each input."
                                    value={content}
                                    onChange={(event) =>
                                        setContent(event.target.value)
                                    }
                                    className="font-sans"
                                />
                                <FieldError errors={fieldErrors.content} />
                            </div>
                            {promptKind === "eval" ? (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="jsonSchema">
                                        Output schema
                                    </Label>
                                    <div className="flex items-start justify-between gap-3">
                                        <SchemaHint
                                            generating={Boolean(
                                                generateState.running,
                                            )}
                                        />
                                        <Button
                                            id="generateSchemaBtn"
                                            type="button"
                                            size="sm"
                                            loading={generateState.running}
                                            loadingText="Generating schema…"
                                            onClick={() => void runGenerate()}
                                        >
                                            <Sparkles className="h-4 w-4" />
                                            Generate from prompt
                                        </Button>
                                    </div>
                                    <Textarea
                                        id="jsonSchema"
                                        name="jsonSchema"
                                        rows={13}
                                        placeholder="Generate a schema from the prompt, or paste your own."
                                        value={jsonSchema}
                                        onChange={(event) =>
                                            setJsonSchema(event.target.value)
                                        }
                                        className="text-mono-13"
                                    />
                                    <FieldError
                                        errors={fieldErrors.jsonSchema}
                                    />
                                    {schemaGateHint &&
                                    jsonSchema.trim() === "" ? (
                                        <p className="text-label-12 text-muted-foreground">
                                            A schema is required to run.
                                            Generate one from your prompt.
                                        </p>
                                    ) : null}
                                    {generateState.error ? (
                                        <p
                                            role="alert"
                                            className="text-label-12 text-error"
                                        >
                                            {generateState.error}
                                        </p>
                                    ) : null}
                                    {generateState.compatibilityErrors &&
                                    generateState.compatibilityErrors.length >
                                        0 ? (
                                        <Alert>
                                            <AlertDescription>
                                                Generated schema needs edits
                                                before it can run:{" "}
                                                {generateState.compatibilityErrors
                                                    .map(
                                                        (issue) =>
                                                            issue.message,
                                                    )
                                                    .join(" ")}
                                            </AlertDescription>
                                        </Alert>
                                    ) : null}
                                    {generateState.proposal ? (
                                        <Card
                                            variant="inset"
                                            className="flex flex-col gap-2 p-3"
                                        >
                                            <p className="text-label-12 text-on-surface">
                                                Replace the current schema with
                                                the generated one?
                                            </p>
                                            <pre className="max-h-48 overflow-auto rounded-sm bg-background p-2 text-mono-13">
                                                {generateState.proposal}
                                            </pre>
                                            <div className="flex gap-2">
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={
                                                        acceptGeneratedSchema
                                                    }
                                                >
                                                    Replace
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={
                                                        discardGeneratedSchema
                                                    }
                                                >
                                                    Discard
                                                </Button>
                                            </div>
                                        </Card>
                                    ) : null}
                                </div>
                            ) : (
                                <div className="flex flex-col gap-2">
                                    <Label id="judgeDeclaredInputs">
                                        Judge inputs
                                    </Label>
                                    <div
                                        role="group"
                                        aria-labelledby="judgeDeclaredInputs"
                                        className="flex flex-1 flex-col gap-2"
                                    >
                                        {JUDGE_INPUT_OPTIONS.map((option) => {
                                            const checked =
                                                selectedJudgeInputs.has(
                                                    option.value,
                                                );
                                            return (
                                                <label
                                                    key={option.value}
                                                    className={cn(
                                                        "flex cursor-pointer items-start gap-3 rounded-sm border border-border p-3 transition-colors hover:bg-muted/60",
                                                        checked && "bg-surface",
                                                    )}
                                                >
                                                    <Checkbox
                                                        checked={checked}
                                                        onChange={() =>
                                                            toggleJudgeInput(
                                                                option.value,
                                                            )
                                                        }
                                                        className="mt-0.5"
                                                    />
                                                    <span>
                                                        <span className="block text-label-14 text-on-surface">
                                                            {option.label}
                                                        </span>
                                                        <span className="block text-label-12 text-muted-foreground">
                                                            {option.hint}
                                                        </span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                    <input
                                        type="hidden"
                                        name="judgeDeclaredInputs"
                                        value={judgeDeclaredInputPreset}
                                    />
                                    <p className="text-copy-14 text-muted-foreground">
                                        The saved judge version records this
                                        input contract with its model and
                                        reasoning settings.
                                    </p>
                                    <FieldError
                                        errors={fieldErrors.judgeDeclaredInputs}
                                    />
                                </div>
                            )}
                        </div>

                        {promptKind === "eval" && (
                            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)]">
                                <div className="flex flex-col gap-2">
                                    <p className="text-label-12 text-muted-foreground">
                                        Test against text, an image, or both.
                                    </p>
                                    <Label htmlFor="sampleInput">Text</Label>
                                    <Textarea
                                        id="sampleInput"
                                        name="sampleInput"
                                        rows={3}
                                        placeholder="Text to test against (optional if you attach an image)."
                                        value={testInput}
                                        onChange={(event) =>
                                            setTestInput(event.target.value)
                                        }
                                        className="font-sans"
                                    />
                                    <FieldError
                                        errors={
                                            testState.fieldErrors?.testInput
                                        }
                                    />
                                    <div className="flex flex-col gap-2 pt-1">
                                        <Label htmlFor="testImage">Image</Label>
                                        <div>
                                            <FileDropzone
                                                key={testImageResetKey}
                                                id="testImage"
                                                accept={TEST_IMAGE_ACCEPT}
                                                maxBytes={TEST_IMAGE_MAX_BYTES}
                                                disabled={!modelSupportsVision}
                                                size="sm"
                                                title="Drop an image or click to browse"
                                                hint="PNG, JPEG, GIF, WebP · max 20MB"
                                                onFilesChange={(files) =>
                                                    setTestImage(files[0])
                                                }
                                            />
                                        </div>
                                        {!modelSupportsVision ? (
                                            <p className="text-label-12 text-muted-foreground">
                                                {selectedModel?.label ??
                                                    "This model"}{" "}
                                                does not support image input.
                                            </p>
                                        ) : null}
                                        <FieldError
                                            errors={
                                                testState.fieldErrors?.imageFile
                                            }
                                        />
                                    </div>
                                </div>
                                <div className="flex flex-col gap-2">
                                    <p className="text-label-12 text-muted-foreground">
                                        Models or capabilities this prompt fits.
                                    </p>
                                    <Label htmlFor="fitTags">Tags</Label>
                                    <div>
                                        <TagInput
                                            id="fitTags"
                                            name="fitTags"
                                            value={fitTags}
                                            onChange={setFitTags}
                                            suggestions={tagSuggestions}
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {promptKind === "eval" ? (
                            <div className="flex flex-col gap-4 border-t border-border pt-6">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <SectionTitle
                                        as="h3"
                                        description="Run the draft prompt and schema against the input above, without saving."
                                    >
                                        Test
                                    </SectionTitle>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void runTest()}
                                            loading={testState.running}
                                            loadingText="Running test…"
                                        >
                                            <Play className="h-4 w-4" />
                                            Run test
                                        </Button>
                                        {testState.running && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                onClick={cancelTestRun}
                                            >
                                                <CircleStop className="h-4 w-4" />
                                                Cancel
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                {modelsDegraded && (
                                    <p
                                        role="status"
                                        className="rounded-sm bg-surface px-3 py-2 text-copy-14 text-muted-foreground"
                                    >
                                        Model availability could not be
                                        verified. A test run may fail if the
                                        selected model is unavailable.
                                    </p>
                                )}

                                <TestRunStateView state={testState} />

                                <TestHistoryView
                                    history={testHistory}
                                    onClear={clearTestHistory}
                                />
                            </div>
                        ) : (
                            <div className="flex flex-col gap-4 border-t border-border pt-6">
                                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                                    <SectionTitle
                                        as="h3"
                                        description="Runs the draft rubric against the declared inputs and returns the fixed score and rationale verdict."
                                    >
                                        Judge test
                                    </SectionTitle>
                                    <div className="flex flex-wrap gap-2">
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void runJudgeTest()}
                                            loading={judgeTestState.running}
                                            loadingText="Running judge…"
                                        >
                                            <Play className="h-4 w-4" />
                                            Run judge
                                        </Button>
                                        {judgeTestState.running && (
                                            <Button
                                                type="button"
                                                size="sm"
                                                variant="secondary"
                                                onClick={cancelJudgeTestRun}
                                            >
                                                <CircleStop className="h-4 w-4" />
                                                Cancel
                                            </Button>
                                        )}
                                    </div>
                                </div>

                                <div className="grid gap-4 lg:grid-cols-2">
                                    {declaredJudgeInputs.includes(
                                        "task_input",
                                    ) && (
                                        <div className="flex flex-col gap-2">
                                            <Label htmlFor="judgeTaskInput">
                                                Task input
                                            </Label>
                                            <Textarea
                                                id="judgeTaskInput"
                                                rows={4}
                                                placeholder="The task the candidate was responding to."
                                                value={judgeTaskInput}
                                                onChange={(event) =>
                                                    setJudgeTaskInput(
                                                        event.target.value,
                                                    )
                                                }
                                                className="font-sans"
                                            />
                                            <FieldError
                                                errors={
                                                    judgeTestState.fieldErrors
                                                        ?.judgeTaskInput
                                                }
                                            />
                                        </div>
                                    )}
                                    {declaredJudgeInputs.includes(
                                        "candidate_output",
                                    ) && (
                                        <div className="flex flex-col gap-2">
                                            <Label htmlFor="judgeCandidateOutput">
                                                Candidate output
                                            </Label>
                                            <Textarea
                                                id="judgeCandidateOutput"
                                                rows={4}
                                                placeholder="Candidate output to score (JSON or text)."
                                                value={judgeCandidateOutput}
                                                onChange={(event) =>
                                                    setJudgeCandidateOutput(
                                                        event.target.value,
                                                    )
                                                }
                                                className="text-mono-13"
                                            />
                                            <FieldError
                                                errors={
                                                    judgeTestState.fieldErrors
                                                        ?.judgeCandidateOutput
                                                }
                                            />
                                        </div>
                                    )}
                                    {declaredJudgeInputs.includes(
                                        "reference",
                                    ) && (
                                        <div className="flex flex-col gap-2">
                                            <Label htmlFor="judgeReference">
                                                Reference output
                                            </Label>
                                            <Textarea
                                                id="judgeReference"
                                                rows={4}
                                                placeholder="Reference / golden output to compare against."
                                                value={judgeReference}
                                                onChange={(event) =>
                                                    setJudgeReference(
                                                        event.target.value,
                                                    )
                                                }
                                                className="text-mono-13"
                                            />
                                            <FieldError
                                                errors={
                                                    judgeTestState.fieldErrors
                                                        ?.judgeReference
                                                }
                                            />
                                        </div>
                                    )}
                                </div>

                                <JudgeTestStateView state={judgeTestState} />
                            </div>
                        )}

                        <input name="fieldConfigs" type="hidden" value="[]" />
                        <input
                            name="reasoningEffort"
                            type="hidden"
                            value={
                                reasoningEffort ??
                                selectedEffortCapability?.defaultLevel ??
                                ""
                            }
                        />
                        {acceptedOptimizerAttemptId && (
                            <input
                                name="optimizerAttemptId"
                                type="hidden"
                                value={acceptedOptimizerAttemptId}
                            />
                        )}

                        {(saveState.formError || optimizeState.formError) && (
                            <Alert variant="destructive">
                                <AlertDescription>
                                    {saveState.formError ??
                                        optimizeState.formError}
                                </AlertDescription>
                            </Alert>
                        )}
                        {saveState.validationSummary ? (
                            <Alert>
                                <AlertDescription>
                                    {saveState.validationSummary}
                                </AlertDescription>
                            </Alert>
                        ) : optimizeState.validationSummary ? (
                            <Alert>
                                <AlertDescription>
                                    {optimizeState.optimizationGuidanceSource ? (
                                        <>
                                            Optimized by{" "}
                                            {optimizeState.optimizerModelId ? (
                                                <span className="text-mono-13">
                                                    {
                                                        optimizeState.optimizerModelId
                                                    }
                                                </span>
                                            ) : (
                                                "AI"
                                            )}{" "}
                                            for{" "}
                                            {optimizeState.optimizationTargetModelId ? (
                                                <span className="text-mono-13">
                                                    {
                                                        optimizeState.optimizationTargetModelId
                                                    }
                                                </span>
                                            ) : (
                                                "the target model"
                                            )}{" "}
                                            using{" "}
                                            {isExternalGuidanceUrl(
                                                optimizeState
                                                    .optimizationGuidanceSource
                                                    .url,
                                            ) ? (
                                                <ExternalLink
                                                    href={
                                                        optimizeState
                                                            .optimizationGuidanceSource
                                                            .url
                                                    }
                                                    className="text-inherit underline underline-offset-2 hover:text-on-surface"
                                                >
                                                    {
                                                        optimizeState
                                                            .optimizationGuidanceSource
                                                            .title
                                                    }
                                                </ExternalLink>
                                            ) : (
                                                optimizeState
                                                    .optimizationGuidanceSource
                                                    .title
                                            )}
                                            .
                                        </>
                                    ) : (
                                        optimizeState.validationSummary
                                    )}
                                </AlertDescription>
                            </Alert>
                        ) : null}
                        <div className="flex flex-wrap gap-2 border-t border-border pt-6">
                            <SaveButton promptKind={promptKind} />
                        </div>
                    </PendingFieldset>
                </form>
            </section>
        </>
    );
}

function FieldError({ errors }: { errors?: string[] }) {
    if (!errors?.length) return null;
    return (
        <p role="alert" className="text-copy-14 text-error">
            {errors[0]}
        </p>
    );
}

function isExternalGuidanceUrl(url: string): boolean {
    return url.startsWith("https://") || url.startsWith("http://");
}

function mergeTagText(current: string, incoming: string[]) {
    const tags = [...current.split(/[\n,]/), ...incoming]
        .map((tag) => tag.trim())
        .filter(Boolean);
    return [...new Set(tags)].join(", ");
}

function TestHistoryView({
    history,
    onClear,
}: {
    history: ITestHistoryEntry[];
    onClear: () => void;
}) {
    if (history.length === 0) return null;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
                <Label>Test history</Label>
                <ConfirmDialog
                    trigger={
                        <Button type="button" size="sm" variant="ghost">
                            <Trash2 className="h-4 w-4" />
                            Clear
                        </Button>
                    }
                    title="Clear test history?"
                    description="Past test results in this session are removed. Your draft prompt and schema are kept."
                    confirmLabel="Clear history"
                    onConfirm={onClear}
                />
            </div>
            <p className="text-label-12 text-muted-foreground">
                In-session only. Not saved, cleared on reload.
            </p>
            <div className="flex flex-col gap-2">
                {history.map((entry) => (
                    <Card key={entry.id} className="px-3 py-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <PromptTestStatusBadge
                                status={entry.result.status}
                            />
                            <span className="text-mono-13 text-muted-foreground">
                                {entry.config.modelId}
                            </span>
                            {entry.config.reasoningEffort && (
                                <span className="text-mono-13 text-muted-foreground">
                                    effort:{entry.config.reasoningEffort}
                                </span>
                            )}
                            <span className="text-mono-13 text-muted-foreground">
                                schema v{entry.config.schemaVersion}
                            </span>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}

/**
 * A run in flight: a status line, and the previous result (if any) kept
 * visible but dimmed so the panel doesn't collapse and jump.
 */
function RunningResult({
    label,
    children,
}: {
    label: string;
    children?: React.ReactNode;
}) {
    return (
        <div className="flex flex-col gap-4">
            <p
                role="status"
                className="flex items-center gap-2 rounded-sm bg-surface px-3 py-2 text-copy-14 text-muted-foreground"
            >
                <Spinner size="sm" />
                {label}
            </p>
            {children && <StaleRegion stale>{children}</StaleRegion>}
        </div>
    );
}

function TestRunStateView({
    state,
}: {
    state: IPromptTestRunActionState & {
        running?: boolean;
        cancelled?: boolean;
    };
}) {
    if (state.running) {
        return (
            <RunningResult label="Running test…">
                {state.result && (
                    <TestRunStateView
                        state={{ ok: true, result: state.result }}
                    />
                )}
            </RunningResult>
        );
    }
    if (state.cancelled) {
        return (
            <Alert>
                <AlertDescription>
                    Cancelled. Draft content was preserved.
                </AlertDescription>
            </Alert>
        );
    }
    if (state.formError) {
        return (
            <Alert variant="destructive">
                <AlertDescription>{state.formError}</AlertDescription>
            </Alert>
        );
    }
    if (!state.result) return null;

    const fmtResultCost = formatCostColumn(
        state.result.results.map((result) => result.costUsd),
    );

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
                <PromptTestStatusBadge status={state.result.status} />
                <span className="text-mono-13 text-muted-foreground">
                    {state.result.targetModelId}
                </span>
                {state.result.reasoningEffort && (
                    <span className="text-mono-13 text-muted-foreground">
                        effort:{state.result.reasoningEffort}
                    </span>
                )}
            </div>
            {state.result.results.map((result, index) => (
                <Card
                    key={`${result.sampleName}-${index}`}
                    className="flex flex-col gap-3 p-3"
                >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-mono-13 text-on-surface">
                                {result.sampleName}
                            </span>
                            <PromptTestResultBadge status={result.status} />
                        </div>
                        <div className="flex flex-wrap gap-3 text-copy-14 tabular-nums text-muted-foreground">
                            <span>{tokenSummary(result.usage)}</span>
                            <span>{latencySummary(result.latencyMs)}</span>
                            <span>
                                {result.costUsd === undefined
                                    ? "cost unavailable"
                                    : fmtResultCost(result.costUsd)}
                            </span>
                        </div>
                    </div>

                    {result.error && (
                        <p className="text-copy-14 text-error">
                            {result.error}
                        </p>
                    )}
                    {!result.validation.valid &&
                        result.validation.errors.length > 0 && (
                            <ul className="flex flex-col gap-1 text-copy-14 text-error">
                                {result.validation.errors.map(
                                    (error, errorIndex) => (
                                        <li key={`${error.path}-${errorIndex}`}>
                                            <span className="text-mono-13">
                                                {error.path}
                                            </span>
                                            : {error.message}
                                        </li>
                                    ),
                                )}
                            </ul>
                        )}

                    <div className="grid gap-3 lg:grid-cols-2">
                        <div>
                            <p className="pb-1 text-label-12 text-muted-foreground">
                                Raw output
                            </p>
                            <pre className="max-h-56 overflow-auto rounded-sm bg-surface p-2 text-mono-13 text-on-surface">
                                {result.rawOutput ?? "No output"}
                            </pre>
                        </div>
                        <div>
                            <p className="pb-1 text-label-12 text-muted-foreground">
                                Parsed output
                            </p>
                            <pre className="max-h-56 overflow-auto rounded-sm bg-surface p-2 text-mono-13 text-on-surface">
                                {result.parsedOutput === undefined
                                    ? "No parsed output"
                                    : JSON.stringify(
                                          result.parsedOutput,
                                          null,
                                          2,
                                      )}
                            </pre>
                        </div>
                    </div>
                </Card>
            ))}
        </div>
    );
}

function JudgeTestStateView({
    state,
}: {
    state: IPromptJudgeTestActionState & {
        running?: boolean;
        cancelled?: boolean;
    };
}) {
    if (state.running) {
        return (
            <RunningResult label="Running judge…">
                {state.result && (
                    <JudgeTestStateView
                        state={{ ok: true, result: state.result }}
                    />
                )}
            </RunningResult>
        );
    }
    if (state.cancelled) {
        return (
            <Alert>
                <AlertDescription>
                    Cancelled. Draft content was preserved.
                </AlertDescription>
            </Alert>
        );
    }
    if (state.formError) {
        return (
            <Alert variant="destructive">
                <AlertDescription>{state.formError}</AlertDescription>
            </Alert>
        );
    }
    if (!state.result) return null;

    return (
        <Card className="flex flex-col gap-2 p-3">
            <div className="flex flex-wrap items-center gap-2">
                <ScorePill label="Score" score={state.result.score} />
                <span className="text-copy-14 text-muted-foreground">
                    Judge verdict
                </span>
            </div>
            <p className="text-copy-14 text-on-surface">
                {state.result.rationale}
            </p>
        </Card>
    );
}

function firstSelectableModelId(
    availableModels: IWorkbenchModelOption[],
): string | undefined {
    return (
        availableModels.find(
            (model) => model.available && model.structuredOutput,
        )?.id ?? availableModels.find((model) => model.structuredOutput)?.id
    );
}

function modelsWithCurrentTarget(
    availableModels: IWorkbenchModelOption[],
    targetModelId: string | undefined,
): IWorkbenchModelOption[] {
    if (
        !targetModelId ||
        availableModels.some((model) => model.id === targetModelId)
    ) {
        return availableModels;
    }
    return [
        {
            id: targetModelId,
            label: targetModelId,
            providerLabel: "Current",
            reasoning: false,
            vision: true,
            available: true,
            structuredOutput: true,
            transports: [],
        },
        ...availableModels,
    ];
}

function modelsByProvider(
    availableModels: IWorkbenchModelOption[],
): IWorkbenchModelGroup[] {
    const groups = new Map<string, IWorkbenchModelGroup>();
    for (const model of availableModels) {
        const label = model.providerLabel ?? "OpenAI";
        const group = groups.get(label) ?? { label, models: [] };
        group.models.push(model);
        groups.set(label, group);
    }
    return [...groups.values()];
}

function tokenSummary(
    usage:
        | {
              promptTokens?: number;
              completionTokens?: number;
              reasoningTokens?: number;
              cacheReadTokens?: number;
              cacheWriteTokens?: number;
          }
        | undefined,
) {
    if (!usage) return "tokens unavailable";
    const parts = [
        `in ${usage.promptTokens ?? "?"}`,
        `out ${usage.completionTokens ?? "?"}`,
    ];
    if (usage.reasoningTokens !== undefined) {
        parts.push(`reasoning ${usage.reasoningTokens}`);
    }
    if (usage.cacheReadTokens !== undefined) {
        parts.push(`cache read ${usage.cacheReadTokens}`);
    }
    if (usage.cacheWriteTokens !== undefined) {
        parts.push(`cache write ${usage.cacheWriteTokens}`);
    }
    return parts.join(" / ");
}

function latencySummary(latencyMs: number | undefined) {
    return latencyMs === undefined
        ? "latency unavailable"
        : `${Math.round(latencyMs)}ms`;
}
