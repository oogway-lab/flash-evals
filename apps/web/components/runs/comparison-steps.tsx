"use client";

import { useId, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Pencil, Trash2 } from "lucide-react";
import {
    taskMapNeedsJudge,
    taskPaths,
    type IBenchmarkTask,
    type IRunSetupDatasetOption,
    type IRunSetupModelOption,
    type IRunSetupVersionOption,
    type ISetupComparisonPipelineOption,
    type ProviderTransport,
} from "@flash-evals/api-contract";
import type { IActionState } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Num } from "@/components/ui/num";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/cn";
import { offerPrice } from "@/lib/model-prices";
import { transportLabel } from "@/lib/transport";
import {
    newTask,
    schemaPaths,
    type IBenchmarkFormState,
} from "./benchmark-settings";
import type { estimateComparison } from "./comparison-estimate";
import {
    ASSUMED_SECONDS_PER_CALL,
    fmtMinutes,
    fmtUsd,
    pipelineLineId,
} from "./comparison-estimate";
import {
    datasetLabel,
    runnable,
    STEPS,
    storedAnswers,
    type Step,
} from "./comparison-state";
import { DataRules } from "./data-rules";
import { ItemFilterFields } from "./item-filter-fields";
import { modelOffers, ProviderSelect } from "./provider-select";
import {
    BenchmarkSourcePicker,
    DraftTasksButton,
    type ProposeTaskMapAction,
} from "./run-benchmark-controls";
import { TaskEditor } from "./run-benchmark-section";
import { starterRulesTask } from "./rule-checks";
import { starterRubricTask } from "./rubric-criteria";
import { taskMethodLabel } from "./task-grid";
import { taskTargetText } from "./task-target";
import { SpendLimitField } from "./spend-limit-field";

