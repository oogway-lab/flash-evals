"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
    formatConditionValues,
    formatFinalValue,
    parseConditionValues,
    parseFinalValue,
    type IFinalAnswerRule,
} from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import { IgnoreCaseField } from "./step-condition-fields";

type Step = { nodeKey: string; label: string };

interface IRuleTexts {
    value: string;
    values: string;
}

/**
 * "Set to <value> when <step field matches>" rules for one final-answer
 * field, checked before the field is taken from its step. Declarative only.
 */
export function FinalAnswerRules({
    id,
    rules,
    steps,
    onChange,
}: {
    id: string;
    rules: IFinalAnswerRule[];
    steps: Step[];
    onChange: (rules: IFinalAnswerRule[] | undefined) => void;
}) {
    // Typed text is kept as typed; parsed values are saved.
    const [texts, setTexts] = useState<IRuleTexts[]>(() =>
        rules.map((rule) => ({
            value: formatFinalValue(rule.value),
            values: formatConditionValues(rule.when.values),
        })),
    );
    const save = (next: IFinalAnswerRule[]) =>
        onChange(next.length > 0 ? next : undefined);
    const update = (index: number, patch: Partial<IFinalAnswerRule>) =>
        save(
            rules.map((rule, at) =>
                at === index ? { ...rule, ...patch } : rule,
            ),
        );
    const setText = (index: number, patch: Partial<IRuleTexts>) =>
        setTexts((current) =>
            current.map((entry, at) =>
                at === index ? { ...entry, ...patch } : entry,
            ),
        );
    const add = () => {
        const first = steps[0];
        if (!first) return;
        setTexts((current) => [...current, { value: "", values: "" }]);
        save([
            ...rules,
            {
                when: {
                    stepKey: first.nodeKey,
                    path: "",
                    operator: "equals",
                    values: [],
                },
                value: "",
            },
        ]);
    };
    const remove = (index: number) => {
        setTexts((current) => current.filter((_, at) => at !== index));
        save(rules.filter((_, at) => at !== index));
    };
    return (
        <Collapsible defaultOpen={rules.length > 0}>
            <CollapsibleTrigger>
                {rules.length
                    ? `Set by a rule (${rules.length})`
                    : "Set by a rule"}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4 pt-3 pl-6">
                <p className="text-copy-14 text-muted-foreground">
                    Set this field to a value when a step&apos;s field matches,
                    for example true when Extract $.type is non-sales. Rules are
                    checked first, in order; when none matches, the field comes
                    from its step as usual.
                </p>
                {rules.map((rule, index) => (
                    <fieldset
                        key={index}
                        aria-label={`Rule ${index + 1}`}
                        className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2"
                    >
                        <div className="flex min-w-0 flex-col gap-1">
                            <Label htmlFor={`${id}-${index}-value`}>
                                Set to
                            </Label>
                            <Input
                                id={`${id}-${index}-value`}
                                placeholder="true"
                                value={texts[index]?.value ?? ""}
                                onChange={(event) => {
                                    setText(index, {
                                        value: event.target.value,
                                    });
                                    update(index, {
                                        value: parseFinalValue(
                                            event.target.value,
                                        ),
                                    });
                                }}
                            />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                            <Label htmlFor={`${id}-${index}-step`}>When</Label>
                            <Select
                                value={rule.when.stepKey}
                                onValueChange={(stepKey) =>
                                    stepKey &&
                                    update(index, {
                                        when: { ...rule.when, stepKey },
                                    })
                                }
                            >
                                <SelectTrigger id={`${id}-${index}-step`}>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        {steps.map((step) => (
                                            <SelectItem
                                                key={step.nodeKey}
                                                value={step.nodeKey}
                                            >
                                                {step.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                            <Label htmlFor={`${id}-${index}-path`}>
                                Its field
                            </Label>
                            <Input
                                id={`${id}-${index}-path`}
                                className="font-mono"
                                placeholder="$.type"
                                value={rule.when.path}
                                onChange={(event) =>
                                    update(index, {
                                        when: {
                                            ...rule.when,
                                            path: event.target.value,
                                        },
                                    })
                                }
                            />
                        </div>
                        <div className="flex min-w-0 flex-col gap-1">
                            <Label htmlFor={`${id}-${index}-values`}>
                                Is (one value, or several separated by commas)
                            </Label>
                            <Input
                                id={`${id}-${index}-values`}
                                placeholder="non-sales"
                                value={texts[index]?.values ?? ""}
                                onChange={(event) => {
                                    setText(index, {
                                        values: event.target.value,
                                    });
                                    const values = parseConditionValues(
                                        event.target.value,
                                    );
                                    update(index, {
                                        when: {
                                            ...rule.when,
                                            values,
                                            operator:
                                                values.length > 1
                                                    ? "one_of"
                                                    : "equals",
                                        },
                                    });
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-2 sm:col-span-2">
                            <IgnoreCaseField
                                id={`${id}-${index}-ignore-case`}
                                checked={rule.when.ignoreCase === true}
                                onChange={(ignoreCase) =>
                                    update(index, {
                                        when: {
                                            ...rule.when,
                                            ignoreCase: ignoreCase || undefined,
                                        },
                                    })
                                }
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Remove rule ${index + 1}`}
                                onClick={() => remove(index)}
                            >
                                <Trash2 />
                            </Button>
                        </div>
                    </fieldset>
                ))}
                <div>
                    <Button
                        type="button"
                        variant="secondary"
                        disabled={steps.length === 0}
                        onClick={add}
                    >
                        <Plus />
                        Add rule
                    </Button>
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}
