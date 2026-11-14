"use client";

import { useId } from "react";
import { Plus, X } from "lucide-react";
import {
    benchmarkUsesSource,
    isSelfScoredTask,
    proposeTaskMapFromSchema,
    type IBenchmarkAgreementTask,
    type IBenchmarkHeadToHeadTask,
    type IBenchmarkRubricTask,
    type IBenchmarkTask,
    type IJsonSchemaObject,
    type IRunSetupModelOption,
} from "@flash-evals/api-contract";
import { SectionTitle } from "@/components/layout/section-title";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
    MATCHER_LABELS,
    addPath,
    benchmarkJudgeTransport,
    isMatcherKind,
    newTask,
    pathsOf,
    removePathAt,
    schemaPaths,
    setFieldMatcherAt,
    setPathAt,
    withMethod,
    type IBenchmarkFormState,
} from "./benchmark-settings";
import {
    BenchmarkSourcePicker,
    DraftTasksButton,
    TaskSourcePicker,
    TextMatchingEditor,
    type ProposeTaskMapAction,
} from "./run-benchmark-controls";
import { ProviderSelect } from "./provider-select";
import { starterRulesTask } from "./rule-checks";
import { RuleChecksEditor } from "./rule-checks-editor";
import { starterRubricTask } from "./rubric-criteria";
import { RubricCriteriaEditor } from "./rubric-criteria-editor";

const METHOD_LABELS: Record<IBenchmarkTask["method"], string> = {
    agreement: "Agreement (compare fields)",
    head_to_head: "Head to head (judge picks the better answer)",
    rules: "Rule checks (no yardstick, no model call)",
    rubric: "Rubric (judge scores 1–5)",
};

