"use client";

import { useState } from "react";
import type { IBenchmarkTask, IRunItemFilter } from "@flash-evals/api-contract";
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

export const NO_FILTER = "__all__";

/** Benchmark tasks a run can be filtered on: those comparing one field. */
export function filterableTasks(
    tasks: readonly IBenchmarkTask[],
): Array<{ key: string; name: string; path: string }> {
    return tasks.flatMap((task) =>
        task.method === "agreement" && task.fields.length === 1
            ? [{ key: task.key, name: task.name, path: task.fields[0]!.path }]
            : [],
    );
}

/**
 * "Only items labelled …": runs every model on the items whose stored answer
 * has one value for a task's field, e.g. only the calls labelled sales.
 * Sends `itemFilterTaskKey` and `itemFilterEquals` with the form. A filter
 * given as a field path (over the API or MCP, or on a speech-to-text run)
 * can't be picked here: on "Run again" it is shown and kept as it was.
 */
export function ItemFilterFields({
    tasks,
    initial,
    onChange,
}: {
    tasks: readonly IBenchmarkTask[];
    initial?: IRunItemFilter;
    /** The chosen task and label as they're edited; NO_FILTER for none. */
    onChange?: (choice: { taskKey: string; equals: string }) => void;
}) {
    const options = filterableTasks(tasks);
    const [kept, setKept] = useState(
        initial?.path && !initial.taskKey ? initial : undefined,
    );
    const [taskKey, setTaskKeyState] = useState(initial?.taskKey ?? NO_FILTER);
    const [equals, setEqualsState] = useState(
        initial?.taskKey ? String(initial.equals) : "",
    );
    const setTaskKey = (value: string) => {
        setTaskKeyState(value);
        onChange?.({ taskKey: value, equals });
    };
    const setEquals = (value: string) => {
        setEqualsState(value);
        onChange?.({ taskKey, equals: value });
    };
    if (kept?.path)
        return (
            <KeptPathFilter
                path={kept.path}
                equals={String(kept.equals)}
                onRemove={() => setKept(undefined)}
            />
        );
    if (options.length === 0) return null;
    const chosen = options.some((option) => option.key === taskKey)
        ? taskKey
        : NO_FILTER;
    return (
        <fieldset className="flex flex-col gap-3">
            <legend className="text-label-14 text-foreground">
                Labelled items only (optional)
            </legend>
            <p className="text-copy-14 text-muted-foreground">
                Run every model on only the items whose stored answer has one
                label for a task, such as only the items labelled
                &quot;sales&quot;. Compared as text, ignoring case; applied
                before a pilot&apos;s item count.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                <div className="flex flex-col gap-2">
                    <Label htmlFor="itemFilterTask">Task</Label>
                    <Select
                        value={chosen}
                        onValueChange={(value) =>
                            setTaskKey(value || NO_FILTER)
                        }
                    >
                        <SelectTrigger id="itemFilterTask" className="min-w-48">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value={NO_FILTER}>All items</SelectItem>
                            {options.map((option) => (
                                <SelectItem key={option.key} value={option.key}>
                                    {option.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="itemFilterEquals">Label equals</Label>
                    <Input
                        id="itemFilterEquals"
                        value={equals}
                        disabled={chosen === NO_FILTER}
                        onChange={(event) => setEquals(event.target.value)}
                        placeholder="e.g. sales"
                        className="max-w-[240px]"
                    />
                </div>
            </div>
            {chosen !== NO_FILTER && equals.trim() !== "" && (
                <>
                    <input
                        type="hidden"
                        name="itemFilterTaskKey"
                        value={chosen}
                    />
                    <input
                        type="hidden"
                        name="itemFilterEquals"
                        value={equals.trim()}
                    />
                </>
            )}
        </fieldset>
    );
}

/** A path filter from the run being repeated, sent unchanged. */
function KeptPathFilter({
    path,
    equals,
    onRemove,
}: {
    path: string;
    equals: string;
    onRemove: () => void;
}) {
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="text-label-14 text-foreground">
                Labelled items only
            </legend>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-copy-14 text-muted-foreground">
                    {`Only items whose stored answer has ${path} equal to "${equals}", as in the run this repeats.`}
                </p>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={onRemove}
                >
                    Run on all items
                </Button>
            </div>
            <input type="hidden" name="itemFilterPath" value={path} />
            <input type="hidden" name="itemFilterEquals" value={equals} />
        </fieldset>
    );
}
