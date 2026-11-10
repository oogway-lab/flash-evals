"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
    formatConditionValues,
    parseConditionValues,
    runConditionFrom,
    runConditionList,
    type IWorkflowStepCondition,
    type WorkflowRunCondition,
} from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

const ALWAYS = "always";

type EarlierStep = { nodeKey: string; label: string };

/**
 * "Run this step": always, or only when fields of earlier steps' answers
 * match. With several conditions, all must hold. When they do not, this step
 * and the steps after it are skipped for that item.
 */
export function StepConditionFields({
    nodeKey,
    condition,
    earlierSteps,
    onChange,
}: {
    nodeKey: string;
    condition: WorkflowRunCondition | undefined;
    /** Steps that run before this one, in canvas order. */
    earlierSteps: EarlierStep[];
    onChange: (condition: WorkflowRunCondition | undefined) => void;
}) {
    const conditions = runConditionList(condition);
    // Typed text is kept as typed, one entry per condition; the parsed
    // values are saved.
    const [valuesTexts, setValuesTexts] = useState(() =>
        conditions.map((part) => formatConditionValues(part.values)),
    );
    const id = `step-condition-${nodeKey}`;
    if (earlierSteps.length === 0) return null;
    const save = (next: IWorkflowStepCondition[]) =>
        onChange(runConditionFrom(next));
    const update = (index: number, patch: Partial<IWorkflowStepCondition>) =>
        save(
            conditions.map((part, current) =>
                current === index ? { ...part, ...patch } : part,
            ),
        );
    const remove = (index: number) => {
        setValuesTexts((texts) => texts.filter((_, at) => at !== index));
        save(conditions.filter((_, at) => at !== index));
    };
    const blank = (stepKey: string): IWorkflowStepCondition => ({
        stepKey,
        path: "",
        operator: "equals",
        values: [],
    });
    return (
        <fieldset className="flex flex-col gap-4">
            <legend className="text-label-14 text-on-surface">
                Run this step
            </legend>
            <p className="text-copy-14 text-muted-foreground">
                Choose conditions to end the chain early. When any does not hold
                for an item, this step and every step after it are skipped for
                that item: no model call, no cost.
            </p>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-0-step`}>When</Label>
                <Select
                    value={conditions[0]?.stepKey ?? ALWAYS}
                    onValueChange={(stepKey) => {
                        if (!stepKey || stepKey === ALWAYS) {
                            setValuesTexts([]);
                            onChange(undefined);
                            return;
                        }
                        save(
                            conditions.length > 0
                                ? conditions.map((part, index) =>
                                      index === 0 ? { ...part, stepKey } : part,
                                  )
                                : [blank(stepKey)],
                        );
                    }}
                >
                    <SelectTrigger id={`${id}-0-step`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value={ALWAYS}>Always</SelectItem>
                            {earlierSteps.map((step) => (
                                <SelectItem
                                    key={step.nodeKey}
                                    value={step.nodeKey}
                                >
                                    {`Only when ${step.label} matches`}
                                </SelectItem>
                            ))}
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            {conditions.map((part, index) => (
                <ConditionRow
                    key={index}
                    id={`${id}-${index}`}
                    index={index}
                    condition={part}
                    earlierSteps={earlierSteps}
                    valuesText={valuesTexts[index] ?? ""}
                    onValuesText={(text) =>
                        setValuesTexts((texts) => {
                            const next = [...texts];
                            next[index] = text;
                            return next;
                        })
                    }
                    onChange={(patch) => update(index, patch)}
                    onRemove={index > 0 ? () => remove(index) : undefined}
                />
            ))}
            {conditions.length > 0 ? (
                <div>
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                            save([
                                ...conditions,
                                blank(
                                    conditions[conditions.length - 1]!.stepKey,
                                ),
                            ])
                        }
                    >
                        <Plus />
                        Add condition
                    </Button>
                </div>
            ) : null}
        </fieldset>
    );
}

/** One condition: the step (after the first), the field, how and the values. */
function ConditionRow({
    id,
    index,
    condition,
    earlierSteps,
    valuesText,
    onValuesText,
    onChange,
    onRemove,
}: {
    id: string;
    index: number;
    condition: IWorkflowStepCondition;
    earlierSteps: EarlierStep[];
    valuesText: string;
    onValuesText: (text: string) => void;
    onChange: (patch: Partial<IWorkflowStepCondition>) => void;
    onRemove?: () => void;
}) {
    const fields = (
        <>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-path`}>Field</Label>
                <Input
                    id={`${id}-path`}
                    value={condition.path}
                    placeholder="$.is_sales"
                    className="text-mono-13"
                    onChange={(event) => onChange({ path: event.target.value })}
                />
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-operator`}>The field</Label>
                <Select
                    value={condition.operator}
                    onValueChange={(operator) =>
                        onChange({
                            operator:
                                operator as IWorkflowStepCondition["operator"],
                        })
                    }
                >
                    <SelectTrigger id={`${id}-operator`}>
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectGroup>
                            <SelectItem value="equals">is</SelectItem>
                            <SelectItem value="one_of">is one of</SelectItem>
                        </SelectGroup>
                    </SelectContent>
                </Select>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-values`}>
                    {condition.operator === "one_of"
                        ? "Values, separated by commas"
                        : "Value"}
                </Label>
                <Input
                    id={`${id}-values`}
                    value={valuesText}
                    placeholder={
                        condition.operator === "one_of"
                            ? "sales, renewal"
                            : "true"
                    }
                    aria-describedby={`${id}-values-hint`}
                    onChange={(event) => {
                        onValuesText(event.target.value);
                        onChange({
                            values: parseConditionValues(event.target.value),
                        });
                    }}
                />
                <p
                    id={`${id}-values-hint`}
                    className="text-copy-14 text-muted-foreground"
                >
                    true, false, null and numbers match those values. Put text
                    that looks like one in quotes, such as &quot;true&quot;.
                </p>
            </div>
            <IgnoreCaseField
                id={`${id}-ignore-case`}
                checked={condition.ignoreCase === true}
                onChange={(ignoreCase) =>
                    onChange({ ignoreCase: ignoreCase || undefined })
                }
            />
        </>
    );
    if (index === 0) return fields;
    return (
        <fieldset
            aria-label={`Condition ${index + 1}`}
            className="flex flex-col gap-4 border-t border-border pt-4"
        >
            <div className="flex items-end gap-2">
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Label htmlFor={`${id}-step`}>And when</Label>
                    <Select
                        value={condition.stepKey}
                        onValueChange={(stepKey) =>
                            stepKey && onChange({ stepKey })
                        }
                    >
                        <SelectTrigger id={`${id}-step`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectGroup>
                                {earlierSteps.map((step) => (
                                    <SelectItem
                                        key={step.nodeKey}
                                        value={step.nodeKey}
                                    >
                                        {`${step.label} matches`}
                                    </SelectItem>
                                ))}
                            </SelectGroup>
                        </SelectContent>
                    </Select>
                </div>
                {onRemove ? (
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove condition ${index + 1}`}
                        onClick={onRemove}
                    >
                        <Trash2 />
                    </Button>
                ) : null}
            </div>
            {fields}
        </fieldset>
    );
}

/** "Ignore case": text values match whatever their upper and lower case. */
export function IgnoreCaseField({
    id,
    checked,
    onChange,
}: {
    id: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center gap-2">
            <Checkbox
                id={id}
                checked={checked}
                onChange={(event) => onChange(event.target.checked)}
            />
            <Label htmlFor={id}>
                Ignore case (&quot;Sales&quot; matches &quot;sales&quot;)
            </Label>
        </div>
    );
}
