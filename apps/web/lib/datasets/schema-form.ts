import type {
    IJsonSchemaObject,
    IParsedSchemaDescriptor,
    ISchemaFieldDescriptor,
    LabelJson,
    SchemaFieldType,
} from "@mosaic/api-contract";
import { isRecord } from "@/lib/objects";

export type SchemaParseResult =
    | { ok: true; schema: IParsedSchemaDescriptor }
    | { ok: false; error: string };

export type LabelFieldErrorCode = "required" | "unknown" | "type" | "reserved";

export interface ILabelFieldError {
    field: string;
    code: LabelFieldErrorCode;
    expected?: SchemaFieldType;
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
    "$ref",
    "allOf",
    "anyOf",
    "const",
    "enum",
    "exclusiveMaximum",
    "exclusiveMinimum",
    "format",
    "maximum",
    "maxItems",
    "maxLength",
    "minimum",
    "minItems",
    "minLength",
    "multipleOf",
    "not",
    "oneOf",
    "pattern",
    "uniqueItems",
]);

const PROTOTYPE_POLLUTION_KEYS = new Set([
    "__proto__",
    "constructor",
    "prototype",
]);

function unsupportedKeyIn(value: Record<string, unknown>): string | undefined {
    return Object.keys(value).find((key) => UNSUPPORTED_SCHEMA_KEYS.has(key));
}

function parseFieldType(
    fieldName: string,
    rawSchema: unknown,
): { ok: true; type: SchemaFieldType } | { ok: false; error: string } {
    if (!isRecord(rawSchema)) {
        return {
            ok: false,
            error: `Schema field "${fieldName}" must be an object.`,
        };
    }

    const unsupported = unsupportedKeyIn(rawSchema);
    if (unsupported) {
        return {
            ok: false,
            error: `Schema field "${fieldName}" uses unsupported keyword "${unsupported}".`,
        };
    }

    const rawType = rawSchema.type;
    if (Array.isArray(rawType)) {
        return {
            ok: false,
            error: `Schema field "${fieldName}" uses a type union, which is not supported.`,
        };
    }

    if (rawType === "string" || rawType === "number") {
        return { ok: true, type: rawType };
    }

    if (rawType === "array") {
        const items = rawSchema.items;
        if (!isRecord(items)) {
            return {
                ok: false,
                error: `Schema field "${fieldName}" must define string array items.`,
            };
        }

        const itemUnsupported = unsupportedKeyIn(items);
        if (itemUnsupported) {
            return {
                ok: false,
                error: `Schema field "${fieldName}" items use unsupported keyword "${itemUnsupported}".`,
            };
        }

        if (Array.isArray(items.type) || items.type !== "string") {
            return {
                ok: false,
                error: `Schema field "${fieldName}" must be an array of strings.`,
            };
        }

        return { ok: true, type: "string[]" };
    }

    if (rawType === "object") {
        return {
            ok: false,
            error: `Schema field "${fieldName}" is nested; only flat fields are supported.`,
        };
    }

    return {
        ok: false,
        error: `Schema field "${fieldName}" has unsupported type "${String(rawType)}".`,
    };
}

