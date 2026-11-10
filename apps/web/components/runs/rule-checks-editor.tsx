"use client";

import { Plus } from "lucide-react";
import type {
    IBenchmarkRule,
    IBenchmarkRulesTask,
} from "@flash-evals/api-contract";
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
    RULE_KIND_LABELS,
    RULE_VALUES_LABELS,
    addRule,
    isRuleKind,
    parseWordLimit,
    ruleValues,
    splitLines,
    withRuleKind,
    withRuleValues,
    withWordLimit,
} from "./rule-checks";

/** The checks of one rule-check task: what each looks at and for. */
export function RuleChecksEditor({
    task,
    id,
    pathListId,
    onChange,
}: {
    task: IBenchmarkRulesTask;
    id: string;
    pathListId: string;
    onChange: (task: IBenchmarkRulesTask) => void;
}) {
    const setRule = (index: number, rule: IBenchmarkRule) =>
        onChange({
            ...task,
            rules: task.rules.map((current, i) =>
                i === index ? rule : current,
            ),
        });
    return (
        <div className="flex flex-col gap-3">
            {task.rules.map((rule, index) => (
                <RuleEditor
                    key={`${index}-${rule.key}`}
                    rule={rule}
                    id={`${id}-rule-${index}`}
                    pathListId={pathListId}
                    onChange={(next) => setRule(index, next)}
                    onRemove={() =>
                        onChange({
                            ...task,
                            rules: task.rules.filter((_, i) => i !== index),
                        })
                    }
                />
            ))}
            <div>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onChange(addRule(task))}
                >
                    <Plus className="size-4" aria-hidden="true" />
                    Add check
                </Button>
            </div>
        </div>
    );
}

function RuleEditor({
    rule,
    id,
    pathListId,
    onChange,
    onRemove,
}: {
    rule: IBenchmarkRule;
    id: string;
    pathListId: string;
    onChange: (rule: IBenchmarkRule) => void;
    onRemove: () => void;
}) {
    const values = ruleValues(rule);
    return (
        <div
            role="group"
            aria-label={`Check: ${rule.name || rule.key}`}
            className="flex flex-col gap-3 rounded-sm border border-border p-3"
        >
            <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-name`}>Check</Label>
                    <Input
                        id={`${id}-name`}
                        value={rule.name}
                        onChange={(event) =>
                            onChange({ ...rule, name: event.target.value })
                        }
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-kind`}>Kind</Label>
                    <Select
                        value={rule.kind}
                        onValueChange={(value) => {
                            if (typeof value === "string" && isRuleKind(value))
                                onChange(withRuleKind(rule, value));
                        }}
                    >
                        <SelectTrigger id={`${id}-kind`}>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {Object.entries(RULE_KIND_LABELS).map(
                                ([value, text]) => (
                                    <SelectItem key={value} value={value}>
                                        {text}
                                    </SelectItem>
                                ),
                            )}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="flex flex-col gap-2">
                <Label htmlFor={`${id}-paths`}>
                    Output fields, separated by commas
                </Label>
                <Input
                    id={`${id}-paths`}
                    className="text-mono-13"
                    list={pathListId}
                    defaultValue={rule.paths.join(", ")}
                    onBlur={(event) =>
                        onChange({
                            ...rule,
                            paths: splitLines(event.target.value, /,/),
                        })
                    }
                />
            </div>
            {rule.kind === "word_count" ? (
                <WordLimitsEditor rule={rule} id={id} onChange={onChange} />
            ) : (
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-values`}>
                        {RULE_VALUES_LABELS[rule.kind]} ({values.length})
                    </Label>
                    <Textarea
                        id={`${id}-values`}
                        rows={Math.min(8, Math.max(2, values.length))}
                        className="text-mono-13"
                        defaultValue={values.join("\n")}
                        onBlur={(event) =>
                            onChange(
                                withRuleValues(
                                    rule,
                                    splitLines(event.target.value),
                                ),
                            )
                        }
                    />
                </div>
            )}
            <div>
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove check ${rule.name || rule.key}`}
                    onClick={onRemove}
                >
                    Remove check
                </Button>
            </div>
        </div>
    );
}

/** Fewest and most words each field may hold; either may be left empty. */
function WordLimitsEditor({
    rule,
    id,
    onChange,
}: {
    rule: IBenchmarkRule;
    id: string;
    onChange: (rule: IBenchmarkRule) => void;
}) {
    const bounds = [
        { bound: "min", label: "Fewest words" },
        { bound: "max", label: "Most words" },
    ] as const;
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            {bounds.map(({ bound, label }) => (
                <div key={bound} className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-${bound}`}>{label}</Label>
                    <Input
                        id={`${id}-${bound}`}
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={1}
                        defaultValue={rule[bound] ?? ""}
                        onBlur={(event) =>
                            onChange(
                                withWordLimit(
                                    rule,
                                    bound,
                                    parseWordLimit(event.target.value),
                                ),
                            )
                        }
                    />
                </div>
            ))}
        </div>
    );
}
