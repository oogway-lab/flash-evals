import {
    proposeTaskMapFromSchema,
    validateTaskMap,
    type IBenchmarkTask,
    type IJsonSchemaObject,
    type IProposeBenchmarkTaskMapRequest,
    type IProposeBenchmarkTaskMapResponse,
    type ITaskMap,
} from "@flash-evals/api-contract";
import { rulePatternEngineErrors } from "@flash-evals/api-contract/rule-patterns";
import type { IApiConfig } from "../../config.js";
import type { IDb } from "../../db.js";
import { ApiBadRequestError } from "../../errors.js";
import { registryModelFor } from "../../modelRegistry.js";
import { resolveReasoningEffort } from "./creation.js";
import { evalProvider, loadRunnablePromptContext } from "./promptContext.js";

const SYSTEM =
    "You split a prompt's structured output into the separate jobs it does, so each job can be " +
    "scored on its own when a cheaper model is compared with the model used today. Return JSON.";

// Strict structured output: every field is required, so optional ones are
// nullable and dropped afterwards.
export const TASK_MAP_RESPONSE_SCHEMA = {
    name: "benchmark_task_map",
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["tasks"],
        properties: {
            tasks: {
                type: "array",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: [
                        "key",
                        "name",
                        "description",
                        "method",
                        "fields",
                        "judgeDisagreements",
                        "rubric",
                        "why",
                    ],
                    properties: {
                        key: { type: "string" },
                        name: { type: "string" },
                        description: { type: "string" },
                        method: {
                            type: "string",
                            enum: ["agreement", "head_to_head"],
                        },
                        fields: {
                            type: "array",
                            items: {
                                type: "object",
                                additionalProperties: false,
                                required: ["path", "matcher"],
                                properties: {
                                    path: { type: "string" },
                                    matcher: {
                                        type: "string",
                                        enum: [
                                            "exact",
                                            "numeric_tolerance",
                                            "set_overlap",
                                        ],
                                    },
                                },
                            },
                        },
                        judgeDisagreements: { type: "boolean" },
                        rubric: { type: ["string", "null"] },
                        why: { type: "string" },
                    },
                },
            },
        },
    },
};

interface IDraftTask {
    key: string;
    name: string;
    description: string;
    method: "agreement" | "head_to_head";
    fields: Array<{
        path: string;
        matcher: "exact" | "numeric_tolerance" | "set_overlap";
    }>;
    judgeDisagreements: boolean;
    rubric: string | null;
    why: string;
}

/**
 * Ask a model to read the prompt and propose a Task Map. A draft that fails
 * validation falls back to the schema-based proposal, with the problems
 * listed, so the caller always gets something to review.
 */
export async function proposeBenchmarkTaskMapPayload(
    db: IDb,
    config: IApiConfig,
    input: IProposeBenchmarkTaskMapRequest,
): Promise<IProposeBenchmarkTaskMapResponse> {
    const context = await loadRunnablePromptContext(db, input);
    const schema = context.outputSchema as IJsonSchemaObject;
    const modelId =
        input.generatorModelId ??
        process.env.PROMPT_OPTIMIZER_MODEL ??
        "gpt-6-luna";
    const provider = await evalProvider(db, config, input.teamId);
    const reasoning = registryModelFor(modelId)?.reasoning ?? false;
    const result = await provider.complete({
        model: modelId,
        system: SYSTEM,
        prompt: instructions(context.content, schema),
        responseSchema: TASK_MAP_RESPONSE_SCHEMA,
        maxTokens: reasoning ? 8000 : 4000,
        reasoningEffort: resolveReasoningEffort(modelId, "low"),
    });
    const tasks = (result.parsed as { tasks?: IDraftTask[] } | undefined)
        ?.tasks;
    if (result.schemaViolation || !Array.isArray(tasks))
        throw new ApiBadRequestError(
            "The model did not return a task map. Try again or use the schema-based proposal.",
        );
    return fromDraft(tasks, schema);
}

export function fromDraft(
    tasks: IDraftTask[],
    schema: IJsonSchemaObject,
): IProposeBenchmarkTaskMapResponse {
    const taskMap: ITaskMap = { tasks: tasks.map(toTask) };
    const rejected = [
        ...validateTaskMap(taskMap, schema),
        ...rulePatternEngineErrors(taskMap),
    ];
    if (rejected.length > 0)
        return {
            taskMap: proposeTaskMapFromSchema(schema),
            source: "schema",
            notes: [],
            rejected,
        };
    return {
        taskMap,
        source: "model",
        notes: tasks.map((task) => `${task.name}: ${task.why}`),
        rejected: [],
    };
}

function toTask(draft: IDraftTask): IBenchmarkTask {
    const base = {
        key: draft.key,
        name: draft.name,
        ...(draft.description.trim()
            ? { description: draft.description.trim() }
            : {}),
    };
    if (draft.method === "head_to_head")
        return {
            ...base,
            method: "head_to_head",
            paths: draft.fields.map((field) => field.path),
            ...(draft.rubric?.trim() ? { rubric: draft.rubric.trim() } : {}),
        };
    return {
        ...base,
        method: "agreement",
        fields: draft.fields.map((field) =>
            field.matcher === "numeric_tolerance"
                ? {
                      path: field.path,
                      matcher: "numeric_tolerance",
                      tolerance: 0.05,
                      relative: true,
                  }
                : { path: field.path, matcher: field.matcher },
        ),
        ...(draft.judgeDisagreements ? { judgeDisagreements: true } : {}),
    };
}

function instructions(prompt: string, schema: IJsonSchemaObject): string {
    return [
        "A team runs the prompt below on an expensive model and wants to know whether a cheaper model can do the same jobs. Split the prompt's output into tasks: the separate jobs the prompt asks for. Each task is scored on its own by comparing the cheaper model's output with the expensive model's output for the same input.",
        "",
        "Rules:",
        "- Each task owns one or more output fields, given as JSON paths like $.competitors or $.call.summary. A field belongs to at most one task. Only use paths that exist in the output schema.",
        "- Group fields that serve the same job (for example a label and its confidence) into one task.",
        '- Use method "agreement" for fields with a checkable answer: lists of names or items ("set_overlap"), categories, booleans and IDs ("exact"), and numbers ("numeric_tolerance").',
        '- Use method "head_to_head" for free text such as summaries or explanations, where a judge compares the two answers; give a short rubric saying what makes one answer better.',
        "- Set judgeDisagreements to true for agreement tasks where the expensive model can also be wrong, such as extracted names, so a judge decides who is right when they differ. Set it to false for simple labels.",
        "- key: lowercase letters, digits, _ or -. name: a short human label. description: what the job is, in one sentence. why: one sentence on why it is scored this way.",
        "- Skip fields that are pure bookkeeping (echoed IDs, timestamps) unless the prompt treats them as a job.",
        "",
        "Prompt:",
        prompt,
        "",
        "Output schema (JSON Schema):",
        JSON.stringify(schema, null, 2),
    ].join("\n");
}
