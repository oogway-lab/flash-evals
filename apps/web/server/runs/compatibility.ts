import type {
    IPipelineFieldConfig,
    JsonSchemaObject,
} from "../db/jsonTypes";
import { extractSchemaPaths } from "../prompts/schemaValidation";

export interface IPromptDatasetCompatibilityIssue {
    path: string;
    code: "missing_prompt_field" | "unsupported_field_type";
    message: string;
}

export interface IPromptDatasetCompatibilityResult {
    ok: boolean;
    issues: IPromptDatasetCompatibilityIssue[];
}

const SCORABLE_TYPES = new Set([
    "string",
    "number",
    "integer",
    "boolean",
    "array",
    "object",
    "string | null",
    "number | null",
    "integer | null",
    "boolean | null",
]);

export function validatePromptDatasetCompatibility(input: {
    promptSchema: JsonSchemaObject;
    fieldConfigs: IPipelineFieldConfig[];
}): IPromptDatasetCompatibilityResult {
    const promptPaths = new Map(
        extractSchemaPaths(input.promptSchema).map((path) => [path.path, path]),
    );
    const issues: IPromptDatasetCompatibilityIssue[] = [];

    for (const fieldConfig of input.fieldConfigs) {
        const path = normalizeFieldPath(fieldConfig.field);
        const descriptor = promptPaths.get(path);
        if (!descriptor) {
            issues.push({
                path,
                code: "missing_prompt_field",
                message: `Prompt schema does not define the scorable field "${fieldConfig.field}".`,
            });
            continue;
        }
        if (!SCORABLE_TYPES.has(descriptor.type)) {
            issues.push({
                path,
                code: "unsupported_field_type",
                message: `Scorable field "${fieldConfig.field}" has unsupported schema type "${descriptor.type}".`,
            });
        }
    }

    return { ok: issues.length === 0, issues };
}

export function normalizeFieldPath(field: string): string {
    const trimmed = field.trim();
    if (!trimmed) return "$";
    return trimmed.startsWith("$.") ? trimmed : `$.${trimmed}`;
}
