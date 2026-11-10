"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
    formatFinalValue,
    parseFinalValue,
    type FinalAnswerFallback,
    type IFinalAnswerValueMapping,
    type IPipelineFinalAnswerField,
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
import { Textarea } from "@/components/ui/textarea";

type FallbackKind = "none" | "value" | "template";

function kindOf(fallback: FinalAnswerFallback | undefined): FallbackKind {
    if (!fallback) return "none";
    return "template" in fallback ? "template" : "value";
}

/** How many extras a field has, in plain words, for the closed summary. */
function extrasSummary(field: IPipelineFinalAnswerField): string | undefined {
    const parts = [
        field.fallback ? "fallback" : undefined,
        field.whenEmpty ? "empty default" : undefined,
        field.valueMap?.length
            ? `${field.valueMap.length} value ${field.valueMap.length === 1 ? "change" : "changes"}`
            : undefined,
    ].filter(Boolean);
    return parts.length ? parts.join(", ") : undefined;
}

/**
 * A final-answer field's fallbacks: what to use when its step was skipped
 * or its value is empty, and exact values to replace.
 */
export function FinalAnswerFallbacks({
    id,
    field,
    onChange,
}: {
    id: string;
    field: IPipelineFinalAnswerField;
    onChange: (patch: Partial<IPipelineFinalAnswerField>) => void;
}) {
    const summary = extrasSummary(field);
    const set = <K extends "fallback" | "whenEmpty" | "valueMap">(
        key: K,
        value: IPipelineFinalAnswerField[K] | undefined,
    ) => onChange({ [key]: value } as Partial<IPipelineFinalAnswerField>);
    return (
        <Collapsible defaultOpen={summary !== undefined}>
            <CollapsibleTrigger>
                {summary
                    ? `If skipped or empty (${summary})`
                    : "If skipped or empty"}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-4 pt-3 pl-6">
                <FallbackEditor
                    id={`${id}-fallback`}
                    legend="When the step is skipped"
                    noneLabel="Leave the field out"
                    value={field.fallback}
                    onChange={(value) => set("fallback", value)}
                />
                <FallbackEditor
                    id={`${id}-empty`}
                    legend="When the value is empty"
                    noneLabel={
                        field.fallback
                            ? "Use the fallback above"
                            : "Keep it as it is"
                    }
                    value={field.whenEmpty}
                    onChange={(value) => set("whenEmpty", value)}
                />
                <ValueMapEditor
                    id={`${id}-map`}
                    value={field.valueMap ?? []}
                    onChange={(value) =>
                        set("valueMap", value.length ? value : undefined)
                    }
                />
            </CollapsibleContent>
        </Collapsible>
    );
}

