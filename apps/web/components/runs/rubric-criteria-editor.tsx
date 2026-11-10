"use client";

import { Plus } from "lucide-react";
import {
    RUBRIC_MAX_SCORE,
    RUBRIC_MIN_SCORE,
    type IBenchmarkCriterion,
    type IBenchmarkRubricTask,
} from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { addCriterion } from "./rubric-criteria";

/** The criteria a rubric task's judge scores, and notes it reads first. */
export function RubricCriteriaEditor({
    task,
    id,
    onChange,
}: {
    task: IBenchmarkRubricTask;
    id: string;
    onChange: (task: IBenchmarkRubricTask) => void;
}) {
    const setCriterion = (index: number, criterion: IBenchmarkCriterion) =>
        onChange({
            ...task,
            criteria: task.criteria.map((current, i) =>
                i === index ? criterion : current,
            ),
        });
    return (
        <div className="flex flex-col gap-3">
            <p className="text-copy-14 text-muted-foreground">
                The judge scores every model&apos;s answer {RUBRIC_MIN_SCORE} to{" "}
                {RUBRIC_MAX_SCORE} on each criterion, today&apos;s model&apos;s
                included, without seeing the other answers.
            </p>
            {task.criteria.map((criterion, index) => (
                <div
                    key={index}
                    role="group"
                    aria-label={`Criterion: ${criterion.name || criterion.key}`}
                    className="flex flex-col gap-3 rounded-sm border border-border p-3"
                >
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`${id}-criterion-${index}-name`}>
                            Criterion
                        </Label>
                        <Input
                            id={`${id}-criterion-${index}-name`}
                            value={criterion.name}
                            onChange={(event) =>
                                setCriterion(index, {
                                    ...criterion,
                                    name: event.target.value,
                                })
                            }
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`${id}-criterion-${index}-description`}>
                            What a {RUBRIC_MAX_SCORE} looks like
                        </Label>
                        <Textarea
                            id={`${id}-criterion-${index}-description`}
                            rows={2}
                            value={criterion.description ?? ""}
                            onChange={(event) =>
                                setCriterion(index, {
                                    ...criterion,
                                    description: event.target.value,
                                })
                            }
                        />
                    </div>
                    <div>
                        <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            aria-label={`Remove criterion ${criterion.name || criterion.key}`}
                            onClick={() =>
                                onChange({
                                    ...task,
                                    criteria: task.criteria.filter(
                                        (_, i) => i !== index,
                                    ),
                                })
                            }
                        >
                            Remove criterion
                        </Button>
                    </div>
                </div>
            ))}
            <div>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onChange(addCriterion(task))}
                >
                    <Plus className="size-4" aria-hidden="true" />
                    Add criterion
                </Button>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-instructions`}>
                    Notes for the judge
                </Label>
                <Textarea
                    id={`${id}-instructions`}
                    rows={3}
                    placeholder="Optional. Context the judge needs, such as official product names."
                    value={task.instructions ?? ""}
                    onChange={(event) =>
                        onChange({ ...task, instructions: event.target.value })
                    }
                />
            </div>
        </div>
    );
}
