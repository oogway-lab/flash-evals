import {
    getEvalProvider,
    guidanceForModel,
    type ApiKeys,
} from "@mosaic/llm-core";
import type {
    IPromptOptimizerGuidanceSource,
    JsonSchemaObject,
} from "../db/jsonTypes";
import { registryEntryFor } from "../llm/modelRegistry";
import { resolveReasoningEffort } from "../llm/reasoningConfig";
import { validateDataAgainstSchema } from "./schemaValidation";
export { guidanceForModel } from "@mosaic/llm-core";

export interface IPromptOptimizationResult {
    proposedPrompt: string;
    rationale: string;
    fitTags: string[];
    structuredOutputNotes: string[];
    guidanceSource: IPromptOptimizerGuidanceSource;
}

export type PromptOptimizerCall = (input: {
    optimizerModelId: string;
    prompt: string;
    schema: JsonSchemaObject;
    targetModelId: string;
    guidance: string;
}) => Promise<IPromptOptimizationResult>;

const OPTIMIZER_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [
        "proposedPrompt",
        "rationale",
        "fitTags",
        "structuredOutputNotes",
    ],
    properties: {
        proposedPrompt: { type: "string" },
        rationale: { type: "string" },
        fitTags: { type: "array", items: { type: "string" } },
        structuredOutputNotes: { type: "array", items: { type: "string" } },
    },
} satisfies JsonSchemaObject;

export async function optimizePrompt(input: {
    prompt: string;
    schema: JsonSchemaObject;
    targetModelId: string;
    optimizerModelId?: string;
    apiKeys: ApiKeys;
    callOptimizer?: PromptOptimizerCall;
}): Promise<IPromptOptimizationResult> {
    const optimizerModelId =
        input.optimizerModelId ?? process.env.PROMPT_OPTIMIZER_MODEL ?? "gpt-5.4-mini";
    const guidance = guidanceForModel(input.targetModelId);
    if (input.callOptimizer) {
        return input.callOptimizer({
            optimizerModelId,
            prompt: input.prompt,
            schema: input.schema,
            targetModelId: input.targetModelId,
            guidance: guidance.text,
        });
    }

    const provider = getEvalProvider(input.apiKeys);
    const reasoningOptimizer =
        registryEntryFor(optimizerModelId)?.reasoning ?? false;
    const result = await provider.complete({
        model: optimizerModelId,
        system:
            "You optimize prompts for non-technical product managers. Preserve the task intent, remove ambiguity, and make structured JSON output mandatory. Keep every field concise.",
        prompt: [
            guidance.text,
            "",
            `Target model: ${input.targetModelId}`,
            "JSON Schema:",
            JSON.stringify(input.schema, null, 2),
            "",
            "Original prompt:",
            input.prompt,
            "",
            "Return JSON for the optimizer result only.",
            "Constraints:",
            "- proposedPrompt: no more than 180 words.",
            "- proposedPrompt must be model-agnostic. Do not mention GPT-4.1, GPT-5, OpenAI, the target model, or model-specific tuning.",
            "- rationale: one sentence.",
            "- rationale may mention why the proposal fits the target model.",
            "- fitTags: 2 to 4 short tags.",
            "- structuredOutputNotes: 2 short notes.",
            "- Do not include examples unless the original prompt already requires examples.",
        ].join("\n"),
        responseSchema: {
            name: "prompt_optimization",
            schema: OPTIMIZER_OUTPUT_SCHEMA,
        },
        maxTokens: reasoningOptimizer ? 3200 : 1200,
        reasoningEffort: resolveReasoningEffort(optimizerModelId, "low"),
    });

    const parsed = result.parsed;
    const validation = validateDataAgainstSchema(
        OPTIMIZER_OUTPUT_SCHEMA,
        parsed,
    );
    if (!validation.ok) {
        throw new Error("Prompt optimizer response is missing required fields.");
    }
    const record = parsed as {
        proposedPrompt: string;
        rationale: string;
        fitTags: string[];
        structuredOutputNotes: string[];
    };

    return {
        proposedPrompt: record.proposedPrompt,
        rationale: record.rationale,
        fitTags: record.fitTags,
        structuredOutputNotes: record.structuredOutputNotes,
        guidanceSource: guidance.source,
    };
}