function FallbackEditor({
    id,
    legend,
    noneLabel,
    value,
    onChange,
}: {
    id: string;
    legend: string;
    noneLabel: string;
    value: FinalAnswerFallback | undefined;
    onChange: (value: FinalAnswerFallback | undefined) => void;
}) {
    const kind = kindOf(value);
    const [valueText, setValueText] = useState(() =>
        value && "value" in value ? formatFinalValue(value.value) : "",
    );
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={`${id}-kind`}>{legend}</Label>
            <Select
                value={kind}
                onValueChange={(next) => {
                    if (next === "value") {
                        setValueText("");
                        onChange({ value: "" });
                    } else if (next === "template") onChange({ template: "" });
                    else onChange(undefined);
                }}
            >
                <SelectTrigger id={`${id}-kind`} className="sm:max-w-xs">
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        <SelectItem value="none">{noneLabel}</SelectItem>
                        <SelectItem value="value">Use a fixed value</SelectItem>
                        <SelectItem value="template">
                            Fill in from other steps
                        </SelectItem>
                    </SelectGroup>
                </SelectContent>
            </Select>
            {value && "value" in value ? (
                <>
                    <Label htmlFor={`${id}-value`} className="sr-only">
                        {`${legend}: value`}
                    </Label>
                    <Input
                        id={`${id}-value`}
                        value={valueText}
                        placeholder="Not discussed"
                        onChange={(event) => {
                            setValueText(event.target.value);
                            onChange({
                                value: parseFinalValue(event.target.value),
                            });
                        }}
                    />
                </>
            ) : null}
            {value && "template" in value ? (
                <>
                    <Label htmlFor={`${id}-template`} className="sr-only">
                        {`${legend}: template`}
                    </Label>
                    <Textarea
                        id={`${id}-template`}
                        value={value.template}
                        placeholder={
                            "## {{Extract.$.title}}\n\n{{Extract.$.reason}}"
                        }
                        className="text-mono-13"
                        aria-describedby={`${id}-template-hint`}
                        onChange={(event) =>
                            onChange({ template: event.target.value })
                        }
                    />
                    <p
                        id={`${id}-template-hint`}
                        className="text-copy-14 text-muted-foreground"
                    >
                        Write {"{{"}step.$.field{"}}"} to insert a value from a
                        step that ran, naming the step as on the canvas, for
                        example {"{{"}Extract.$.title{"}}"}. A value that is
                        missing is left blank.
                    </p>
                </>
            ) : null}
        </div>
    );
}

function ValueMapEditor({
    id,
    value,
    onChange,
}: {
    id: string;
    value: IFinalAnswerValueMapping[];
    onChange: (value: IFinalAnswerValueMapping[]) => void;
}) {
    // Typed text is kept as typed; parsed values are saved.
    const [texts, setTexts] = useState(() =>
        value.map((mapping) => ({
            from: formatFinalValue(mapping.from),
            to: formatFinalValue(mapping.to),
        })),
    );
    const update = (index: number, side: "from" | "to", text: string) => {
        setTexts((current) =>
            current.map((entry, at) =>
                at === index ? { ...entry, [side]: text } : entry,
            ),
        );
        onChange(
            value.map((mapping, at) =>
                at === index
                    ? { ...mapping, [side]: parseFinalValue(text) }
                    : mapping,
            ),
        );
    };
    return (
        <fieldset className="flex flex-col gap-2">
            <legend className="text-label-14 text-on-surface">
                Replace values
            </legend>
            <p className="text-copy-14 text-muted-foreground">
                Swap an exact value for another before the empty check, for
                example a blank role for Customer. Leave a box blank for empty
                text.
            </p>
            {value.map((_mapping, index) => (
                <div
                    key={index}
                    className="grid grid-cols-[1fr_1fr_auto] items-end gap-2"
                >
                    <div className="flex min-w-0 flex-col gap-1">
                        <Label htmlFor={`${id}-${index}-from`}>Value</Label>
                        <Input
                            id={`${id}-${index}-from`}
                            value={texts[index]?.from ?? ""}
                            placeholder="(blank)"
                            onChange={(event) =>
                                update(index, "from", event.target.value)
                            }
                        />
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                        <Label htmlFor={`${id}-${index}-to`}>Becomes</Label>
                        <Input
                            id={`${id}-${index}-to`}
                            value={texts[index]?.to ?? ""}
                            placeholder="Customer"
                            onChange={(event) =>
                                update(index, "to", event.target.value)
                            }
                        />
                    </div>
                    <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove value change ${index + 1}`}
                        onClick={() => {
                            setTexts((current) =>
                                current.filter((_, at) => at !== index),
                            );
                            onChange(value.filter((_, at) => at !== index));
                        }}
                    >
                        <Trash2 />
                    </Button>
                </div>
            ))}
            <div>
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                        setTexts((current) => [
                            ...current,
                            { from: "", to: "" },
                        ]);
                        onChange([...value, { from: "", to: "" }]);
                    }}
                >
                    <Plus />
                    Add value change
                </Button>
            </div>
        </fieldset>
    );
}
