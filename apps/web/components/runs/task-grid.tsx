"use client";

import { useState } from "react";
import { Check, CircleHelp, Minus, X } from "lucide-react";
import {
    benchmarkTaskSource,
    isSelfScoredTask,
    type BenchmarkSource,
    type BenchmarkTaskVerdict,
    type IBenchmarkPolicy,
    type IBenchmarkTask,
    type IBenchmarkTaskSummary,
    type IRunBenchmarkConfig,
} from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Num } from "@/components/ui/num";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MISSING_VALUE, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/cn";
import { taskSourceLabel } from "./benchmark-details";
import { taskTargetFromPolicy } from "./task-target";
import type { IModelResult } from "./run-results";

type GridMode = "score" | "against";

const STATUS: Record<
    BenchmarkTaskVerdict,
    {
        label: string;
        icon: typeof Check | undefined;
        text: string;
        surface: string;
    }
> = {
    pass: {
        label: "Pass",
        icon: Check,
        text: "text-eval-success",
        surface: "bg-eval-success-muted",
    },
    uncertain: {
        label: "Unsure",
        icon: CircleHelp,
        text: "text-eval-warning",
        surface: "bg-eval-warning-muted",
    },
    fail: {
        label: "Fail",
        icon: X,
        text: "text-eval-danger",
        surface: "bg-eval-danger-muted",
    },
    insufficient: {
        label: "Too few",
        icon: Minus,
        text: "text-muted-foreground",
        surface: "bg-surface",
    },
    // Today's model is the yardstick: its value is shown, never judged.
    reference: {
        label: "Reference",
        icon: undefined,
        text: "text-eval-ref",
        surface: "bg-surface",
    },
};

const RANGE_FILL: Record<BenchmarkTaskVerdict, string> = {
    pass: "bg-eval-success",
    uncertain: "bg-eval-warning",
    fail: "bg-eval-danger",
    insufficient: "bg-muted-foreground",
    reference: "bg-muted-foreground",
};

/** How a task is compared, in plain words. */
export function taskMethodLabel(task: IBenchmarkTask): string {
    if (task.method === "head_to_head") return "judge: won or tied";
    if (task.method === "rules")
        return `${task.rules.length} rule check${task.rules.length === 1 ? "" : "s"}, all must pass`;
    if (task.method === "rubric")
        return `judge scores ${task.criteria.length} criteri${task.criteria.length === 1 ? "on" : "a"}, 1–5`;
    const matchers = [...new Set(task.fields.map((field) => field.matcher))];
    const words = matchers.map((matcher) =>
        matcher === "set_overlap"
            ? "list overlap"
            : matcher === "numeric_tolerance"
              ? "within tolerance"
              : "exact",
    );
    const how = words.join(", ");
    return task.judgeDisagreements ? `${how}, judge settles differences` : how;
}

function taskOf(
    result: IModelResult,
    key: string,
): IBenchmarkTaskSummary | undefined {
    return result.comparison?.tasks.find((task) => task.key === key);
}

/** Points between a model's value and today's model's own value on a task. */
export function pointsAgainst(
    value: number | undefined,
    referenceValue: number | undefined,
): number | undefined {
    if (value === undefined || referenceValue === undefined) return undefined;
    return Math.round((value - referenceValue) * 1000) / 10;
}

function fmtPoints(points: number | undefined): string {
    if (points === undefined) return MISSING_VALUE;
    return `${points > 0 ? "+" : ""}${points} pts`;
}

function StatusLabel({ verdict }: { verdict: BenchmarkTaskVerdict }) {
    const { label, icon: Icon, text } = STATUS[verdict];
    return (
        <span
            className={cn("inline-flex items-center gap-1 text-label-12", text)}
        >
            {Icon && <Icon className="size-3" aria-hidden="true" />}
            {label}
        </span>
    );
}

/** The 95% range as a thin bar on a 0 to 100% track, with a tick at the target. */
function RangeBar({ task }: { task: IBenchmarkTaskSummary }) {
    const { interval, threshold, verdict } = task.assessment;
    return (
        <span
            aria-hidden="true"
            className="relative block h-1.5 w-full rounded-sm bg-muted"
        >
            {interval && (
                <span
                    className={cn(
                        "absolute inset-y-0 rounded-sm",
                        RANGE_FILL[verdict],
                    )}
                    style={{
                        left: `${interval.low * 100}%`,
                        width: `${Math.max(1, (interval.high - interval.low) * 100)}%`,
                    }}
                />
            )}
            {verdict !== "reference" && (
                <span
                    className="absolute -top-1 h-3.5 w-0.5 bg-foreground"
                    style={{ left: `calc(${threshold * 100}% - 1px)` }}
                />
            )}
        </span>
    );
}

