"use client";

import { useState } from "react";
import {
    inputTemplateErrors,
    STEP_MAX_OUTPUT_TOKENS,
    stepSettingsErrors,
    type IWorkflowStepSettings,
} from "@flash-evals/api-contract";
import { Textarea } from "@/components/ui/textarea";
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

const OUTPUT_MODES = [
    {
        value: "json_schema",
        label: "Strict JSON schema (default)",
        hint: "The provider makes the reply follow the output schema.",
    },
    {
        value: "json_object",
        label: "JSON mode",
        hint: "The provider returns any JSON object; the schema checks it after. OpenAI needs the word JSON in the prompt.",
    },
    {
        value: "text",
        label: "Text, then read the JSON",
        hint: "No format is asked for. The JSON object is read from the reply (code fences are fine) and checked against the schema.",
    },
] as const;

/**
 * A Prompt or LLM text step's own call settings: temperature and output
 * limit, sent on every call on every provider. Blank keeps the route's
 * (Simple mode: 4,096 output tokens and no temperature).
 */
export function StepSettingsFields({
    nodeKey,
    label,
    settings,
    onChange,
    hasOutputSchema = false,
    earlierSteps = [],
}: {
    nodeKey: string;
    label: string;
    settings: IWorkflowStepSettings | undefined;
    /** Prompt steps: the output mode applies to their output schema. */
    hasOutputSchema?: boolean;
    /** Steps that run before this one, which its input template may read. */
    earlierSteps?: Array<{ nodeKey: string; label: string }>;
    onChange: (settings: IWorkflowStepSettings | undefined) => void;
}) {
    const id = `step-settings-${nodeKey}`;
    // Typed text is kept as typed; a valid number is saved.
    const [temperature, setTemperature] = useState(
        settings?.temperature?.toString() ?? "",
    );
    const [maxOutputTokens, setMaxOutputTokens] = useState(
        settings?.maxOutputTokens?.toString() ?? "",
    );
    const save = (patch: Partial<IWorkflowStepSettings>) => {
        const next: IWorkflowStepSettings = { ...settings, ...patch };
        for (const key of Object.keys(next) as Array<keyof typeof next>)
            if (next[key] === undefined) delete next[key];
        onChange(Object.keys(next).length > 0 ? next : undefined);
    };
    const numberOrUndefined = (text: string) =>
        text.trim() === "" ? undefined : Number(text);
    const errors = stepSettingsErrors(
        {
            temperature: numberOrUndefined(temperature),
            maxOutputTokens: numberOrUndefined(maxOutputTokens),
        },
        label,
    );
    return (
        <fieldset className="flex flex-col gap-4">
            <legend className="text-label-14 text-on-surface">
                Step settings
            </legend>
            <p className="text-copy-14 text-muted-foreground">
                Sent on every call of this step, whatever the provider. Leave
                blank to keep the route&apos;s setting.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-temperature`}>
                        Step temperature
                    </Label>
                    <Input
                        id={`${id}-temperature`}
                        inputMode="decimal"
                        placeholder="Not sent"
                        value={temperature}
                        onChange={(event) => {
                            const text = event.target.value;
                            setTemperature(text);
                            const value = numberOrUndefined(text);
                            if (
                                value === undefined ||
                                (Number.isFinite(value) &&
                                    value >= 0 &&
                                    value <= 2)
                            )
                                save({ temperature: value });
                        }}
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor={`${id}-max-output`}>
                        Step output limit (tokens)
                    </Label>
                    <Input
                        id={`${id}-max-output`}
                        inputMode="numeric"
                        placeholder="4096"
                        value={maxOutputTokens}
                        onChange={(event) => {
                            const text = event.target.value;
                            setMaxOutputTokens(text);
                            const value = numberOrUndefined(text);
                            if (
                                value === undefined ||
                                (Number.isInteger(value) &&
                                    value >= 1 &&
                                    value <= STEP_MAX_OUTPUT_TOKENS)
                            )
                                save({ maxOutputTokens: value });
                        }}
                    />
                </div>
            </div>
            {hasOutputSchema ? (
                <OutputModeField
                    id={`${id}-output-mode`}
                    value={settings?.outputMode ?? "json_schema"}
                    onChange={(outputMode) =>
                        save({
                            outputMode:
                                outputMode === "json_schema"
                                    ? undefined
                                    : outputMode,
                        })
                    }
                />
            ) : null}
            <InputTemplateField
                id={`${id}-input-template`}
                label={label}
                template={settings?.inputTemplate}
                earlierSteps={earlierSteps}
                onChange={(inputTemplate) => save({ inputTemplate })}
            />
            <p className="text-copy-13 text-muted-foreground">
                Models that refuse temperature (such as OpenAI reasoning models)
                are sent none. The output limit includes thinking tokens.
            </p>
            {errors.map((error) => (
                <p key={error} role="alert" className="text-copy-13 text-error">
                    {error}
                </p>
            ))}
        </fieldset>
    );
}

function OutputModeField({
    id,
    value,
    onChange,
}: {
    id: string;
    value: NonNullable<IWorkflowStepSettings["outputMode"]>;
    onChange: (value: NonNullable<IWorkflowStepSettings["outputMode"]>) => void;
}) {
    const selected = OUTPUT_MODES.find((mode) => mode.value === value);
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>Output mode</Label>
            <Select
                value={value}
                onValueChange={(next) => {
                    const mode = OUTPUT_MODES.find(
                        (option) => option.value === next,
                    );
                    if (mode) onChange(mode.value);
                }}
            >
                <SelectTrigger id={id}>
                    <SelectValue>{selected?.label}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                    <SelectGroup>
                        {OUTPUT_MODES.map((mode) => (
                            <SelectItem key={mode.value} value={mode.value}>
                                {mode.label}
                            </SelectItem>
                        ))}
                    </SelectGroup>
                </SelectContent>
            </Select>
            <p className="text-copy-13 text-muted-foreground">
                {selected?.hint}
            </p>
        </div>
    );
}

/**
 * The step's user message, built from parts of the item and earlier
 * answers. Blank keeps the default (`<input>` or the connected answers).
 */
function InputTemplateField({
    id,
    label,
    template,
    earlierSteps,
    onChange,
}: {
    id: string;
    label: string;
    template: string | undefined;
    earlierSteps: Array<{ nodeKey: string; label: string }>;
    onChange: (template: string | undefined) => void;
}) {
    const errors =
        template === undefined
            ? []
            : inputTemplateErrors(
                  template,
                  label,
                  new Map(
                      earlierSteps.map((step) => [step.nodeKey, step.label]),
                  ),
                  new Set(earlierSteps.map((step) => step.nodeKey)),
              );
    const example = earlierSteps[0]?.label ?? "Extract";
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={id}>Input template</Label>
            <Textarea
                id={id}
                rows={5}
                className="font-mono"
                placeholder={`<transcript>{{input.transcript}}</transcript>\n{{${example}.$ | pick:title,product}}`}
                value={template ?? ""}
                onChange={(event) =>
                    onChange(
                        event.target.value === ""
                            ? undefined
                            : event.target.value,
                    )
                }
            />
            <p className="text-copy-13 text-muted-foreground">
                Builds this step&apos;s message instead of the item text or the
                connected answers. {"{{input}}"} is the whole item,{" "}
                {"{{input.name}}"} its {"<name>…</name>"} section (or a JSON
                item&apos;s field), {"{{input.name.field}}"} a field of the JSON
                in that section, {`{{${example}.$.field}}`} an earlier
                step&apos;s answer; {`| pick:a,b`} keeps some fields and{" "}
                {`| default:"text"`} fills a missing value. Leave blank for the
                default.
            </p>
            {errors.map((error) => (
                <p key={error} role="alert" className="text-copy-13 text-error">
                    {error}
                </p>
            ))}
        </div>
    );
}
