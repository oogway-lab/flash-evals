import { getEvalProvider, type ApiKeys } from "@mosaic/llm-core";
import type {
    ISchemaCompatibilityIssue,
    JsonSchemaObject,
} from "../db/jsonTypes";
import { registryEntryFor } from "../llm/modelRegistry";
import { resolveReasoningEffort } from "../llm/reasoningConfig";
import { isRecord } from "../lib/objects";
import { validatePromptSchema } from "./schemaValidation";
import { parseStrictJsonOnly } from "./validation";

export interface IGenerateSchemaResult {
    schema: JsonSchemaObject;
    openaiCompatible: boolean;
    errors: ISchemaCompatibilityIssue[];
}

const SYSTEM =
    "You design strict JSON Schemas for OpenAI structured outputs. Return only the JSON Schema object — no prose, no Markdown fences.";

function instructions(prompt: string): string {
    return [
        "Produce a JSON Schema describing the JSON object the following prompt asks the model to return.",
        "Requirements (must be OpenAI structured-output compatible):",
        '- The root must be {"type": "object"}.',
        '- Set "additionalProperties": false on every object.',
        '- List every property key in that object\'s "required" array.',
        "- Use only these types: object, array, string, number, integer, boolean.",
        "- Do not use $ref, $defs, a root anyOf, if/then/else, not, or format keywords.",
        '- Add a short "description" to each property where it helps.',
        "",
        "Prompt:",
        prompt,
        "",
        "Return the JSON Schema object only.",
    ].join("\n");
}

// Generate a JSON Schema from prompt text via the optimizer model path, then run
// the result through the same OpenAI-compatibility validation a hand-authored
// schema must pass. The schema is returned even when incompatible so the caller
// can surface the specific issues; it is never silently accepted.
export async function generateSchemaFromPrompt(input: {
    prompt: string;
    targetModelId: string;
    generatorModelId?: string;
    apiKeys: ApiKeys;
}): Promise<IGenerateSchemaResult> {
    const generatorModelId =
        input.generatorModelId ??
        process.env.PROMPT_OPTIMIZER_MODEL ??
        "gpt-5.4-mini";
    const provider = getEvalProvider(input.apiKeys);
    const reasoning = registryEntryFor(generatorModelId)?.reasoning ?? false;

    const result = await provider.complete({
        model: generatorModelId,
        system: SYSTEM,
        prompt: instructions(input.prompt),
        maxTokens: reasoning ? 2000 : 1200,
        reasoningEffort: resolveReasoningEffort(generatorModelId, "low"),
    });

    const parsed = parseStrictJsonOnly(result.text);
    if (!parsed.ok) {
        throw new Error(
            "The schema generator did not return a JSON object. Try again.",
        );
    }

    const schema = normalizeGeneratedSchema(parsed.value);
    const validation = validatePromptSchema(schema);
    return {
        schema,
        openaiCompatible: validation.openaiCompatible,
        errors: validation.errors,
    };
}

function normalizeGeneratedSchema(schema: unknown): JsonSchemaObject {
    return normalizeSchemaNode(schema) as JsonSchemaObject;
}

function normalizeSchemaNode(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(normalizeSchemaNode);
    if (!isRecord(schema)) return schema;

    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
        normalized[key] = normalizeSchemaNode(value);
    }

    const type = normalized.type;
    const isObject =
        type === "object" ||
        (Array.isArray(type) && type.includes("object"));

    if (isObject) {
        normalized.additionalProperties = false;
        if (isRecord(normalized.properties)) {
            normalized.required = Object.keys(normalized.properties);
        }
    }

    return normalized;
}