function cellLabel(
    task: IBenchmarkTaskSummary,
    taskName: string,
    modelName: string,
    referenceName: string | undefined,
): string {
    const { value, interval, threshold, verdict, reference } = task.assessment;
    const range = interval
        ? ` 95% range ${fmtPercent(interval.low)} to ${fmtPercent(interval.high)}.`
        : "";
    const target =
        verdict === "reference"
            ? "Shown for comparison, not judged."
            : reference
              ? `Target ${fmtPercent(threshold)}: no more than ${Math.round(reference.maxDrop * 1000) / 10} pts below ${referenceName ?? "today's model"}'s own ${fmtPercent(reference.value)}.`
              : `Target ${fmtPercent(threshold)}.`;
    return `${taskName}, ${modelName}: ${fmtPercent(value)}, ${STATUS[verdict].label}.${range} ${target}`;
}

function GridCell({
    task,
    taskName,
    model,
    mode,
    referenceTask,
    referenceName,
    onOpen,
}: {
    task: IBenchmarkTaskSummary | undefined;
    taskName: string;
    model: IModelResult;
    mode: GridMode;
    referenceTask: IBenchmarkTaskSummary | undefined;
    referenceName: string | undefined;
    /** Opens the transcripts behind this cell. */
    onOpen?: () => void;
}) {
    if (!task)
        return (
            <span className="block p-2">
                <Num>{MISSING_VALUE}</Num>
            </span>
        );
    const { verdict, value } = task.assessment;
    const against = mode === "against" && !model.isReference;
    const label = cellLabel(task, taskName, model.name, referenceName);
    const body = (
        <span
            className={cn(
                "flex min-w-28 flex-col gap-1 rounded-sm p-2 text-left",
                STATUS[verdict].surface,
            )}
        >
            <span className="text-label-14 tabular-nums text-on-surface">
                {against
                    ? fmtPoints(
                          pointsAgainst(value, referenceTask?.assessment.value),
                      )
                    : fmtPercent(value)}
            </span>
            <StatusLabel verdict={verdict} />
            {!against && <RangeBar task={task} />}
        </span>
    );
    if (!onOpen)
        return (
            <span role="img" aria-label={label} className="block">
                {body}
            </span>
        );
    return (
        <button
            type="button"
            aria-label={`${label} Show the transcripts.`}
            onClick={onOpen}
            className="block w-full rounded-sm hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring"
        >
            {body}
        </button>
    );
}

/** "3.8" for a 1–5 mean; a dash when there is none. */
export function fmtRubricScore(score: number | undefined): string {
    return score === undefined ? MISSING_VALUE : score.toFixed(1);
}

function fmtScoreDifference(difference: number | undefined): string {
    if (difference === undefined) return MISSING_VALUE;
    const rounded = Math.round(difference * 10) / 10;
    return `${rounded > 0 ? "+" : rounded < 0 ? "−" : "±"}${Math.abs(rounded).toFixed(1)}`;
}

/** One rubric criterion's mean score, or its gap to today's model. */
function CriterionCell({
    summary,
    criterionKey,
    against,
}: {
    summary: IBenchmarkTaskSummary | undefined;
    criterionKey: string;
    against: boolean;
}) {
    const criterion = summary?.criteria?.find((c) => c.key === criterionKey);
    const text = against
        ? fmtScoreDifference(criterion?.difference)
        : fmtRubricScore(criterion?.mean);
    return (
        <span className="block px-2 py-1">
            <Num>{text}</Num>
            {!against && criterion?.referenceMean !== undefined && (
                <span className="text-label-12 tabular-nums text-muted-foreground">
                    {" "}
                    vs {fmtRubricScore(criterion.referenceMean)}
                </span>
            )}
        </span>
    );
}

