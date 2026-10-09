import { createHash } from "crypto";
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020";
import addFormats from "ajv-formats";
import type {
    ISchemaCompatibilityIssue,
    ISchemaValidationResult,
    JsonSchemaObject,
} from "../db/jsonTypes";
import { errorMessage } from "../lib/errors";
import { isRecord, PROTOTYPE_POLLUTION_KEYS } from "../lib/objects";

const OPENAI_UNSUPPORTED_KEYS = new Set([
    "$ref",
    "$defs",
    "definitions",
    "patternProperties",
    "dependencies",
    "dependentSchemas",
    "unevaluatedProperties",
    "unevaluatedItems",
    "contains",
    "minContains",
    "maxContains",
    "propertyNames",
    "if",
    "then",
    "else",
    "not",
]);

const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
});
addFormats(ajv);

export interface ISchemaPathDescriptor {
    path: string;
    type: string;
    required: boolean;
}

export function schemaHash(schema: unknown): string {
    return createHash("sha256")
        .update(stableStringify(schema))
        .digest("hex");
}

export function validatePromptSchema(schema: unknown): ISchemaValidationResult {
    const errors: ISchemaCompatibilityIssue[] = [];

    if (!isRecord(schema)) {
        return {
            localValid: false,
            openaiCompatible: false,
            errors: [
                {
                    path: "$",
                    code: "schema_type",
                    message: "Schema must be a JSON object.",
                },
            ],
        };
    }

    let validator: ValidateFunction | undefined;
    try {
        validator = ajv.compile(schema);
    } catch (err) {
        errors.push({
            path: "$",
            code: "schema_compile",
            message: errorMessage(err),
        });
    }

    const localValid = errors.length === 0 && Boolean(validator);
    errors.push(...openAICompatibilityIssues(schema));

    return {
        localValid,
        openaiCompatible: localValid && errors.length === 0,
        errors,
    };
}

export function validateDataAgainstSchema(
    schema: JsonSchemaObject,
    data: unknown,
): { ok: true } | { ok: false; errors: ISchemaCompatibilityIssue[] } {
    let validator: ValidateFunction;
    try {
        validator = ajv.compile(schema);
    } catch (err) {
        return {
            ok: false,
            errors: [
                {
                    path: "$",
                    code: "schema_compile",
                    message: errorMessage(err),
                },
            ],
        };
    }

    if (validator(data)) return { ok: true };
    return {
        ok: false,
        errors: formatAjvErrors(validator.errors ?? []),
    };
}

export function extractSchemaPaths(schema: unknown): ISchemaPathDescriptor[] {
    if (!isRecord(schema) || !isRecord(schema.properties)) return [];
    const descriptors: ISchemaPathDescriptor[] = [];
    collectSchemaPaths("$", schema, true, descriptors);
    return descriptors.filter((d) => d.path !== "$");
}

function collectSchemaPaths(
    path: string,
    schema: Record<string, unknown>,
    required: boolean,
    descriptors: ISchemaPathDescriptor[],
) {
    const type = formatType(schema.type);
    descriptors.push({ path, type, required });

    if (!isRecord(schema.properties)) return;
    const requiredFields = new Set(
        Array.isArray(schema.required)
            ? schema.required.filter((field): field is string => typeof field === "string")
            : [],
    );

    for (const [field, child] of Object.entries(schema.properties)) {
        if (!isRecord(child)) continue;
        collectSchemaPaths(
            `${path}.${field}`,
            child,
            requiredFields.has(field),
            descriptors,
        );
    }
}

function openAICompatibilityIssues(schema: Record<string, unknown>) {
    const issues: ISchemaCompatibilityIssue[] = [];

    if (schema.type !== "object") {
        issues.push({
            path: "$",
            code: "openai_root_object",
            message: 'OpenAI Structured Outputs require the root schema to have type "object".',
        });
    }
    if (hasOwn(schema, "anyOf")) {
        issues.push({
            path: "$",
            code: "openai_root_anyof",
            message: "OpenAI Structured Outputs do not support a root anyOf schema.",
        });
    }

    visitSchema(schema, "$", issues);
    return issues;
}

function visitSchema(
    schema: Record<string, unknown>,
    path: string,
    issues: ISchemaCompatibilityIssue[],
) {
    for (const key of Object.keys(schema)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
            issues.push({
                path,
                code: "reserved_key",
                message: `Schema key "${key}" is reserved and cannot be used.`,
            });
        }
        if (OPENAI_UNSUPPORTED_KEYS.has(key)) {
            issues.push({
                path,
                code: "openai_unsupported_keyword",
                message: `OpenAI Structured Outputs do not support "${key}" in this schema.`,
            });
        }
    }

    const type = schema.type;
    const isObject =
        type === "object" ||
        (Array.isArray(type) && type.includes("object"));

    if (isObject) {
        if (schema.additionalProperties !== false) {
            issues.push({
                path,
                code: "openai_additional_properties",
                message:
                    "OpenAI Structured Outputs require object schemas to set additionalProperties to false.",
            });
        }
        if (isRecord(schema.properties)) {
            const propertyNames = Object.keys(schema.properties);
            const required = Array.isArray(schema.required)
                ? schema.required.filter((field): field is string => typeof field === "string")
                : [];
            const requiredSet = new Set(required);
            for (const property of propertyNames) {
                if (!requiredSet.has(property)) {
                    issues.push({
                        path: `${path}.${property}`,
                        code: "openai_required_property",
                        message:
                            "OpenAI Structured Outputs require every object property to be listed in required. Use a nullable union to model optional values.",
                    });
                }
            }
        }
    }

    if (isRecord(schema.properties)) {
        for (const [property, value] of Object.entries(schema.properties)) {
            if (PROTOTYPE_POLLUTION_KEYS.has(property)) {
                issues.push({
                    path: `${path}.${property}`,
                    code: "reserved_key",
                    message: `Schema property "${property}" is reserved and cannot be used.`,
                });
            }
            if (isRecord(value)) visitSchema(value, `${path}.${property}`, issues);
        }
    }

    const items = schema.items;
    if (isRecord(items)) visitSchema(items, `${path}[]`, issues);
    if (Array.isArray(items)) {
        items.forEach((item, idx) => {
            if (isRecord(item)) visitSchema(item, `${path}[${idx}]`, issues);
        });
    }
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
        const variants = schema[keyword];
        if (Array.isArray(variants)) {
            variants.forEach((variant, idx) => {
                if (isRecord(variant)) {
                    visitSchema(variant, `${path}.${keyword}[${idx}]`, issues);
                }
            });
        }
    }
}

function formatAjvErrors(errors: ErrorObject[]): ISchemaCompatibilityIssue[] {
    return errors.map((error) => ({
        path: error.instancePath ? `$.${error.instancePath.slice(1).replace(/\//g, ".")}` : "$",
        code: error.keyword,
        message: error.message ?? "Schema validation failed.",
    }));
}

function formatType(type: unknown): string {
    if (typeof type === "string") return type;
    if (Array.isArray(type)) return type.map(String).join(" | ");
    return "unknown";
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(",")}]`;
    }
    if (isRecord(value)) {
        return `{${Object.keys(value)
            .sort()
            .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value);
}