function OutputField({
    task,
    index,
    taskIndex,
    pathListId,
    onChange,
}: {
    task: IBenchmarkTask;
    index: number;
    taskIndex: number;
    pathListId: string;
    onChange: (task: IBenchmarkTask) => void;
}) {
    const path = pathsOf(task)[index] ?? "";
    const field = task.method === "agreement" ? task.fields[index] : undefined;
    const id = `benchmark-task-${taskIndex}-field-${index}`;
    return (
        <div className="flex flex-wrap items-end gap-3">
            <div className="flex min-w-48 flex-1 flex-col gap-2">
                <Label htmlFor={`${id}-path`}>Output field</Label>
                <Input
                    id={`${id}-path`}
                    list={pathListId}
                    className="text-mono-13"
                    placeholder="$.field"
                    value={path}
                    onChange={(event) =>
                        onChange(setPathAt(task, index, event.target.value))
                    }
                />
            </div>
            {field && (
                <div className="flex w-48 flex-col gap-2">
                    <Label htmlFor={`${id}-matcher`}>Match by</Label>
                    <Select
                        value={field.matcher}
                        onValueChange={(value) => {
                            if (
                                typeof value === "string" &&
                                isMatcherKind(value)
                            )
                                onChange(
                                    setFieldMatcherAt(task, index, {
                                        matcher: value,
                                    }),
                                );
                        }}
                    >
                        <SelectTrigger id={`${id}-matcher`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(MATCHER_LABELS).map(
                                ([value, label]) => (
                                    <SelectItem key={value} value={value}>
                                        {label}
                                    </SelectItem>
                                ),
                            )}
                        </SelectContent>
                    </Select>
                </div>
            )}
            {field?.matcher === "numeric_tolerance" && (
                <div className="flex w-32 flex-col gap-2">
                    <Label htmlFor={`${id}-tolerance`}>Tolerance</Label>
                    <Input
                        id={`${id}-tolerance`}
                        type="number"
                        step="0.01"
                        min="0"
                        value={field.tolerance}
                        onChange={(event) =>
                            onChange(
                                setFieldMatcherAt(task, index, {
                                    tolerance: Number(event.target.value),
                                }),
                            )
                        }
                    />
                </div>
            )}
            {field?.matcher === "numeric_tolerance" && (
                <label className="flex h-10 items-center gap-2 text-copy-14">
                    <Checkbox
                        checked={field.relative === true}
                        onChange={(event) =>
                            onChange(
                                setFieldMatcherAt(task, index, {
                                    relative: event.target.checked,
                                }),
                            )
                        }
                    />
                    Relative (0.05 is 5%)
                </label>
            )}
            <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Remove output field ${path || index + 1} from ${task.name || "task"}`}
                onClick={() => onChange(removePathAt(task, index))}
            >
                <X className="size-4" aria-hidden="true" />
            </Button>
        </div>
    );
}

export function TaskEditor({
    task,
    index,
    pathListId,
    canUseStoredAnswers,
    onChange,
    onRemove,
}: {
    task: IBenchmarkTask;
    index: number;
    pathListId: string;
    canUseStoredAnswers: boolean;
    onChange: (task: IBenchmarkTask) => void;
    onRemove: () => void;
}) {
    const id = `benchmark-task-${index}`;
    const label = task.name || `task ${index + 1}`;
    // Also shown when a source is set, so it can be reset.
    const showSource = canUseStoredAnswers || task.source !== undefined;
    return (
        <Card
            variant="inset"
            role="group"
            aria-label={`Task: ${label}`}
            className="flex flex-col gap-4 p-4"
        >
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-name`}>Name</Label>
                    <Input
                        id={`${id}-name`}
                        value={task.name}
                        onChange={(event) =>
                            onChange({ ...task, name: event.target.value })
                        }
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-key`}>Key</Label>
                    <Input
                        id={`${id}-key`}
                        className="text-mono-13"
                        value={task.key}
                        onChange={(event) =>
                            onChange({ ...task, key: event.target.value })
                        }
                    />
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-description`}>What this task does</Label>
                <Textarea
                    id={`${id}-description`}
                    rows={2}
                    value={task.description ?? ""}
                    onChange={(event) =>
                        onChange({ ...task, description: event.target.value })
                    }
                />
            </div>
            <div
                className={
                    showSource ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"
                }
            >
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-method`}>Compare by</Label>
                    <Select
                        value={task.method}
                        onValueChange={(value) => {
                            if (
                                value === "agreement" ||
                                value === "head_to_head" ||
                                value === "rules" ||
                                value === "rubric"
                            )
                                onChange(withMethod(task, value));
                        }}
                    >
                        <SelectTrigger id={`${id}-method`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(METHOD_LABELS).map(
                                ([value, text]) => (
                                    <SelectItem key={value} value={value}>
                                        {text}
                                    </SelectItem>
                                ),
                            )}
                        </SelectContent>
                    </Select>
                </div>
                {showSource && !isSelfScoredTask(task) && (
                    <TaskSourcePicker task={task} id={id} onChange={onChange} />
                )}
            </div>
            {task.method === "rules" ? (
                <RuleChecksEditor
                    task={task}
                    id={id}
                    pathListId={pathListId}
                    onChange={onChange}
                />
            ) : (
                <TaskComparisonFields
                    task={task}
                    id={id}
                    index={index}
                    pathListId={pathListId}
                    onChange={onChange}
                />
            )}
            <div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove task ${label}`}
                    onClick={onRemove}
                >
                    Remove task
                </Button>
            </div>
        </Card>
    );
}