function TaskHeader({
    task,
    source,
    referenceName,
    policy,
}: {
    task: IBenchmarkTask;
    source: BenchmarkSource | undefined;
    referenceName: string | undefined;
    policy: IBenchmarkPolicy | undefined;
}) {
    return (
        <span className="flex min-w-48 flex-col gap-1 whitespace-normal">
            <span className="text-label-14 text-on-surface">{task.name}</span>
            <span className="text-label-12 text-muted-foreground">
                {[
                    taskSourceLabel(
                        source === "labels" ? "labels" : "model",
                        referenceName,
                    ),
                    taskMethodLabel(task),
                ].join(" · ")}
            </span>
            <span className="text-label-12 text-muted-foreground">
                {`Target: ${taskTargetFromPolicy({ task, source, policy, referenceName })}`}
            </span>
        </span>
    );
}

/**
 * Tasks down, models across (cheapest first, today's model last): each cell
 * shows the model's result on the task, its pass / unsure / fail status and
 * the 95% range against the task's target. The statistics come from the
 * comparison; nothing is recomputed here.
 */
export function TaskGrid({
    results,
    benchmark,
    onOpenCell,
}: {
    results: IModelResult[];
    benchmark: IRunBenchmarkConfig;
    /** Opens the transcripts behind a model's result on a task. */
    onOpenCell?: (model: IModelResult, task: IBenchmarkTask) => void;
}) {
    const [mode, setMode] = useState<GridMode>("score");
    const reference = results.find((result) => result.isReference);
    const columns = [
        ...results.filter((result) => !result.isReference),
        ...(reference ? [reference] : []),
    ];
    const tasks = benchmark.taskMap.tasks;
    const referenceName = reference?.name;
    const comparedWithReference = results.some((result) =>
        result.comparison?.tasks.some((task) => task.assessment.reference),
    );
    return (
        <div
            role="region"
            aria-label="Task by task"
            className="flex flex-col gap-3"
        >
            {reference && (
                <div
                    role="group"
                    aria-label="Grid values"
                    className="flex gap-1 self-start rounded-sm bg-muted p-1"
                >
                    {(
                        [
                            ["score", "Score"],
                            ["against", `Against ${reference.name}`],
                        ] as const
                    ).map(([value, label]) => (
                        <Button
                            key={value}
                            type="button"
                            size="sm"
                            variant={mode === value ? "secondary" : "ghost"}
                            aria-pressed={mode === value}
                            onClick={() => setMode(value)}
                        >
                            {label}
                        </Button>
                    ))}
                </div>
            )}
            <Table containerClassName="hidden md:block" className="min-w-max">
                <TableHeader>
                    <TableRow className="bg-muted hover:bg-muted">
                        <TableHead>Task</TableHead>
                        {columns.map((model) => (
                            <TableHead
                                key={model.runModelId}
                                className={cn(
                                    model.isReference &&
                                        "border-l border-border-strong",
                                )}
                            >
                                <span className="flex flex-col">
                                    <span className="text-on-surface">
                                        {model.name}
                                    </span>
                                    <span className="tabular-nums">
                                        {model.isReference
                                            ? "today's model"
                                            : model.relativeCost !== undefined
                                              ? `${fmtPercent(model.relativeCost)} of the cost`
                                              : MISSING_VALUE}
                                    </span>
                                </span>
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {tasks.flatMap((task) => [
                        <TableRow
                            key={task.key}
                            className="hover:bg-transparent"
                        >
                            <TableCell>
                                <TaskHeader
                                    task={task}
                                    source={
                                        isSelfScoredTask(task)
                                            ? undefined
                                            : benchmarkTaskSource(
                                                  task,
                                                  benchmark,
                                              )
                                    }
                                    referenceName={referenceName}
                                    policy={benchmark.policy}
                                />
                            </TableCell>
                            {columns.map((model) => (
                                <TableCell
                                    key={model.runModelId}
                                    className={cn(
                                        "p-1",
                                        model.isReference &&
                                            "border-l border-border-strong",
                                    )}
                                >
                                    <GridCell
                                        task={taskOf(model, task.key)}
                                        taskName={task.name}
                                        model={model}
                                        mode={mode}
                                        referenceTask={
                                            reference
                                                ? taskOf(reference, task.key)
                                                : undefined
                                        }
                                        referenceName={referenceName}
                                        {...(onOpenCell
                                            ? {
                                                  onOpen: () =>
                                                      onOpenCell(model, task),
                                              }
                                            : {})}
                                    />
                                </TableCell>
                            ))}
                        </TableRow>,
                        ...(task.method === "rubric"
                            ? task.criteria.map((criterion) => (
                                  <TableRow
                                      key={`${task.key}:${criterion.key}`}
                                      className="hover:bg-transparent"
                                  >
                                      <TableCell className="py-1 pl-6">
                                          <span className="text-label-12 text-muted-foreground">
                                              {criterion.name} (1–5)
                                          </span>
                                      </TableCell>
                                      {columns.map((model) => (
                                          <TableCell
                                              key={model.runModelId}
                                              className={cn(
                                                  "p-1",
                                                  model.isReference &&
                                                      "border-l border-border-strong",
                                              )}
                                          >
                                              <CriterionCell
                                                  summary={taskOf(
                                                      model,
                                                      task.key,
                                                  )}
                                                  criterionKey={criterion.key}
                                                  against={
                                                      mode === "against" &&
                                                      !model.isReference
                                                  }
                                              />
                                          </TableCell>
                                      ))}
                                  </TableRow>
                              ))
                            : []),
                    ])}
                </TableBody>
            </Table>
            <ul className="flex flex-col gap-3 md:hidden">
                {columns.map((model) => (
                    <li key={model.runModelId}>
                        <Card className="flex flex-col gap-2 p-4">
                            <span className="flex items-baseline justify-between gap-2">
                                <span className="text-label-14 text-on-surface">
                                    {model.name}
                                </span>
                                <span className="text-label-12 tabular-nums text-muted-foreground">
                                    {model.isReference
                                        ? "today's model"
                                        : model.relativeCost !== undefined
                                          ? `${fmtPercent(model.relativeCost)} of the cost`
                                          : ""}
                                </span>
                            </span>
                            <ul className="flex flex-col divide-y divide-border">
                                {tasks.flatMap((task) => {
                                    const summary = taskOf(model, task.key);
                                    return [
                                        <li
                                            key={task.key}
                                            className="flex items-center justify-between gap-3 py-1 text-copy-14"
                                        >
                                            {onOpenCell && summary ? (
                                                <button
                                                    type="button"
                                                    onClick={() =>
                                                        onOpenCell(model, task)
                                                    }
                                                    className="min-w-0 text-left underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                                                >
                                                    {task.name}
                                                </button>
                                            ) : (
                                                <span className="min-w-0">
                                                    {task.name}
                                                </span>
                                            )}
                                            <span className="flex shrink-0 items-center gap-2">
                                                <Num>
                                                    {fmtPercent(
                                                        summary?.assessment
                                                            .value,
                                                    )}
                                                </Num>
                                                {summary && (
                                                    <StatusLabel
                                                        verdict={
                                                            summary.assessment
                                                                .verdict
                                                        }
                                                    />
                                                )}
                                            </span>
                                        </li>,
                                        ...(summary?.criteria?.length
                                            ? [
                                                  <li
                                                      key={`${task.key}:criteria`}
                                                      className="py-1 text-label-12 tabular-nums text-muted-foreground"
                                                  >
                                                      {summary.criteria
                                                          .map(
                                                              (c) =>
                                                                  `${c.name} ${fmtRubricScore(c.mean)}${c.referenceMean !== undefined ? ` vs ${fmtRubricScore(c.referenceMean)}` : ""}`,
                                                          )
                                                          .join(" · ")}
                                                  </li>,
                                              ]
                                            : []),
                                    ];
                                })}
                            </ul>
                        </Card>
                    </li>
                ))}
            </ul>
            <p className="text-label-12 text-muted-foreground">
                The bar under each value is its 95% range and the tick marks the
                task&apos;s target. Pass: the whole range clears the target.
                Unsure: the range crosses it. Fail: the whole range is below it.
                Too few: not enough items to judge. Failed items count as
                misses. Under a rubric, each criterion shows the judge&apos;s
                mean score from 1 to 5, and today&apos;s model&apos;s mean on
                the same transcripts after &quot;vs&quot;.
                {comparedWithReference &&
                    ` Where ${referenceName ?? "today's model"} is scored too (tasks against the stored answers, and rule checks), the target is its own rate on the same transcripts minus the allowed drop, so matching it passes.`}
                {onOpenCell &&
                    " Click a result to see the transcripts behind it and record who was right."}
                {reference &&
                    ` ${reference.name} shows a value only for tasks compared with the stored answers. It is marked Reference: the others are measured against it, so it is not judged itself.`}
            </p>
        </div>
    );
}
