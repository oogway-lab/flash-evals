"use client";

import {
    STT_STANDARD_CONFIG_FIELDS,
    sttConfigFieldsForModelId,
    type IRunSetupSttModelOption,
    type ISttModelConfigField,
    type ISttRunConfig,
} from "@mosaic/api-contract";
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
import { Checkbox } from "@/components/ui/checkbox";

export function SttConfigFields({
    model,
    language,
    config,
    onLanguageChange,
    onConfigChange,
    idPrefix = "stt",
}: {
    model: IRunSetupSttModelOption | undefined;
    language: string;
    config: Record<string, unknown>;
    onLanguageChange: (value: string) => void;
    onConfigChange: (config: Record<string, unknown>) => void;
    idPrefix?: string;
}) {
    const enabledKeys = new Set(
        sttConfigFieldsForModelId(model?.id ?? "").map((field) => field.key),
    );

    return (
        <div className="grid gap-4 md:grid-cols-2">
            {STT_STANDARD_CONFIG_FIELDS.map((field) => {
                const enabled = enabledKeys.has(field.key);
                const isLanguage = field.key === "language";
                const alwaysOn =
                    !enabled &&
                    field.key === "diarization" &&
                    model?.outputKind === "diarized_transcript";
                return (
                    <ConfigField
                        key={field.key}
                        idPrefix={idPrefix}
                        field={field}
                        disabled={!enabled}
                        alwaysOn={alwaysOn}
                        value={
                            enabled
                                ? isLanguage
                                    ? language
                                    : fieldValue(config[field.key], field)
                                : alwaysOn
                                  ? true
                                  : fieldValue(undefined, field)
                        }
                        onChange={(value) => {
                            if (isLanguage) {
                                onLanguageChange(
                                    typeof value === "string" ? value : "",
                                );
                                return;
                            }
                            onConfigChange({
                                ...config,
                                [field.key]: value,
                            });
                        }}
                    />
                );
            })}
        </div>
    );
}

export function ConfigField({
    field,
    value,
    onChange,
    disabled = false,
    alwaysOn = false,
    idPrefix = "stt",
}: {
    field: ISttModelConfigField;
    value: unknown;
    onChange: (value: string | number | boolean) => void;
    disabled?: boolean;
    alwaysOn?: boolean;
    idPrefix?: string;
}) {
    const fieldId = `${idPrefix}-${field.key}`;
    const helpId = field.helpText ? `${fieldId}-help` : undefined;
    const unavailableId = disabled ? `${fieldId}-unavailable` : undefined;
    const describedBy = [helpId, unavailableId].filter(Boolean).join(" ");
    const stringValue =
        typeof value === "string" || typeof value === "number"
            ? String(value)
            : "";
    return (
        <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>{field.label}</Label>
            {field.kind === "textarea" ? (
                <Textarea
                    id={fieldId}
                    value={stringValue}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    aria-disabled={disabled || undefined}
                    aria-describedby={describedBy || undefined}
                    className="min-h-24"
                />
            ) : field.kind === "select" ? (
                <Select
                    value={stringValue}
                    onValueChange={(nextValue) => onChange(nextValue)}
                    disabled={disabled}
                >
                    <SelectTrigger
                        id={fieldId}
                        aria-disabled={disabled || undefined}
                        aria-describedby={describedBy || undefined}
                    >
                        <SelectValue
                            placeholder={field.placeholder ?? "Choose"}
                        />
                    </SelectTrigger>
                    <SelectContent>
                        {(field.options ?? []).map((option) => (
                            <SelectItem key={option.value} value={option.value}>
                                {option.label}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : field.kind === "boolean" ? (
                <label
                    htmlFor={fieldId}
                    className={`flex min-h-10 items-center gap-2 rounded-sm border border-border px-3 text-copy-14 ${
                        disabled
                            ? "cursor-not-allowed bg-muted opacity-50"
                            : "bg-neutral"
                    }`}
                >
                    <Checkbox
                        id={fieldId}
                        checked={value === true}
                        onChange={(event) => onChange(event.target.checked)}
                        disabled={disabled}
                        aria-disabled={disabled || undefined}
                        aria-describedby={describedBy || undefined}
                    />
                    <span id={helpId}>{field.helpText ?? field.label}</span>
                </label>
            ) : (
                <Input
                    id={fieldId}
                    type={field.kind === "number" ? "number" : "text"}
                    value={stringValue}
                    onChange={(event) => onChange(event.target.value)}
                    placeholder={field.placeholder}
                    disabled={disabled}
                    aria-disabled={disabled || undefined}
                    aria-describedby={describedBy || undefined}
                />
            )}
            {field.kind !== "boolean" && field.helpText && (
                <p id={helpId} className="text-copy-14 text-muted-foreground">
                    {field.helpText}
                </p>
            )}
            {disabled && (
                <p
                    id={unavailableId}
                    className="text-copy-14 text-muted-foreground"
                >
                    {alwaysOn
                        ? "Always on for this model"
                        : "Not applicable to this model"}
                </p>
            )}
        </div>
    );
}

export function configForSttModel(
    config: Record<string, unknown> | undefined,
    model: IRunSetupSttModelOption | undefined,
): Record<string, unknown> {
    const supportedKeys = new Set(
        sttConfigFieldsForModelId(model?.id ?? "")
            .filter((field) => field.key !== "language")
            .map((field) => field.key),
    );
    return Object.fromEntries(
        Object.entries(config ?? {}).filter(([key]) => supportedKeys.has(key)),
    );
}

export function configForSttSnapshot(
    config: Record<string, unknown>,
    model: IRunSetupSttModelOption | undefined,
): Record<string, unknown> {
    const fields = sttConfigFieldsForModelId(model?.id ?? "").filter(
        (field) => field.key !== "language",
    );
    const fieldByKey = new Map(fields.map((field) => [field.key, field]));
    return Object.fromEntries(
        Object.entries(config).flatMap(([key, value]) => {
            const field = fieldByKey.get(key);
            if (!field || value === undefined || value === null) return [];
            if (typeof value === "string") {
                const trimmed = value.trim();
                if (!trimmed) return [];
                if (field.kind === "number") {
                    const numeric = Number(trimmed);
                    return Number.isFinite(numeric) ? [[key, numeric]] : [];
                }
            }
            if (typeof value === "number" && !Number.isFinite(value)) return [];
            return [[key, value]];
        }),
    );
}

export function sttConfigForModel(
    current: ISttRunConfig,
    model: IRunSetupSttModelOption,
): ISttRunConfig {
    const supportsLanguage = sttConfigFieldsForModelId(model.id).some(
        (field) => field.key === "language",
    );
    const config = configForSttModel(current.config, model);
    return {
        modelId: model.id,
        ...(model.providerId ? { providerId: model.providerId } : {}),
        ...(model.routeId ? { routeId: model.routeId } : {}),
        ...(supportsLanguage && current.language
            ? { language: current.language }
            : {}),
        ...(Object.keys(config).length ? { config } : {}),
    };
}

function fieldValue(value: unknown, field: ISttModelConfigField): unknown {
    if (field.key === "keywords" && Array.isArray(value)) {
        return value.join(", ");
    }
    return value ?? field.defaultValue;
}
