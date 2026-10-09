import type {
    IPromptSampleInput,
    IPromptValidationEvidence,
    ISchemaCompatibilityIssue,
    JsonSchemaObject,
} from "../db/jsonTypes";
import type { ReasoningEffort } from "@mosaic/llm-core";
import { errorMessage } from "../lib/errors";
import {
    validateDataAgainstSchema,
    validatePromptSchema,
} from "./schemaValidation";

export interface IPromptValidationSample extends IPromptSampleInput {
    expectedOutput?: unknown;
}

export interface IPromptValidationCallResult {
    text: string;
    latencyMs?: number;
}

export type PromptValidationModelCall = (input: {
    prompt: string;
    sample: IPromptValidationSample;
    schema: JsonSchemaObject;
    targetModelId: string;
    reasoningEffort?: ReasoningEffort;
}) => Promise<IPromptValidationCallResult>;

export async function validatePromptForRunnableVersion(input: {
    prompt: string;
    schema: JsonSchemaObject;
    samples: IPromptValidationSample[];
    targetModelId: string;
    reasoningEffort?: ReasoningEffort;
    callModel: PromptValidationModelCall;
}): Promise<{
    passed: boolean;
    evidence: IPromptValidationEvidence;
}> {
    const staticChecks = staticPromptChecks(input.prompt);
    const schemaValidation = validatePromptSchema(input.schema);
    const sampleResults: IPromptValidationEvidence["sampleResults"] = [];

    if (
        staticChecks.some((check) => check.code === "prompt_conflicting_json") ||
        !schemaValidation.localValid ||
        !schemaValidation.openaiCompatible
    ) {
        return {
            passed: false,
            evidence: { staticChecks, schemaValidation, sampleResults },
        };
    }

    // Samples are optional: a valid, OpenAI-compatible schema is enough to save.
    // When samples ARE provided, every one must pass.
    for (const sample of input.samples) {
        try {
            const result = await input.callModel({
                prompt: input.prompt,
                sample,
                schema: input.schema,
                targetModelId: input.targetModelId,
                reasoningEffort: input.reasoningEffort,
            });
            const parsed = parseStrictJsonOnly(result.text);
            if (!parsed.ok) {
                sampleResults.push({
                    sampleName: sample.name,
                    status: "failed",
                    rawOutput: result.text,
                    errors: [parsed.error],
                });
                continue;
            }

            const schemaResult = validateDataAgainstSchema(
                input.schema,
                parsed.value,
            );
            sampleResults.push({
                sampleName: sample.name,
                status: schemaResult.ok ? "passed" : "failed",
                rawOutput: result.text,
                parsedOutput: parsed.value,
                errors: schemaResult.ok ? [] : schemaResult.errors,
            });
        } catch (err) {
            sampleResults.push({
                sampleName: sample.name,
                status: "provider_error",
                errors: [
                    {
                        path: "$",
                        code: "provider_error",
                        message: errorMessage(err),
                    },
                ],
            });
        }
    }

    // No samples => static + schema checks above already passed, so the prompt
    // is runnable. With samples, every one must have passed.
    return {
        passed: sampleResults.every((sample) => sample.status === "passed"),
        evidence: { staticChecks, schemaValidation, sampleResults },
    };
}

export function staticPromptChecks(prompt: string): ISchemaCompatibilityIssue[] {
    const checks: ISchemaCompatibilityIssue[] = [];
    const normalized = prompt.toLowerCase();
    const positiveOutputInstructions = normalized.replace(
        /\b(do not|don't|never) include markdown\b/g,
        "",
    );

    if (!/\bjson\b/.test(normalized)) {
        checks.push({
            path: "$",
            code: "prompt_missing_json_instruction",
            message: "Prompt should explicitly instruct the model to return JSON.",
        });
    }

    if (
        /\bthen explain\b/.test(positiveOutputInstructions) ||
        /\bexplain (below|after)\b/.test(positiveOutputInstructions) ||
        /\b(use|include|return|respond in|format as) markdown\b/.test(
            positiveOutputInstructions,
        )
    ) {
        checks.push({
            path: "$",
            code: "prompt_conflicting_json",
            message:
                "Prompt asks for prose, Markdown, or explanation outside the JSON output.",
        });
    }

    return checks;
}

export function parseStrictJsonOnly(
    text: string,
):
    | { ok: true; value: unknown }
    | { ok: false; error: ISchemaCompatibilityIssue } {
    const trimmed = text.trim();
    if (!trimmed) {
        return {
            ok: false,
            error: {
                path: "$",
                code: "invalid_json",
                message: "Model returned an empty response instead of JSON.",
            },
        };
    }

    if (/^```/.test(trimmed) || /```$/.test(trimmed)) {
        return {
            ok: false,
            error: {
                path: "$",
                code: "json_wrapper",
                message:
                    "Model returned JSON inside a Markdown code fence; output must be only the JSON object.",
            },
        };
    }

    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                ok: false,
                error: {
                    path: "$",
                    code: "invalid_json_object",
                    message: "Model output must be a JSON object.",
                },
            };
        }
        return { ok: true, value: parsed };
    } catch {
        return {
            ok: false,
            error: {
                path: "$",
                code: "invalid_json",
                message: "Model output was not valid JSON.",
            },
        };
    }
}