/** Output fields, and how answers are compared or scored on them. */
function TaskComparisonFields({
    task,
    id,
    index,
    pathListId,
    onChange,
}: {
    task:
        | IBenchmarkAgreementTask
        | IBenchmarkHeadToHeadTask
        | IBenchmarkRubricTask;
    id: string;
    index: number;
    pathListId: string;
    onChange: (task: IBenchmarkTask) => void;
}) {
    return (
        <>
            <div className="flex flex-col gap-3">
                {pathsOf(task).map((_, fieldIndex) => (
                    <OutputField
                        key={fieldIndex}
                        task={task}
                        index={fieldIndex}
                        taskIndex={index}
                        pathListId={pathListId}
                        onChange={onChange}
                    />
                ))}
                <div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onChange(addPath(task))}
                    >
                        <Plus className="size-4" aria-hidden="true" />
                        Add output field
                    </Button>
                </div>
            </div>
            {task.method === "agreement" ? (
                <label className="flex items-center gap-2 text-copy-14">
                    <Checkbox
                        checked={task.judgeDisagreements === true}
                        onChange={(event) =>
                            onChange({
                                ...task,
                                judgeDisagreements: event.target.checked,
                            })
                        }
                    />
                    Send disagreements to the judge to decide who is right
                </label>
            ) : null}
            <TextMatchingEditor task={task} id={id} onChange={onChange} />
            {task.method === "rubric" && (
                <RubricCriteriaEditor task={task} id={id} onChange={onChange} />
            )}
            {task.method === "head_to_head" && (
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-rubric`}>
                        What makes an answer better
                    </Label>
                    <Textarea
                        id={`${id}-rubric`}
                        rows={3}
                        placeholder="Optional. The task description is used when empty."
                        value={task.rubric ?? ""}
                        onChange={(event) =>
                            onChange({ ...task, rubric: event.target.value })
                        }
                    />
                </div>
            )}
        </>
    );
}

function PolicyInput({
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
                step="1"
                placeholder={placeholder}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    );
}

export function RunBenchmarkSection({
    state,
    onChange,
    selectedModels,
    benchmarkModel,
    onBenchmarkModelChange,
    availableModels,
    outputSchema,
    errors,
    serverError,
    promptVersionId,
    proposeTaskMapAction,
    canUseStoredAnswers,
}: {
    state: IBenchmarkFormState;
    onChange: (state: IBenchmarkFormState) => void;
    selectedModels: string[];
    benchmarkModel: string;
    onBenchmarkModelChange: (modelId: string) => void;
    availableModels: IRunSetupModelOption[];
    outputSchema: IJsonSchemaObject | undefined;
    errors: string[];
    serverError?: string;
    promptVersionId: string;
    proposeTaskMapAction?: ProposeTaskMapAction;
    canUseStoredAnswers: boolean;
}) {
    const pathListId = useId();
    const tasks = state.taskMap.tasks;
    const judgeModels = availableModels.filter(
        (model) =>
            model.available && model.judgeSuitable && model.structuredOutput,
    );
    const setTasks = (next: IBenchmarkTask[]) =>
        onChange({ ...state, taskMap: { tasks: next } });
    const propose = () => {
        if (outputSchema)
            onChange({
                ...state,
                taskMap: proposeTaskMapFromSchema(outputSchema),
            });
    };
    const toggle = (enabled: boolean) =>
        onChange({
            ...state,
            enabled,
            // Start from the schema the first time, so there is something to review.
            ...(enabled && tasks.length === 0 && outputSchema
                ? { taskMap: proposeTaskMapFromSchema(outputSchema) }
                : {}),
        });

    return (
        <Card>
            <CardHeader>
                <CardTitle as="h2">
                    <span className="text-muted-foreground">5.</span> Benchmark
                    comparison (optional)
                </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
                <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 text-label-14 text-on-surface">
                        <Checkbox
                            id="benchmarkEnabled"
                            checked={state.enabled}
                            onChange={(event) => toggle(event.target.checked)}
                        />
                        Compare with a benchmark model
                    </label>
                    <p className="text-copy-14 text-muted-foreground">
                        Score models task by task against a benchmark: the
                        answers of the model you use today, or answers already
                        stored in the dataset. Shows whether a cheaper model can
                        replace it.
                    </p>
                </div>
                {state.enabled && (
                    <>
                        <div className="grid gap-4 sm:grid-cols-2">
                            {(canUseStoredAnswers ||
                                state.source === "labels") && (
                                <BenchmarkSourcePicker
                                    source={state.source}
                                    onChange={(source) =>
                                        onChange({ ...state, source })
                                    }
                                />
                            )}
                            {benchmarkUsesSource(state, "model") && (
                                <div className="flex flex-col gap-2">
                                    <Label htmlFor="benchmarkModel">
                                        Benchmark model
                                    </Label>
                                    <Select
                                        value={benchmarkModel}
                                        onValueChange={(value) => {
                                            if (typeof value === "string")
                                                onBenchmarkModelChange(value);
                                        }}
                                    >
                                        <SelectTrigger id="benchmarkModel">
                                            <SelectValue placeholder="Choose a selected model" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            {selectedModels.map((modelId) => (
                                                <SelectItem
                                                    key={modelId}
                                                    value={modelId}
                                                >
                                                    {modelId}
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                    <p className="text-label-12 text-muted-foreground">
                                        Also the run&apos;s reference model.
                                    </p>
                                </div>
                            )}
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="benchmarkJudgeModel">
                                    Judge model
                                </Label>
                                <Select
                                    value={state.judgeModelId}
                                    onValueChange={(value) => {
                                        if (typeof value === "string")
                                            onChange({
                                                ...state,
                                                judgeModelId: value,
                                            });
                                    }}
                                >
                                    <SelectTrigger id="benchmarkJudgeModel">
                                        <SelectValue placeholder="Choose a judge model" />
                                    </SelectTrigger>
                                    <SelectContent>
                                        {judgeModels.map((model) => (
                                            <SelectItem
                                                key={model.id}
                                                value={model.id}
                                            >
                                                {model.label}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                                <p className="text-label-12 text-muted-foreground">
                                    Used only by head-to-head tasks and judged
                                    disagreements.
                                </p>
                            </div>
                            <div className="flex flex-col gap-2">
                                <Label htmlFor="benchmarkJudgeProvider">
                                    Judge provider (price in / out per 1M
                                    tokens)
                                </Label>
                                <ProviderSelect
                                    id="benchmarkJudgeProvider"
                                    model={availableModels.find(
                                        (model) =>
                                            model.id === state.judgeModelId,
                                    )}
                                    value={benchmarkJudgeTransport(
                                        availableModels,
                                        state,
                                    )}
                                    onChange={(transport) =>
                                        onChange({
                                            ...state,
                                            judgeTransport: transport,
                                        })
                                    }
                                />
                            </div>
                        </div>

                        <div className="flex flex-col gap-4">
                            <SectionTitle
                                as="h3"
                                description="Split the prompt's output into the jobs it does. Each task is compared on its own."
                            >
                                Tasks
                            </SectionTitle>
                            {proposeTaskMapAction ? (
                                <DraftTasksButton
                                    promptVersionId={promptVersionId}
                                    action={proposeTaskMapAction}
                                    onDraft={(taskMap) =>
                                        onChange({ ...state, taskMap })
                                    }
                                >
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={propose}
                                        disabled={!outputSchema}
                                    >
                                        Propose from output schema
                                    </Button>
                                </DraftTasksButton>
                            ) : (
                                <div>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        size="sm"
                                        onClick={propose}
                                        disabled={!outputSchema}
                                    >
                                        Propose from output schema
                                    </Button>
                                </div>
                            )}
                            {!outputSchema && (
                                <p className="text-copy-14 text-muted-foreground">
                                    The selected prompt has no output schema to
                                    propose tasks from. Add them by hand.
                                </p>
                            )}
                            {tasks.map((task, index) => (
                                <TaskEditor
                                    key={index}
                                    task={task}
                                    index={index}
                                    pathListId={pathListId}
                                    canUseStoredAnswers={canUseStoredAnswers}
                                    onChange={(next) =>
                                        setTasks(
                                            tasks.map((current, i) =>
                                                i === index ? next : current,
                                            ),
                                        )
                                    }
                                    onRemove={() =>
                                        setTasks(
                                            tasks.filter((_, i) => i !== index),
                                        )
                                    }
                                />
                            ))}
                            <div>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() =>
                                        setTasks([...tasks, newTask(tasks)])
                                    }
                                >
                                    <Plus
                                        className="size-4"
                                        aria-hidden="true"
                                    />
                                    Add task
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() =>
                                        setTasks([
                                            ...tasks,
                                            starterRulesTask(
                                                outputSchema,
                                                tasks,
                                            ),
                                        ])
                                    }
                                >
                                    <Plus
                                        className="size-4"
                                        aria-hidden="true"
                                    />
                                    Add rule checks
                                </Button>
                                <Button
                                    type="button"
                                    variant="secondary"
                                    onClick={() =>
                                        setTasks([
                                            ...tasks,
                                            starterRubricTask(
                                                outputSchema,
                                                tasks,
                                            ),
                                        ])
                                    }
                                >
                                    <Plus
                                        className="size-4"
                                        aria-hidden="true"
                                    />
                                    Add rubric
                                </Button>
                            </div>
                            <datalist id={pathListId}>
                                {schemaPaths(outputSchema).map((path) => (
                                    <option key={path} value={path} />
                                ))}
                            </datalist>
                        </div>

                        <div className="flex flex-col gap-4">
                            <SectionTitle
                                as="h3"
                                description="A model passes a task only when the whole 95% interval clears its target. On tasks checked against stored answers, the reference model is scored too, so the target is no more than the allowed drop below the reference's own rate on the same items: its agreement, or for judged tasks how often it won or tied. Matching or beating it passes. The minimums apply where the reference is the benchmark, or when no drop is set."
                            >
                                Targets
                            </SectionTitle>
                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                                <PolicyInput
                                    id="benchmarkMaxDrop"
                                    label="Allowed drop below the reference (points)"
                                    placeholder="Use the minimums"
                                    value={state.maxDropPts}
                                    onChange={(value) =>
                                        onChange({
                                            ...state,
                                            maxDropPts: value,
                                        })
                                    }
                                />
                                <PolicyInput
                                    id="benchmarkMinAgreement"
                                    label="Minimum agreement (%)"
                                    value={state.minAgreementPct}
                                    onChange={(value) =>
                                        onChange({
                                            ...state,
                                            minAgreementPct: value,
                                        })
                                    }
                                />
                                <PolicyInput
                                    id="benchmarkMinWinOrTie"
                                    label="Minimum won or tied (%)"
                                    value={state.minWinOrTiePct}
                                    onChange={(value) =>
                                        onChange({
                                            ...state,
                                            minWinOrTiePct: value,
                                        })
                                    }
                                />
                                <PolicyInput
                                    id="benchmarkMaxCost"
                                    label="Maximum cost (% of benchmark)"
                                    placeholder="No limit"
                                    value={state.maxCostPct}
                                    onChange={(value) =>
                                        onChange({
                                            ...state,
                                            maxCostPct: value,
                                        })
                                    }
                                />
                            </div>
                        </div>

                        {errors.length > 0 && (
                            <div
                                aria-live="polite"
                                className="flex flex-col gap-1"
                            >
                                <p className="text-label-14 text-error">
                                    Fix these before starting the run:
                                </p>
                                <ul className="flex list-disc flex-col gap-1 pl-4 text-copy-14 text-error">
                                    {errors.map((error) => (
                                        <li key={error}>{error}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </>
                )}
                {serverError && (
                    <p
                        id="benchmark"
                        tabIndex={-1}
                        role="alert"
                        className="text-copy-14 text-error"
                    >
                        {serverError}
                    </p>
                )}
            </CardContent>
        </Card>
    );
}
