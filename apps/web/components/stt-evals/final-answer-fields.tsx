"use client";

import { Plus, Trash2 } from "lucide-react";
import type {
    IPipelineFinalAnswer,
    IPipelineFinalAnswerField,
    IRunSetupVersionOption,
} from "@flash-evals/api-contract";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FinalAnswerFallbacks } from "./final-answer-fallbacks";
import { FinalAnswerRules } from "./final-answer-rules";
import { Label } from "@/components/ui/label";
import {
    Select,
    SelectContent,
    SelectGroup,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";

const NO_SCHEMA = "none";

/** One field per top-level property of a schema, each taken from the same field of a step. */
export function fieldsFromSchema(
    schema: IRunSetupVersionOption["outputSchema"],
): IPipelineFinalAnswerField[] {
    const properties =
        schema && typeof schema.properties === "object" && schema.properties
            ? Object.keys(schema.properties)
            : [];
    return properties.map((name) => ({
        path: `$.${name}`,
        stepKey: "",
        stepPath: `$.${name}`,
    }));
}

/**
 * The pipeline's final answer: one JSON object per item, each field taken
 * from a step's answer, optionally checked against a prompt version's output
 * schema so it can stand in for one big prompt's answer.
 */
export function FinalAnswerFields({
    value,
    steps,
    versions,
    onChange,
}: {
    value: IPipelineFinalAnswer | undefined;
    steps: Array<{ nodeKey: string; label: string }>;
    versions: IRunSetupVersionOption[];
    onChange: (value: IPipelineFinalAnswer | undefined) => void;
}) {
    const withSchema = versions.filter((version) => version.outputSchema);
    const setField = (
        index: number,
        patch: Partial<IPipelineFinalAnswerField>,
    ) =>
        value &&
        onChange({
            ...value,
            fields: value.fields.map((field, current) =>
                current === index ? { ...field, ...patch } : field,
            ),
        });
    return (
        <Card role="region" aria-label="Final answer">
            <CardHeader>
                <CardTitle as="h2">Final answer</CardTitle>
                <p className="text-copy-14 text-muted-foreground">
                    Combine step answers into one JSON object per item, in the
                    same shape as the prompt you want to replace. Fields of
                    skipped steps are left out unless you give them a fallback.
                </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
                {!value ? (
                    <div>
                        <Button
                            type="button"
                            variant="secondary"
                            disabled={steps.length === 0}
                            onClick={() =>
                                onChange({
                                    fields: [
                                        { path: "", stepKey: "", stepPath: "" },
                                    ],
                                })
                            }
                        >
                            <Plus />
                            Add final answer
                        </Button>
                    </div>
                ) : (
                    <>
                        <div className="flex flex-col gap-2 sm:max-w-md">
                            <Label htmlFor="final-answer-schema">
                                Check against the output schema of
                            </Label>
                            <Select
                                value={value.schemaPromptVersionId ?? NO_SCHEMA}
                                onValueChange={(id) => {
                                    const {
                                        schemaPromptVersionId: _old,
                                        ...rest
                                    } = value;
                                    onChange(
                                        !id || id === NO_SCHEMA
                                            ? rest
                                            : {
                                                  ...rest,
                                                  schemaPromptVersionId: id,
                                              },
                                    );
                                }}
                            >
                                <SelectTrigger id="final-answer-schema">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectGroup>
                                        <SelectItem value={NO_SCHEMA}>
                                            No schema check
                                        </SelectItem>
                                        {withSchema.map((version) => (
                                            <SelectItem
                                                key={version.id}
                                                value={version.id}
                                            >
                                                {version.label}
                                            </SelectItem>
                                        ))}
                                    </SelectGroup>
                                </SelectContent>
                            </Select>
                        </div>
                        <ol className="flex flex-col gap-3">
                            {value.fields.map((field, index) => (
                                <li
                                    key={index}
                                    className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end"
                                >
                                    <div className="flex flex-col gap-1">
                                        <Label htmlFor={`final-field-${index}`}>
                                            Field
                                        </Label>
                                        <Input
                                            id={`final-field-${index}`}
                                            value={field.path}
                                            placeholder="$.product"
                                            className="text-mono-13"
                                            onChange={(event) =>
                                                setField(index, {
                                                    path: event.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <Label htmlFor={`final-step-${index}`}>
                                            From step
                                        </Label>
                                        <Select
                                            value={field.stepKey}
                                            onValueChange={(stepKey) =>
                                                setField(index, {
                                                    stepKey: stepKey ?? "",
                                                })
                                            }
                                        >
                                            <SelectTrigger
                                                id={`final-step-${index}`}
                                            >
                                                <SelectValue placeholder="Select step" />
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
                                    <div className="flex flex-col gap-1">
                                        <Label
                                            htmlFor={`final-step-field-${index}`}
                                        >
                                            Step field
                                        </Label>
                                        <Input
                                            id={`final-step-field-${index}`}
                                            value={field.stepPath}
                                            placeholder="$.product, or $"
                                            className="text-mono-13"
                                            onChange={(event) =>
                                                setField(index, {
                                                    stepPath:
                                                        event.target.value,
                                                })
                                            }
                                        />
                                    </div>
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Remove field ${field.path || index + 1}`}
                                        onClick={() =>
                                            onChange({
                                                ...value,
                                                fields: value.fields.filter(
                                                    (_field, current) =>
                                                        current !== index,
                                                ),
                                            })
                                        }
                                    >
                                        <Trash2 />
                                    </Button>
                                    <div className="flex flex-col gap-2 sm:col-span-4">
                                        <FinalAnswerRules
                                            id={`final-${index}-rules`}
                                            rules={field.setWhen ?? []}
                                            steps={steps}
                                            onChange={(setWhen) =>
                                                setField(index, { setWhen })
                                            }
                                        />
                                        <FinalAnswerFallbacks
                                            id={`final-${index}`}
                                            field={field}
                                            onChange={(patch) =>
                                                setField(index, patch)
                                            }
                                        />
                                    </div>
                                </li>
                            ))}
                        </ol>
                        <div className="flex flex-wrap gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() =>
                                    onChange({
                                        ...value,
                                        fields: [
                                            ...value.fields,
                                            {
                                                path: "",
                                                stepKey: "",
                                                stepPath: "",
                                            },
                                        ],
                                    })
                                }
                            >
                                <Plus />
                                Add field
                            </Button>
                            {value.schemaPromptVersionId ? (
                                <Button
                                    type="button"
                                    variant="ghost"
                                    onClick={() =>
                                        onChange({
                                            ...value,
                                            fields: fieldsFromSchema(
                                                withSchema.find(
                                                    (version) =>
                                                        version.id ===
                                                        value.schemaPromptVersionId,
                                                )?.outputSchema,
                                            ),
                                        })
                                    }
                                >
                                    List the schema&apos;s fields
                                </Button>
                            ) : null}
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => onChange(undefined)}
                            >
                                <Trash2 />
                                Remove final answer
                            </Button>
                        </div>
                        <p className="text-copy-14 text-muted-foreground">
                            Fields are paths such as $.product or $.call.notes.
                            Use $ as the step field to take a step&apos;s whole
                            answer. Save the canvas to keep changes.
                        </p>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