export function StepCard({
    step,
    current,
    done,
    summary,
    canContinue,
    onOpen,
    children,
}: {
    step: Step;
    current: Step;
    done: boolean;
    summary?: string;
    canContinue: boolean;
    onOpen: (step: Step) => void;
    children: React.ReactNode;
}) {
    const open = step === current;
    const title = STEPS[step - 1]!.title;
    return (
        <li>
            <Card>
                <CardHeader className="flex flex-row items-start justify-between gap-3">
                    <CardTitle as="h2" className="flex items-center gap-2">
                        <span
                            className={cn(
                                "inline-flex size-6 items-center justify-center rounded-full text-label-12",
                                done && !open
                                    ? "bg-eval-success-muted text-eval-success"
                                    : "bg-muted text-muted-foreground",
                            )}
                            aria-hidden="true"
                        >
                            {done && !open ? (
                                <Check className="size-3.5" />
                            ) : (
                                step
                            )}
                        </span>
                        {title}
                    </CardTitle>
                    {!open && (
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => onOpen(step)}
                        >
                            {summary ? "Change" : "Open"}
                            <span className="sr-only"> {title}</span>
                        </Button>
                    )}
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                    {!open && summary && (
                        <p className="text-copy-14 text-muted-foreground">
                            {summary}
                        </p>
                    )}
                    {/* Kept mounted so form state survives switching steps. */}
                    <div
                        className={cn("flex flex-col gap-4", !open && "hidden")}
                    >
                        {children}
                        {open && step < 4 && (
                            <Button
                                type="button"
                                className="self-start"
                                disabled={!canContinue}
                                onClick={() => onOpen((step + 1) as Step)}
                            >
                                Continue
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>
        </li>
    );
}

export function StepToday({
    datasets,
    datasetId,
    onDataset,
    versions,
    versionId,
    onVersion,
    models,
    referenceId,
    onReference,
    transportOf,
    onTransport,
}: {
    datasets: IRunSetupDatasetOption[];
    datasetId: string;
    onDataset: (id: string) => void;
    versions: IRunSetupVersionOption[];
    versionId: string;
    onVersion: (id: string) => void;
    models: IRunSetupModelOption[];
    referenceId: string;
    onReference: (id: string) => void;
    transportOf: (id: string) => ProviderTransport | undefined;
    onTransport: (id: string, transport: ProviderTransport) => void;
}) {
    return (
        <>
            <p className="text-copy-14 text-muted-foreground">
                The transcripts to test on, the prompt production uses, and the
                model it runs on today. Everything else is compared with that
                model.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="compare-dataset">Transcripts</Label>
                    <Select
                        value={datasetId}
                        onValueChange={(value) => onDataset(String(value))}
                    >
                        <SelectTrigger id="compare-dataset">
                            <SelectValue placeholder="Choose a dataset" />
                        </SelectTrigger>
                        <SelectContent>
                            {datasets.map((dataset) => (
                                <SelectItem key={dataset.id} value={dataset.id}>
                                    {datasetLabel(dataset)}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="compare-prompt">Prompt</Label>
                    <Select
                        value={versionId}
                        onValueChange={(value) => onVersion(String(value))}
                    >
                        <SelectTrigger id="compare-prompt">
                            <SelectValue placeholder="Choose a prompt version" />
                        </SelectTrigger>
                        <SelectContent>
                            {versions.map((version) => (
                                <SelectItem key={version.id} value={version.id}>
                                    {version.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <ModelSearchList
                label="Today's model"
                models={models}
                selected={referenceId ? [referenceId] : []}
                onToggle={onReference}
                single
                transportOf={transportOf}
                onTransport={onTransport}
            />
        </>
    );
}

function TargetInput({
    id,
    label,
    value,
    placeholder,
    onChange,
}: {
    id: string;
    label: string;
    value: string;
    placeholder?: string;
    onChange: (value: string) => void;
}) {
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>{label}</Label>
            <Input
                id={id}
                type="number"
                inputMode="decimal"
                min="0"
                value={value}
                placeholder={placeholder}
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    );
}

function taskTarget(
    task: IBenchmarkTask,
    state: IBenchmarkFormState,
    referenceName: string | undefined,
): string {
    const pct = (value: string, fallback: number) => {
        const parsed = Number(value);
        return value.trim() && Number.isFinite(parsed) ? parsed : fallback;
    };
    const maxDrop = Number(state.maxDropPts);
    return taskTargetText({
        task,
        source: task.source ?? state.source,
        ...(state.maxDropPts.trim() && Number.isFinite(maxDrop)
            ? { maxDropPts: maxDrop }
            : {}),
        minAgreementPct: pct(state.minAgreementPct, 90),
        minWinOrTiePct: pct(state.minWinOrTiePct, 90),
        referenceName,
    });
}

export function StepTasks({
    benchmark,
    onChange,
    version,
    dataset,
    referenceName,
    errors,
    models,
    judgeTransport,
    proposeTaskMapAction,
}: {
    benchmark: IBenchmarkFormState;
    onChange: (state: IBenchmarkFormState) => void;
    version: IRunSetupVersionOption | undefined;
    dataset: IRunSetupDatasetOption | undefined;
    referenceName: string | undefined;
    errors: string[];
    models: IRunSetupModelOption[];
    judgeTransport: ProviderTransport | undefined;
    proposeTaskMapAction?: ProposeTaskMapAction;
}) {
    const [editing, setEditing] = useState<number>();
    const pathListId = useId();
    const tasks = benchmark.taskMap.tasks;
    const setTasks = (next: IBenchmarkTask[]) =>
        onChange({ ...benchmark, taskMap: { tasks: next } });
    const judges = models.filter(
        (m) => runnable(m) && m.judgeSuitable && m.structuredOutput,
    );
    return (
        <>
            <p className="text-copy-14 text-muted-foreground">
                The jobs the prompt does, each compared on its own. Drafted from
                the prompt&apos;s output fields; remove what nobody checks and
                edit the rest.
            </p>
            {storedAnswers(dataset) && (
                <BenchmarkSourcePicker
                    source={benchmark.source}
                    onChange={(source) => onChange({ ...benchmark, source })}
                />
            )}
            {proposeTaskMapAction && version && (
                <DraftTasksButton
                    promptVersionId={version.id}
                    action={proposeTaskMapAction}
                    onDraft={(taskMap) => onChange({ ...benchmark, taskMap })}
                />
            )}
            <div className="overflow-x-auto rounded-sm border border-border">
                <table className="w-full text-copy-14">
                    <thead className="bg-surface text-label-12 text-muted-foreground">
                        <tr>
                            <th className="p-2 text-left">Task</th>
                            <th className="p-2 text-left">
                                How it&apos;s compared
                            </th>
                            <th className="p-2 text-left">Against</th>
                            <th className="p-2 text-left">Target</th>
                            <th className="p-2">
                                <span className="sr-only">Actions</span>
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        {tasks.map((task, index) => (
                            <TaskRow
                                key={`${task.key}-${index}`}
                                task={task}
                                against={
                                    task.method === "rules"
                                        ? "Fixed rules"
                                        : task.method === "rubric"
                                          ? "Judge's 1–5 scores"
                                          : (task.source ??
                                                  benchmark.source) === "labels"
                                            ? "Stored answers"
                                            : (referenceName ?? "Today's model")
                                }
                                target={taskTarget(
                                    task,
                                    benchmark,
                                    referenceName,
                                )}
                                editing={editing === index}
                                onEdit={() =>
                                    setEditing(
                                        editing === index ? undefined : index,
                                    )
                                }
                                onRemove={() => {
                                    setTasks(
                                        tasks.filter((_, i) => i !== index),
                                    );
                                    setEditing(undefined);
                                }}
                                editor={
                                    <TaskEditor
                                        task={task}
                                        index={index}
                                        pathListId={pathListId}
                                        canUseStoredAnswers={storedAnswers(
                                            dataset,
                                        )}
                                        onChange={(next) =>
                                            setTasks(
                                                tasks.map((t, i) =>
                                                    i === index ? next : t,
                                                ),
                                            )
                                        }
                                        onRemove={() => {
                                            setTasks(
                                                tasks.filter(
                                                    (_, i) => i !== index,
                                                ),
                                            );
                                            setEditing(undefined);
                                        }}
                                    />
                                }
                            />
                        ))}
                    </tbody>
                </table>
            </div>
            <datalist id={pathListId}>
                {schemaPaths(version?.outputSchema).map((path) => (
                    <option key={path} value={path} />
                ))}
            </datalist>
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        setTasks([...tasks, newTask(tasks)]);
                        setEditing(tasks.length);
                    }}
                >
                    Add a task
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        setTasks([
                            ...tasks,
                            starterRulesTask(version?.outputSchema, tasks),
                        ]);
                        setEditing(tasks.length);
                    }}
                >
                    Add rule checks
                </Button>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        setTasks([
                            ...tasks,
                            starterRubricTask(version?.outputSchema, tasks),
                        ]);
                        setEditing(tasks.length);
                    }}
                >
                    Add rubric
                </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
                <TargetInput
                    id="compare-max-drop"
                    label="Allowed drop below today's model (points)"
                    value={benchmark.maxDropPts}
                    placeholder="Use the minimum"
                    onChange={(value) =>
                        onChange({ ...benchmark, maxDropPts: value })
                    }
                />
                <TargetInput
                    id="compare-min-agreement"
                    label="Minimum agreement (%)"
                    value={benchmark.minAgreementPct}
                    onChange={(value) =>
                        onChange({ ...benchmark, minAgreementPct: value })
                    }
                />
                <TargetInput
                    id="compare-min-won"
                    label="Judged tasks: won or tied (%)"
                    value={benchmark.minWinOrTiePct}
                    onChange={(value) =>
                        onChange({ ...benchmark, minWinOrTiePct: value })
                    }
                />
            </div>
            <p className="text-label-12 text-muted-foreground">
                The allowed drop applies where today&apos;s model is scored too
                (tasks against stored answers, judged ones included, and rule
                checks): the target is no more than that many points below its
                own rate on the same items, so matching or beating it passes.
                Other tasks use the minimums.
            </p>
            {taskMapNeedsJudge(benchmark.taskMap) && (
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="compare-judge">Judge</Label>
                        <Select
                            value={benchmark.judgeModelId}
                            onValueChange={(value) =>
                                onChange({
                                    ...benchmark,
                                    judgeModelId: String(value),
                                })
                            }
                        >
                            <SelectTrigger id="compare-judge">
                                <SelectValue placeholder="Choose a judge model" />
                            </SelectTrigger>
                            <SelectContent>
                                {judges.map((model) => (
                                    <SelectItem key={model.id} value={model.id}>
                                        {model.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                        <p className="text-label-12 text-muted-foreground">
                            Decides judged tasks and settles differences. Pick
                            one that isn&apos;t from a candidate&apos;s family.
                        </p>
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor="compare-judge-provider">
                            Judge provider
                        </Label>
                        <ProviderSelect
                            id="compare-judge-provider"
                            model={models.find(
                                (m) => m.id === benchmark.judgeModelId,
                            )}
                            value={judgeTransport}
                            onChange={(transport) =>
                                onChange({
                                    ...benchmark,
                                    judgeTransport: transport,
                                })
                            }
                        />
                    </div>
                </div>
            )}
            {errors.length > 0 && (
                <ul
                    aria-live="polite"
                    className="flex list-disc flex-col gap-1 pl-4 text-copy-14 text-error"
                >
                    {errors.map((error) => (
                        <li key={error}>{error}</li>
                    ))}
                </ul>
            )}
        </>
    );
}

function TaskRow({
    task,
    against,
    target,
    editing,
    onEdit,
    onRemove,
    editor,
}: {
    task: IBenchmarkTask;
    against: string;
    target: string;
    editing: boolean;
    onEdit: () => void;
    onRemove: () => void;
    editor: React.ReactNode;
}) {
    const fields =
        task.method === "rules"
            ? task.rules.map((rule) => rule.name)
            : task.method === "rubric"
              ? task.criteria.map((criterion) => criterion.name)
              : taskPaths(task).map((path) => path.replace(/^\$\./, ""));
    return (
        <>
            <tr className="border-t border-border align-top">
                <td className="p-2">
                    <span className="flex flex-col">
                        <span className="text-on-surface">
                            {task.name || "Unnamed task"}
                        </span>
                        <span className="text-mono-13 text-muted-foreground">
                            {fields.join(", ")}
                        </span>
                    </span>
                </td>
                <td className="p-2">{taskMethodLabel(task)}</td>
                <td className="p-2">{against}</td>
                <td className="p-2">
                    <Num>{target}</Num>
                </td>
                <td className="whitespace-nowrap p-2 text-right">
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-expanded={editing}
                        onClick={onEdit}
                    >
                        <Pencil className="size-4" aria-hidden="true" />
                        <span className="sr-only">Edit {task.name}</span>
                    </Button>
                    <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={onRemove}
                    >
                        <Trash2 className="size-4" aria-hidden="true" />
                        <span className="sr-only">Remove {task.name}</span>
                    </Button>
                </td>
            </tr>
            {editing && (
                <tr>
                    <td colSpan={5} className="p-2">
                        {editor}
                    </td>
                </tr>
            )}
        </>
    );
}

/**
 * The cheapest list price with a key, input plus a quarter of output, for
 * ordering only. Free ($0) tiers and unpriced models sort last.
 */
function listPrice(model: IRunSetupModelOption): number {
    const prices = modelOffers(model)
        .filter((offer) => offer.keySaved)
        .flatMap((offer) =>
            offer.inputPerMillion !== undefined &&
            offer.outputPerMillion !== undefined
                ? [offer.inputPerMillion + offer.outputPerMillion / 4]
                : [],
        )
        .filter((price) => price > 0);
    return prices.length > 0 ? Math.min(...prices) : Number.POSITIVE_INFINITY;
}

function ModelSearchList({
    label,
    models,
    selected,
    onToggle,
    single,
    transportOf,
    onTransport,
    perCall,
    referencePerCall,
    exclude,
    cheapestFirst,
}: {
    label: string;
    models: IRunSetupModelOption[];
    selected: string[];
    onToggle: (id: string) => void;
    single?: boolean;
    transportOf: (id: string) => ProviderTransport | undefined;
    onTransport: (id: string, transport: ProviderTransport) => void;
    perCall?: (id: string) => number | undefined;
    referencePerCall?: number;
    exclude?: string;
    /** Order unchosen models cheapest first (the candidate list). */
    cheapestFirst?: boolean;
}) {
    const [query, setQuery] = useState("");
    const searchId = useId();
    const shown = useMemo(() => {
        const text = query.trim().toLowerCase();
        const matches = models.filter(
            (model) =>
                runnable(model) &&
                model.id !== exclude &&
                (!text ||
                    `${model.label} ${model.id} ${model.providerLabel}`
                        .toLowerCase()
                        .includes(text)),
        );
        const chosen = matches.filter((m) => selected.includes(m.id));
        const rest = matches.filter((m) => !selected.includes(m.id));
        // Candidates: cheapest first, structured output first, free tiers last.
        if (cheapestFirst)
            rest.sort(
                (a, b) =>
                    Number(b.structuredOutput) - Number(a.structuredOutput) ||
                    listPrice(a) - listPrice(b),
            );
        return [...chosen, ...rest.slice(0, text ? 30 : 12)];
    }, [models, query, selected, exclude, cheapestFirst]);
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={searchId}>{label}</Label>
            <Input
                id={searchId}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name, maker or ID…"
            />
            <ul className="flex flex-col divide-y divide-border rounded-sm border border-border">
                {shown.map((model) => {
                    const checked = selected.includes(model.id);
                    const cost = perCall?.(model.id);
                    return (
                        <li
                            key={model.id}
                            className="grid gap-2 p-2 sm:grid-cols-[minmax(0,1fr)_minmax(200px,0.9fr)] sm:items-center"
                        >
                            <label className="flex min-w-0 items-start gap-2">
                                <Checkbox
                                    type={single ? "radio" : "checkbox"}
                                    name={
                                        single ? `${searchId}-pick` : undefined
                                    }
                                    checked={checked}
                                    onChange={() => onToggle(model.id)}
                                    className={
                                        single ? "rounded-full" : undefined
                                    }
                                />
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-copy-14 text-on-surface">
                                        {model.label}
                                    </span>
                                    <span className="truncate text-mono-13 text-muted-foreground">
                                        {model.id}
                                    </span>
                                    {cost !== undefined && (
                                        <span className="text-label-12 text-muted-foreground">
                                            {`≈ ${fmtUsd(cost)} per call`}
                                            {referencePerCall
                                                ? ` · ${Math.round((cost / referencePerCall) * 1000) / 10}% of today's model`
                                                : ""}
                                        </span>
                                    )}
                                </span>
                            </label>
                            {checked ? (
                                <ProviderSelect
                                    id={`${searchId}-${model.id}`}
                                    label={`Provider for ${model.label}`}
                                    model={model}
                                    value={transportOf(model.id)}
                                    onChange={(transport) =>
                                        onTransport(model.id, transport)
                                    }
                                />
                            ) : (
                                <span className="text-label-12 text-muted-foreground">
                                    {modelOffers(model)
                                        .filter((offer) => offer.keySaved)
                                        .map(
                                            (offer) =>
                                                `${transportLabel(offer.transport)} ${offerPrice(offer) ?? ""}`,
                                        )
                                        .join(" · ")}
                                </span>
                            )}
                        </li>
                    );
                })}
                {shown.length === 0 && (
                    <li className="p-2 text-copy-14 text-muted-foreground">
                        No model with a provider key matches.
                    </li>
                )}
            </ul>
        </div>
    );
}

export function StepModels(props: {
    models: IRunSetupModelOption[];
    referenceId: string;
    selected: string[];
    onToggle: (id: string) => void;
    transportOf: (id: string) => ProviderTransport | undefined;
    onTransport: (id: string, transport: ProviderTransport) => void;
    perCall: (id: string) => number | undefined;
    referencePerCall: number | undefined;
    pipelines: ISetupComparisonPipelineOption[];
    selectedPipelines: string[];
    onTogglePipeline: (id: string) => void;
    pipelineLabel: (pipeline: ISetupComparisonPipelineOption) => string;
}) {
    return (
        <>
            <p className="text-copy-14 text-muted-foreground">
                Cheaper models, and saved pipelines that split the job into
                steps, to compare with today&apos;s model. Each shows its
                estimated cost per call.
            </p>
            <ModelSearchList
                label="Models to try"
                models={props.models}
                selected={props.selected}
                onToggle={props.onToggle}
                transportOf={props.transportOf}
                onTransport={props.onTransport}
                perCall={props.perCall}
                referencePerCall={props.referencePerCall}
                exclude={props.referenceId}
                cheapestFirst
            />
            <PipelineList
                pipelines={props.pipelines}
                selected={props.selectedPipelines}
                onToggle={props.onTogglePipeline}
                label={props.pipelineLabel}
                perCall={props.perCall}
                referencePerCall={props.referencePerCall}
            />
        </>
    );
}

/**
 * Saved pipelines that read the chosen dataset. One without a final answer
 * (or otherwise not comparable) is listed but can't be chosen, with why.
 */
function PipelineList({
    pipelines,
    selected,
    onToggle,
    label,
    perCall,
    referencePerCall,
}: {
    pipelines: ISetupComparisonPipelineOption[];
    selected: string[];
    onToggle: (id: string) => void;
    label: (pipeline: ISetupComparisonPipelineOption) => string;
    perCall: (id: string) => number | undefined;
    referencePerCall: number | undefined;
}) {
    const headingId = useId();
    return (
        <div className="flex flex-col gap-2">
            <span id={headingId} className="text-label-14 text-on-surface">
                Pipelines to try
            </span>
            {pipelines.length === 0 ? (
                <p className="text-copy-14 text-muted-foreground">
                    No saved pipeline reads this dataset. Build one under
                    Pipelines and give it a final answer to compare it here.
                </p>
            ) : (
                <ul
                    aria-labelledby={headingId}
                    className="flex flex-col divide-y divide-border rounded-sm border border-border"
                >
                    {pipelines.map((pipeline) => {
                        const cost = perCall(pipelineLineId(pipeline.id));
                        const disabled = Boolean(pipeline.unavailableReason);
                        return (
                            <li key={pipeline.id} className="p-2">
                                <label
                                    className={cn(
                                        "flex min-w-0 items-start gap-2",
                                        disabled && "opacity-60",
                                    )}
                                >
                                    <Checkbox
                                        checked={
                                            !disabled &&
                                            selected.includes(pipeline.id)
                                        }
                                        disabled={disabled}
                                        onChange={() => onToggle(pipeline.id)}
                                    />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="text-copy-14 text-on-surface">
                                            {label(pipeline)}
                                        </span>
                                        <span className="text-label-12 text-muted-foreground">
                                            {pipeline.unavailableReason ??
                                                (cost !== undefined
                                                    ? `≈ ${fmtUsd(cost)} per item if every step runs${
                                                          referencePerCall
                                                              ? ` · ${Math.round((cost / referencePerCall) * 1000) / 10}% of today's model`
                                                              : ""
                                                      }`
                                                    : `${pipeline.steps.length} steps`)}
                                        </span>
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}

function StartButton({
    ready,
    pilot,
    items,
}: {
    ready: boolean;
    pilot: boolean;
    items: number;
}) {
    const { pending } = useFormStatus();
    return (
        <Button
            type="submit"
            className="self-start"
            disabled={!ready || items === 0}
            loading={pending}
            loadingText="Starting…"
        >
            {pilot
                ? `Start the pilot (${items} transcripts)`
                : `Start the run (${items} transcripts)`}
        </Button>
    );
}

export function StepStart({
    estimate,
    fullItems,
    fullTotal,
    pilot,
    onPilot,
    pilotSize,
    onPilotSize,
    maxTokens,
    onMaxTokens,
    ready,
    state,
    tasks = [],
    onItemFilter,
    itemFilterNote,
}: {
    estimate: ReturnType<typeof estimateComparison>;
    fullItems: number;
    fullTotal: number;
    pilot: boolean;
    onPilot: (value: boolean) => void;
    pilotSize: string;
    onPilotSize: (value: string) => void;
    maxTokens: string;
    onMaxTokens: (value: string) => void;
    ready: boolean;
    state: IActionState;
    /** The Task Map's tasks, for running on one label's items only. */
    tasks?: readonly IBenchmarkTask[];
    onItemFilter?: (choice: { taskKey: string; equals: string }) => void;
    /** How many items the label filter keeps, when one is set. */
    itemFilterNote?: string;
}) {
    const messages = [
        ...(state.formError ? [state.formError] : []),
        ...Object.values(state.fieldErrors ?? {}).flat(),
    ];
    return (
        <>
            <label className="flex items-center gap-2 text-copy-14">
                <Checkbox
                    checked={pilot}
                    onChange={(event) => onPilot(event.target.checked)}
                />
                Run a pilot first on the first
                <Input
                    aria-label="Pilot size"
                    type="number"
                    min="1"
                    className="h-8 w-20"
                    value={pilotSize}
                    onChange={(event) => onPilotSize(event.target.value)}
                    disabled={!pilot}
                />
                transcripts
            </label>
            <p className="text-label-12 text-muted-foreground">
                {!pilot
                    ? `All ${fullItems} transcripts, about ${fmtUsd(fullTotal)}.`
                    : estimate.items >= fullItems
                      ? `That's every transcript in the dataset: about ${fmtUsd(estimate.total)}.`
                      : `A pilot of ${estimate.items} costs about ${fmtUsd(estimate.total)}; all ${fullItems} about ${fmtUsd(fullTotal)}. Rerun on all transcripts once the pilot looks right.`}
            </p>
            <div className="flex flex-col gap-2 sm:max-w-xs">
                <Label htmlFor="compare-max-tokens">
                    Output limit (tokens)
                </Label>
                <Input
                    id="compare-max-tokens"
                    type="number"
                    min="1"
                    value={maxTokens}
                    onChange={(event) => onMaxTokens(event.target.value)}
                />
                <p className="text-label-12 text-muted-foreground">
                    Answers longer than this fail. Long structured outputs need
                    room; 8,000 is a safe start.
                </p>
            </div>
            <SpendLimitField
                id="compare-max-cost"
                estimateUsd={estimate.total}
            />
            <ItemFilterFields tasks={tasks} onChange={onItemFilter} />
            {itemFilterNote && (
                <p className="text-label-12 text-muted-foreground">
                    {itemFilterNote}
                </p>
            )}
            <DataRules />
            {messages.length > 0 && (
                <ul
                    role="alert"
                    className="flex list-disc flex-col gap-1 pl-4 text-copy-14 text-error"
                >
                    {messages.map((message) => (
                        <li key={message}>{message}</li>
                    ))}
                </ul>
            )}
            {!ready && (
                <p className="text-copy-14 text-muted-foreground">
                    Finish steps 1 to 3 to start.
                </p>
            )}
            <StartButton ready={ready} pilot={pilot} items={estimate.items} />
        </>
    );
}

export function CostPanel({
    estimate,
    pilot,
    fullItems,
    fullTotal,
    itemFilterNote,
}: {
    estimate: ReturnType<typeof estimateComparison>;
    pilot: boolean;
    fullItems: number;
    fullTotal: number;
    /** How many items the label filter keeps, when one is set. */
    itemFilterNote?: string;
}) {
    return (
        <aside
            aria-label="Estimated cost"
            className="lg:sticky lg:top-20 lg:self-start"
        >
            <Card>
                <CardContent className="flex flex-col gap-3 p-4">
                    <span className="text-label-12 text-muted-foreground">
                        Estimated cost
                    </span>
                    <span className="text-heading-24 text-on-surface">
                        <Num>{`≈ ${fmtUsd(estimate.total)}`}</Num>
                        {estimate.incomplete && (
                            <Badge
                                variant="warning"
                                className="ml-2 align-middle"
                            >
                                some prices missing
                            </Badge>
                        )}
                    </span>
                    <span className="text-copy-14 text-muted-foreground">
                        {pilot && estimate.items < fullItems
                            ? `Pilot: ${estimate.items} transcripts. All ${fullItems}: ≈ ${fmtUsd(fullTotal)}.`
                            : `${estimate.items} transcripts.`}
                    </span>
                    {itemFilterNote && (
                        <span className="text-copy-14 text-muted-foreground">
                            {itemFilterNote}
                        </span>
                    )}
                    <ul className="flex flex-col gap-1 text-copy-14">
                        {estimate.lines.map((line) => (
                            <li
                                key={line.modelId}
                                className="flex justify-between gap-2"
                            >
                                <span className="truncate">{line.label}</span>
                                <Num>
                                    {line.total !== undefined
                                        ? fmtUsd(line.total)
                                        : "no price"}
                                </Num>
                            </li>
                        ))}
                        {estimate.pipelineLines.map((line) => (
                            <li
                                key={line.modelId}
                                className="flex justify-between gap-2"
                            >
                                <span className="min-w-0 truncate">
                                    {line.label}
                                </span>
                                <Num className="shrink-0">
                                    {line.total !== undefined
                                        ? fmtUsd(line.total)
                                        : "no price"}
                                </Num>
                            </li>
                        ))}
                        {estimate.judge && (
                            <li className="flex justify-between gap-2">
                                <span className="truncate">
                                    {`Judging (${estimate.judge.calls} calls)`}
                                </span>
                                <Num>
                                    {estimate.judge.total !== undefined
                                        ? fmtUsd(estimate.judge.total)
                                        : "no price"}
                                </Num>
                            </li>
                        )}
                    </ul>
                    <p className="text-label-12 text-muted-foreground">
                        {`From list prices: about ${estimate.inputTokens.toLocaleString("en-US")} tokens in and ${estimate.outputTokens.toLocaleString("en-US")} out per call. An estimate, not a quote.`}
                        {estimate.pipelineLines.length > 0 &&
                            " Pipelines are priced as if every step ran on every item, so steps that end the chain early make them cheaper."}
                    </p>
                    {estimate.items > 0 && (
                        <p className="text-copy-14 text-muted-foreground">
                            {`Time: ${fmtMinutes(estimate.minutes)}, roughly.`}
                        </p>
                    )}
                    {estimate.items > 0 && (
                        <p className="text-label-12 text-muted-foreground">
                            {`A rough guess: about ${ASSUMED_SECONDS_PER_CALL} seconds per call and the worker's default number of calls at once. Provider limits and long answers make it longer.`}
                        </p>
                    )}
                </CardContent>
            </Card>
        </aside>
    );
}
