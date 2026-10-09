"use client";

import { PendingFieldset } from "@/components/ui/pending-fieldset";
import { TransientStatus } from "@/components/ui/transient-status";
import { FieldErrorIdsProvider } from "@/components/ui/field-error-context";
import {
    useActionState,
    useEffect,
    useMemo,
    useState,
    Fragment,
    type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { ArrayField } from "./array-field";
import { ReadinessChecklist, type IReadinessMeta } from "./readiness";
import { formatLabelError, validateLabel } from "@/lib/datasets/schema-form";
import {
    uploadFormMedia,
    type IUploadField,
} from "@/lib/uploads/upload-form-media";
import type {
    IParsedSchemaDescriptor,
    LabelJson,
    SchemaFieldType,
} from "@/server/db/jsonTypes";
import type { IActionState } from "@/app/actions";

type FieldValue = string | string[];
type FieldValues = Record<string, FieldValue>;

const initialState: IActionState = {};

function SubmitButton({ label }: { label: string }) {
    const { pending } = useFormStatus();
    return (
        <Button type="submit" loading={pending} loadingText="Saving…">
            {label}
        </Button>
    );
}

/** Errors for controls the caller renders as `children`. */
const CHILD_ERROR_FIELDS = ["inputText", "image", "audio"] as const;

export function LabelForm({
    id,
    datasetId,
    schema,
    freeformLabel = false,
    readiness,
    initialLabel,
    action,
    submitLabel,
    resetOnSuccess = false,
    onSuccess,
    children,
    secondaryAction,
    hiddenFields,
    freeformLabelText = "Golden answer (JSON)",
    uploadFields,
}: {
    id?: string;
    datasetId: string;
    schema: IParsedSchemaDescriptor | undefined;
    freeformLabel?: boolean;
    readiness: IReadinessMeta;
    initialLabel?: LabelJson;
    action: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    submitLabel: string;
    resetOnSuccess?: boolean;
    onSuccess?: () => void;
    children?: ReactNode;
    secondaryAction?: ReactNode;
    hiddenFields?: Record<string, string>;
    freeformLabelText?: string;
    /**
     * Media fields (`image`/`audio`) whose bytes upload directly to storage
     * before the action runs; replaced with `storageKey` metadata (R1).
     */
    uploadFields?: IUploadField[];
}) {
    async function runAction(
        prev: IActionState,
        formData: FormData,
    ): Promise<IActionState> {
        if (uploadFields && uploadFields.length > 0) {
            const uploadError = await uploadFormMedia(
                formData,
                datasetId,
                uploadFields,
            );
            if (uploadError) {
                return {
                    fieldErrors: { [uploadError.field]: [uploadError.message] },
                };
            }
        }
        return action(prev, formData);
    }

    const [state, formAction] = useActionState(runAction, initialState);
    // Remounting the caller's fields clears them (including file pickers,
    // which otherwise keep their files across React's post-action reset).
    const fieldsKey = resetOnSuccess && state.ok ? state.resetKey : undefined;
    // Hides "Item saved." once the user edits again.
    const [editedAfter, setEditedAfter] = useState<unknown>();
    const [values, setValues] = useState<FieldValues>(() =>
        initialValues(schema, initialLabel),
    );
    const [rawLabel, setRawLabel] = useState(
        initialLabel ? JSON.stringify(initialLabel, null, 2) : "{}",
    );
    const [clientErrors, setClientErrors] = useState<Record<string, string[]>>(
        {},
    );

    useEffect(() => {
        setValues(initialValues(schema, initialLabel));
        setRawLabel(
            initialLabel ? JSON.stringify(initialLabel, null, 2) : "{}",
        );
        setClientErrors({});
    }, [schema, initialLabel, freeformLabel]);

    useEffect(() => {
        if (!state.ok) return;
        if (resetOnSuccess && state.resetKey) {
            setValues(initialValues(schema, undefined));
            setRawLabel("{}");
            setClientErrors({});
        }
        onSuccess?.();
    }, [resetOnSuccess, schema, state.ok, state.resetKey, onSuccess]);

    // Controls passed in as `children` (text, image, audio) look up their
    // error id through context.
    const childErrorIds = Object.fromEntries(
        CHILD_ERROR_FIELDS.map((key) => [
            key,
            state.fieldErrors?.[key]?.[0]
                ? `${id ?? "label"}-${key}-error`
                : undefined,
        ]),
    );

    const labelJson = useMemo(
        () => (schema && !freeformLabel ? buildLabel(values, schema) : {}),
        [schema, freeformLabel, values],
    );

    if (freeformLabel) {
        return (
            <form
                id={id}
                action={formAction}
                onChange={() => setEditedAfter(state)}
            >
                <PendingFieldset className="flex flex-col gap-4">
                    <input type="hidden" name="datasetId" value={datasetId} />
                    {hiddenFields &&
                        Object.entries(hiddenFields).map(([name, value]) => (
                            <input
                                key={name}
                                type="hidden"
                                name={name}
                                value={value}
                            />
                        ))}
                    <FieldErrorIdsProvider ids={childErrorIds}>
                        <Fragment key={fieldsKey}>{children}</Fragment>
                    </FieldErrorIdsProvider>
                    <div className="flex flex-col gap-2">
                        <Label htmlFor={`${id ?? "label"}-json`}>
                            {freeformLabelText}
                        </Label>
                        <Textarea
                            id={`${id ?? "label"}-json`}
                            name="label"
                            rows={6}
                            value={rawLabel}
                            onChange={(e) => setRawLabel(e.target.value)}
                            aria-invalid={
                                state.fieldErrors?.label ? true : undefined
                            }
                            aria-describedby={
                                state.fieldErrors?.label
                                    ? `${id ?? "label"}-json-error`
                                    : undefined
                            }
                            className="text-mono-13"
                        />
                        {state.fieldErrors?.label?.map((message, index) => (
                            <p
                                key={message}
                                id={
                                    index === 0
                                        ? `${id ?? "label"}-json-error`
                                        : undefined
                                }
                                role="alert"
                                className="text-copy-14 text-error"
                            >
                                {message}
                            </p>
                        ))}
                    </div>
                    {state.fieldErrors?.inputText?.[0] && (
                        <p
                            id={`${id ?? "label"}-inputText-error`}
                            role="alert"
                            className="text-copy-14 text-error"
                        >
                            {state.fieldErrors.inputText[0]}
                        </p>
                    )}
                    {state.fieldErrors?.image?.[0] && (
                        <p
                            id={`${id ?? "label"}-image-error`}
                            role="alert"
                            className="text-copy-14 text-error"
                        >
                            {state.fieldErrors.image[0]}
                        </p>
                    )}
                    {state.fieldErrors?.audio?.[0] && (
                        <p
                            id={`${id ?? "label"}-audio-error`}
                            role="alert"
                            className="text-copy-14 text-error"
                        >
                            {state.fieldErrors.audio[0]}
                        </p>
                    )}
                    {state.formError && (
                        <p role="alert" className="text-copy-14 text-error">
                            {state.formError}
                        </p>
                    )}
                    {resetOnSuccess && (
                        <TransientStatus
                            token={state.ok ? state : undefined}
                            dismissed={editedAfter === state}
                        >
                            Item saved.
                        </TransientStatus>
                    )}
                    <div className="flex flex-wrap gap-2">
                        <SubmitButton label={submitLabel} />
                        {secondaryAction}
                    </div>
                </PendingFieldset>
            </form>
        );
    }

    if (!schema) {
        return (
            <ReadinessChecklist meta={readiness} itemsHref="#add-item-form" />
        );
    }
    const activeSchema = schema;

    function updateField(name: string, value: FieldValue) {
        setValues((current) => ({ ...current, [name]: value }));
        setClientErrors((current) => {
            if (!current[name]) return current;
            const next = { ...current };
            delete next[name];
            return next;
        });
    }

    function onSubmit(event: React.FormEvent<HTMLFormElement>) {
        const errors = validateLabel(labelJson, activeSchema);
        if (errors.length === 0) return;
        event.preventDefault();
        // Take the user to the first field that needs fixing.
        event.currentTarget
            .querySelector<HTMLElement>(
                `[data-field="${CSS.escape(errors[0].field)}"] :is(input, textarea, button)`,
            )
            ?.focus();
        setClientErrors(
            errors.reduce<Record<string, string[]>>((acc, error) => {
                acc[error.field] = [
                    ...(acc[error.field] ?? []),
                    formatLabelError(error),
                ];
                return acc;
            }, {}),
        );
    }

    return (
        <form
            id={id}
            action={formAction}
            onSubmit={onSubmit}
            onChange={() => setEditedAfter(state)}
        >
            <PendingFieldset className="flex flex-col gap-4">
                <input type="hidden" name="datasetId" value={datasetId} />
                <input
                    type="hidden"
                    name="label"
                    value={JSON.stringify(labelJson)}
                />
                {hiddenFields &&
                    Object.entries(hiddenFields).map(([name, value]) => (
                        <input
                            key={name}
                            type="hidden"
                            name={name}
                            value={value}
                        />
                    ))}
                <FieldErrorIdsProvider ids={childErrorIds}>
                    <Fragment key={fieldsKey}>{children}</Fragment>
                </FieldErrorIdsProvider>
                {state.fieldErrors?.inputText?.[0] && (
                    <p
                        id={`${id ?? "label"}-inputText-error`}
                        role="alert"
                        className="text-copy-14 text-error"
                    >
                        {state.fieldErrors.inputText[0]}
                    </p>
                )}
                {state.fieldErrors?.image?.[0] && (
                    <p
                        id={`${id ?? "label"}-image-error`}
                        role="alert"
                        className="text-copy-14 text-error"
                    >
                        {state.fieldErrors.image[0]}
                    </p>
                )}
                {state.fieldErrors?.audio?.[0] && (
                    <p
                        id={`${id ?? "label"}-audio-error`}
                        role="alert"
                        className="text-copy-14 text-error"
                    >
                        {state.fieldErrors.audio[0]}
                    </p>
                )}

                <div className="flex flex-col gap-4">
                    <div>
                        <p className="text-label-14 text-on-surface">
                            Ground-truth label
                        </p>
                        <p className="text-copy-14 text-muted-foreground">
                            * Required field
                        </p>
                    </div>
                    {activeSchema.fields.map((field) => {
                        const error =
                            clientErrors[field.name]?.[0] ??
                            state.fieldErrors?.[field.name]?.[0];
                        const fieldId = `${id ?? "label"}-${field.name}`;
                        const errorId = `${fieldId}-error`;
                        return (
                            <div
                                key={field.name}
                                data-field={field.name}
                                className="flex flex-col gap-2"
                            >
                                <Label htmlFor={fieldId}>
                                    {field.name}
                                    {field.required && (
                                        <span
                                            aria-hidden="true"
                                            className="text-error"
                                        >
                                            {" "}
                                            *
                                        </span>
                                    )}
                                </Label>
                                <div>
                                    {field.type === "string[]" ? (
                                        <ArrayField
                                            fieldName={field.name}
                                            label={field.name}
                                            values={arrayValue(
                                                values[field.name],
                                            )}
                                            required={field.required}
                                            error={error}
                                            errorId={errorId}
                                            onChange={(next) =>
                                                updateField(field.name, next)
                                            }
                                        />
                                    ) : (
                                        <Input
                                            id={fieldId}
                                            aria-describedby={
                                                error ? errorId : undefined
                                            }
                                            type={
                                                field.type === "number"
                                                    ? "number"
                                                    : "text"
                                            }
                                            inputMode={
                                                field.type === "number"
                                                    ? "decimal"
                                                    : undefined
                                            }
                                            value={stringValue(
                                                values[field.name],
                                            )}
                                            invalid={Boolean(error)}
                                            onChange={(event) =>
                                                updateField(
                                                    field.name,
                                                    event.target.value,
                                                )
                                            }
                                        />
                                    )}
                                </div>
                                {error && (
                                    <p
                                        id={errorId}
                                        role="alert"
                                        className="text-copy-14 text-error"
                                    >
                                        {error}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>

                {state.fieldErrors?.label?.[0] && (
                    <p role="alert" className="text-copy-14 text-error">
                        {state.fieldErrors.label[0]}
                    </p>
                )}
                {state.formError && (
                    <p role="alert" className="text-copy-14 text-error">
                        {state.formError}
                    </p>
                )}
                {resetOnSuccess && (
                    <TransientStatus
                        token={state.ok ? state : undefined}
                        dismissed={editedAfter === state}
                    >
                        Item saved.
                    </TransientStatus>
                )}
                <div className="flex flex-wrap gap-2">
                    <SubmitButton label={submitLabel} />
                    {secondaryAction}
                </div>
            </PendingFieldset>
        </form>
    );
}

function initialValues(
    schema: IParsedSchemaDescriptor | undefined,
    initialLabel: LabelJson | undefined,
): FieldValues {
    if (!schema) return {};
    return schema.fields.reduce<FieldValues>((acc, field) => {
        const value = initialLabel?.[field.name];
        acc[field.name] = initialValueForField(field.type, value);
        return acc;
    }, {});
}

function initialValueForField(
    type: SchemaFieldType,
    value: unknown,
): FieldValue {
    if (type === "string[]") {
        if (
            Array.isArray(value) &&
            value.every((item) => typeof item === "string")
        ) {
            return value.length > 0 ? value : [];
        }
        return [""];
    }
    if (typeof value === "string") return value;
    if (typeof value === "number" && Number.isFinite(value))
        return String(value);
    return "";
}

function buildLabel(
    values: FieldValues,
    schema: IParsedSchemaDescriptor,
): LabelJson {
    const label: LabelJson = {};
    for (const field of schema.fields) {
        const value = values[field.name];
        if (field.type === "string[]") {
            label[field.name] = arrayValue(value).filter(
                (item) => item.trim() !== "",
            );
            continue;
        }
        const text = stringValue(value).trim();
        if (!text) continue;
        if (field.type === "number") {
            const numberValue = Number(text);
            label[field.name] = Number.isFinite(numberValue)
                ? numberValue
                : text;
        } else {
            label[field.name] = stringValue(value);
        }
    }
    return label;
}

function stringValue(value: FieldValue | undefined): string {
    return typeof value === "string" ? value : "";
}

function arrayValue(value: FieldValue | undefined): string[] {
    return Array.isArray(value) ? value : [];
}