export function parseSchema(schema: unknown): SchemaParseResult {
    if (!isRecord(schema)) {
        return { ok: false, error: "Schema must be an object." };
    }

    const root = schema as IJsonSchemaObject;
    const unsupported = unsupportedKeyIn(root);
    if (unsupported) {
        return {
            ok: false,
            error: `Schema uses unsupported keyword "${unsupported}".`,
        };
    }

    if (root.type !== "object") {
        return { ok: false, error: 'Schema must have type "object".' };
    }

    if (
        root.additionalProperties !== undefined &&
        typeof root.additionalProperties !== "boolean"
    ) {
        return {
            ok: false,
            error: "Schema additionalProperties must be true, false, or omitted.",
        };
    }

    if (
        !isRecord(root.properties) ||
        Object.keys(root.properties).length === 0
    ) {
        return {
            ok: false,
            error: "Schema must define at least one supported property.",
        };
    }

    if (
        root.required !== undefined &&
        (!Array.isArray(root.required) ||
            !root.required.every((field) => typeof field === "string"))
    ) {
        return {
            ok: false,
            error: "Schema required must be an array of field names.",
        };
    }

    const required = new Set((root.required as string[] | undefined) ?? []);
    const propertyNames = Object.keys(root.properties);
    const descriptors: ISchemaFieldDescriptor[] = [];

    for (const name of propertyNames) {
        if (PROTOTYPE_POLLUTION_KEYS.has(name)) {
            return {
                ok: false,
                error: `Schema field "${name}" is not allowed.`,
            };
        }

        const fieldType = parseFieldType(name, root.properties[name]);
        if (!fieldType.ok) return fieldType;

        descriptors.push({
            name,
            type: fieldType.type,
            required: required.has(name),
        });
    }

    for (const name of required) {
        if (!propertyNames.includes(name)) {
            return {
                ok: false,
                error: `Required field "${name}" is not defined in properties.`,
            };
        }
    }

    return {
        ok: true,
        schema: {
            fields: descriptors,
            additionalProperties: root.additionalProperties ?? true,
        },
    };
}

export function validateLabel(
    label: LabelJson,
    schema: IParsedSchemaDescriptor,
): ILabelFieldError[] {
    const errors: ILabelFieldError[] = [];
    const fieldByName = new Map(
        schema.fields.map((field) => [field.name, field]),
    );

    for (const key of Object.keys(label)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
            errors.push({ field: key, code: "reserved" });
        }
    }

    for (const field of schema.fields) {
        if (
            field.required &&
            (!hasOwn(label, field.name) || label[field.name] === undefined)
        ) {
            errors.push({ field: field.name, code: "required" });
            continue;
        }

        if (hasOwn(label, field.name) && label[field.name] !== undefined) {
            const value = label[field.name];
            if (!matchesType(value, field.type)) {
                errors.push({
                    field: field.name,
                    code: "type",
                    expected: field.type,
                });
            }
        }
    }

    if (!schema.additionalProperties) {
        for (const key of Object.keys(label)) {
            if (!fieldByName.has(key)) {
                errors.push({ field: key, code: "unknown" });
            }
        }
    }

    return errors;
}

export function formatLabelError(error: ILabelFieldError): string {
    switch (error.code) {
        case "required":
            return `${error.field} is required.`;
        case "unknown":
            return `${error.field} is not defined in the dataset schema.`;
        case "reserved":
            return `${error.field} is a reserved key and cannot be used.`;
        case "type":
            return `${error.field} must be ${formatFieldType(error.expected)}.`;
    }
}

function matchesType(value: unknown, type: SchemaFieldType): boolean {
    switch (type) {
        case "string":
            return typeof value === "string";
        case "number":
            return typeof value === "number" && Number.isFinite(value);
        case "string[]":
            return (
                Array.isArray(value) &&
                value.every((item) => typeof item === "string")
            );
    }
}

function hasOwn(value: LabelJson, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

export function parseGoldenLabel(
    raw: string,
): { ok: true; label: LabelJson } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { ok: false, error: "Golden answer must be a JSON object." };
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!isRecord(parsed)) {
            return { ok: false, error: "Golden answer must be a JSON object." };
        }
        return { ok: true, label: parsed };
    } catch {
        return { ok: false, error: "Invalid JSON in golden answer." };
    }
}

export function inferFieldSetFromLabels(labels: LabelJson[]): Set<string> {
    const keys = new Set<string>();
    for (const label of labels) {
        for (const key of Object.keys(label)) {
            keys.add(key);
        }
    }
    return keys;
}

function formatFieldType(type: SchemaFieldType | undefined): string {
    switch (type) {
        case "string":
            return "text";
        case "number":
            return "a number";
        case "string[]":
            return "a list of text values";
        default:
            return "the expected type";
    }
}
