"use client";

import { useState, useTransition } from "react";
import { Sparkles } from "lucide-react";
import type { IBenchmarkTask, ITaskMap } from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
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
    aliasesFromText,
    aliasesToText,
    withTaskSource,
    withTextMatching,
    type IBenchmarkFormState,
} from "./benchmark-settings";

export type ProposeTaskMapAction = (promptVersionId: string) => Promise<
    | {
          ok: true;
          taskMap: ITaskMap;
          source: "model" | "schema";
          notes: string[];
          rejected: string[];
      }
    | { ok: false; error: string }
>;

const SOURCE_LABELS: Record<IBenchmarkFormState["source"], string> = {
    model: "The benchmark model's answers",
    labels: "The dataset's stored answers",
};

/** Where the benchmark answers come from, when the dataset has answers. */
export function BenchmarkSourcePicker({
    source,
    onChange,
}: {
    source: IBenchmarkFormState["source"];
    onChange: (source: IBenchmarkFormState["source"]) => void;
}) {
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor="benchmarkSource">Compare against</Label>
            <Select
                value={source}
                onValueChange={(value) => {
                    if (value === "model" || value === "labels")
                        onChange(value);
                }}
            >
                <SelectTrigger id="benchmarkSource">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {Object.entries(SOURCE_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                            {label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            <p className="text-label-12 text-muted-foreground">
                {source === "labels"
                    ? "Every selected model is compared with the answers already in the dataset, such as production outputs."
                    : "The benchmark model runs on every item and its answers are the yardstick."}{" "}
                Each task can choose its own below.
            </p>
        </div>
    );
}

const TASK_SOURCE_LABELS = {
    default: "Run default",
    model: "Benchmark model's answers",
    labels: "Stored answers",
} as const;

/**
 * A task's own yardstick, e.g. a hand-checked field against the stored
 * answers while the other tasks use the benchmark model. "Run default"
 * leaves the task's source unset.
 */
export function TaskSourcePicker({
    task,
    id,
    onChange,
}: {
    task: IBenchmarkTask;
    id: string;
    onChange: (task: IBenchmarkTask) => void;
}) {
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-source`}>Compare against</Label>
            <Select
                value={task.source ?? "default"}
                onValueChange={(value) => {
                    if (value === "default")
                        onChange(withTaskSource(task, undefined));
                    else if (value === "model" || value === "labels")
                        onChange(withTaskSource(task, value));
                }}
            >
                <SelectTrigger id={`${id}-source`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {Object.entries(TASK_SOURCE_LABELS).map(
                        ([value, label]) => (
                            <SelectItem key={value} value={value}>
                                {label}
                            </SelectItem>
                        ),
                    )}
                </SelectContent>
            </Select>
        </div>
    );
}

/** Ask a model to read the prompt and draft the tasks. */
export function DraftTasksButton({
    promptVersionId,
    action,
    onDraft,
    children,
}: {
    promptVersionId: string;
    action: ProposeTaskMapAction;
    onDraft: (taskMap: ITaskMap) => void;
    /** Other proposal buttons shown in the same row. */
    children?: React.ReactNode;
}) {
    const [pending, startTransition] = useTransition();
    const [message, setMessage] = useState<
        { kind: "notes" | "error"; lines: string[] } | undefined
    >();
    const draft = () =>
        startTransition(async () => {
            setMessage(undefined);
            const result = await action(promptVersionId);
            if (!result.ok) {
                setMessage({ kind: "error", lines: [result.error] });
                return;
            }
            onDraft(result.taskMap);
            setMessage(
                result.source === "model"
                    ? { kind: "notes", lines: result.notes }
                    : {
                          kind: "error",
                          lines: [
                              "The model's draft had problems, so these tasks come from the output schema instead:",
                              ...result.rejected,
                          ],
                      },
            );
        });
    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap gap-2">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={draft}
                    disabled={!promptVersionId || pending}
                >
                    <Sparkles className="size-4" aria-hidden="true" />
                    {pending ? "Drafting…" : "Draft with a model"}
                </Button>
                {children}
            </div>
            {message && (
                <ul
                    aria-live="polite"
                    className={
                        message.kind === "error"
                            ? "flex list-disc flex-col gap-1 pl-4 text-copy-14 text-error"
                            : "flex list-disc flex-col gap-1 pl-4 text-copy-14 text-muted-foreground"
                    }
                >
                    {message.lines.map((line) => (
                        <li key={line}>{line}</li>
                    ))}
                </ul>
            )}
        </div>
    );
}

/** Other spellings and fuzzy matching for an agreement task's text. */
export function TextMatchingEditor({
    task,
    id,
    onChange,
}: {
    task: IBenchmarkTask;
    id: string;
    onChange: (task: IBenchmarkTask) => void;
}) {
    if (task.method !== "agreement") return undefined;
    const fuzzy = task.textMatching?.fuzzy;
    return (
        <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-aliases`}>Other spellings</Label>
                <Textarea
                    // Parsed on blur so typing a trailing comma is not undone.
                    key={aliasesToText(task.textMatching)}
                    id={`${id}-aliases`}
                    rows={2}
                    className="text-mono-13"
                    placeholder="Parle-G: parleji, parle glucose"
                    defaultValue={aliasesToText(task.textMatching)}
                    onBlur={(event) =>
                        onChange(
                            withTextMatching(task, {
                                aliases: aliasesFromText(event.target.value),
                            }),
                        )
                    }
                />
                <p className="text-label-12 text-muted-foreground">
                    One name per line, then its other spellings. Case, spaces
                    and punctuation are already ignored.
                </p>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-fuzzy`}>Fuzzy match (%)</Label>
                <Input
                    id={`${id}-fuzzy`}
                    type="number"
                    inputMode="decimal"
                    min="1"
                    max="100"
                    placeholder="Off"
                    value={fuzzy === undefined ? "" : Math.round(fuzzy * 100)}
                    onChange={(event) => {
                        const value = event.target.value.trim();
                        onChange(
                            withTextMatching(task, {
                                fuzzy:
                                    value === "" ? null : Number(value) / 100,
                            }),
                        );
                    }}
                />
                <p className="text-label-12 text-muted-foreground">
                    Also match close spellings, e.g. 85. Check results: close
                    names can be different brands.
                </p>
            </div>
        </div>
    );
}
