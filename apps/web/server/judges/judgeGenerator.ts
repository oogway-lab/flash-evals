import { getEvalProvider, type ApiKeys } from "@mosaic/llm-core";
import type { JsonSchemaObject } from "../db/jsonTypes";
import { registryEntryFor } from "../llm/modelRegistry";
import { resolveReasoningEffort } from "../llm/reasoningConfig";

export interface IGenerateJudgeInput {
    /** The eval prompt's task text — what the model under test is asked to do. */
    taskPrompt: string;
    /** The eval prompt's output schema — the structure the model returns. */
    outputSchema: JsonSchemaObject;
    modality: "audio" | "image" | "text";
    /** Whether the dataset carries golden/reference answers the judge can use. */
    hasGolden: boolean;
    generatorModelId?: string;
    apiKeys: ApiKeys;
}

export interface IGenerateJudgeResult {
    rubricPrompt: string;
}

const SYSTEM =
    "You write rubrics for an LLM-as-judge that scores another model's output. " +
    "Return only the rubric text the judge will follow — no JSON, no Markdown fences, no preamble.";

function instructions(input: IGenerateJudgeInput): string {
    const reference = input.hasGolden
        ? "A reference answer is available for each example; the judge may compare the candidate output against it."
        : "No reference answer is available; the judge must score against the criteria themselves, not a known answer.";

    return [
        "Write a concise grading rubric for a judge that scores how well a model's output satisfies the task below.",
        "The rubric must:",
        "- Define a short list of NAMED evaluation criteria (e.g. correctness, completeness, format) derived from the task and the output structure.",
        "- Instruct the judge to score EACH named criterion independently from 0 (worst) to 1 (best), reasoning before scoring, then give a single overall 0-1 score.",
        "- Judge only against the rubric — do not reward longer or more verbose answers, and do not favor any particular model.",
        `- ${reference}`,
        "",
        `The task inputs are ${input.modality} examples.`,
        "",
        "Task prompt (what the model under test is asked to do):",
        input.taskPrompt,
        "",
        "Output structure the model returns (JSON Schema):",
        JSON.stringify(input.outputSchema, null, 2),
        "",
        "Return the rubric text only.",
    ].join("\n");
}

// Draft a judge rubric from the selected eval prompt + dataset context, via the
// same optimizer-model path used for schema generation. The rubric is editable
// downstream; this only produces a strong starting point.
export async function generateJudgeFromContext(
    input: IGenerateJudgeInput,
): Promise<IGenerateJudgeResult> {
    const generatorModelId =
        input.generatorModelId ??
        process.env.PROMPT_OPTIMIZER_MODEL ??
        "gpt-5.4-mini";
    const provider = getEvalProvider(input.apiKeys);
    const reasoning = registryEntryFor(generatorModelId)?.reasoning ?? false;

    const result = await provider.complete({
        model: generatorModelId,
        system: SYSTEM,
        prompt: instructions(input),
        maxTokens: reasoning ? 2000 : 1200,
        reasoningEffort: resolveReasoningEffort(generatorModelId, "low"),
    });

    const rubricPrompt = result.text.trim();
    if (rubricPrompt === "") {
        throw new Error(
            "The judge generator did not return a rubric. Try again.",
        );
    }

    return { rubricPrompt };
}
