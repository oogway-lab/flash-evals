import {
    getEvalProvider,
    type ApiKeys,
    type EvalImage,
    type EvalProviderTransport,
    type CompletionResult,
    type CompletionRequest,
    type ReasoningEffort,
} from "@mosaic/llm-core";
import type { IJudgeCriterion, JudgeDeclaredInput } from "../db/jsonTypes";
import { WORKFLOW_JUDGE_SCHEMA_NAME } from "@mosaic/api-contract";
import { errorMessage } from "../lib/errors";

// The criteria breakdown makes the verdict far longer than a bare score —
// a reasoning block per criterion. Give the judge its own generous output
// budget (a floor, never the candidate model's small maxTokens), or long
// rubrics truncate mid-JSON and fail to parse. Output is billed on actual
// tokens, so a high cap costs nothing extra; it only prevents truncation.
const JUDGE_MIN_OUTPUT_TOKENS = 4000;

export type JudgeWinner = "candidate" | "golden" | "tie" | "not_applicable";

// criteria (each reasoning-before-score) precede the overall score so the model
// reasons through the rubric before committing. The overall score is
// model-emitted, not an average of the criteria.
export const JUDGE_RESPONSE_SCHEMA = {
    name: WORKFLOW_JUDGE_SCHEMA_NAME,
    schema: {
        type: "object",
        additionalProperties: false,
        required: ["criteria", "score", "winner"],
        properties: {
            criteria: {
                type: "array",
                description:
                    "One entry per rubric criterion, scored independently.",
                items: {
                    type: "object",
                    additionalProperties: false,
                    required: ["name", "reasoning", "score"],
                    properties: {
                        name: {
                            type: "string",
                            description:
                                "Short criterion name (e.g. correctness).",
                        },
                        reasoning: {
                            type: "string",
                            description: "Why this criterion got its score.",
                        },
                        score: {
                            type: "number",
                            description:
                                "0 (worst) to 1 (best) for this criterion.",
                        },
                    },
                },
            },
            score: {
                type: "number",
                description:
                    "Overall quality from 0 (worst) to 1 (best), considering all criteria.",
            },
            winner: {
                type: "string",
                enum: ["candidate", "golden", "tie", "not_applicable"],
                description:
                    "When a ground-truth label or reference is present, identify whether the candidate or golden answer is better, or whether they tie. Use not_applicable only when no comparison answer is provided.",
            },
        },
    },
};

function parseCriteria(value: unknown): IJudgeCriterion[] {
    if (!Array.isArray(value)) return [];
    const criteria: IJudgeCriterion[] = [];
    for (const raw of value) {
        if (typeof raw !== "object" || raw === null) continue;
        const c = raw as Record<string, unknown>;
        const score = Number(c.score);
        if (Number.isNaN(score)) continue;
        criteria.push({
            name: typeof c.name === "string" ? c.name : "criterion",
            reasoning: typeof c.reasoning === "string" ? c.reasoning : "",
            score: Math.min(1, Math.max(0, score)),
        });
    }
    return criteria;
}

function summarizeCriteria(
    criteria: IJudgeCriterion[],
    winner: JudgeWinner,
): string {
    const rationale = criteria
        .map((c) => `${c.name}: ${c.reasoning}`.trim())
        .filter(Boolean)
        .join("\n");
    return `Winner: ${winner}${rationale ? `\n${rationale}` : ""}`;
}

export interface JudgeInput {
    judgeModelId: string;
    rubricPrompt: string;
    apiKeys: ApiKeys;
    inputText?: string;
    hasImage: boolean;
    images?: EvalImage[];
    output: unknown;
    label?: unknown;
    reference?: unknown;
    maxTokens?: number;
    declaredInputs?: JudgeDeclaredInput[];
    reasoningEffort?: ReasoningEffort;
    transport?: EvalProviderTransport;
}

export type JudgeOutcome =
    | {
          ok: true;
          score: number;
          rationale: string;
          criteria: IJudgeCriterion[];
          winner: JudgeWinner;
      }
    | { ok: false; error: string };

export async function runJudge(input: JudgeInput): Promise<JudgeOutcome> {
    const provider = getEvalProvider(
        input.apiKeys,
        input.transport ? { transport: input.transport } : {},
    );

    try {
        const result = await provider.complete({
            model: input.judgeModelId,
            ...judgeCompletionRequest(input),
        });
        return judgeOutcomeFromCompletion(result);
    } catch (err) {
        return {
            ok: false,
            error: errorMessage(err),
        };
    }
}

export function judgeCompletionRequest(
    input: JudgeInput,
): Omit<CompletionRequest, "model"> {
    const sections: string[] = [input.rubricPrompt, ""];
    const declared = input.declaredInputs
        ? new Set(input.declaredInputs)
        : undefined;
    const include = (section: JudgeDeclaredInput) =>
        declared === undefined || declared.has(section);

    if (include("task_input")) {
        if (input.inputText)
            sections.push(`# Input\n<input>\n${input.inputText}\n</input>`);
        if (input.hasImage) sections.push(`# Input\n(an image was provided)`);
    }
    if (include("candidate_output")) {
        sections.push(
            `# Model output\n<candidate_output>\n${formatJudgeSectionValue(input.output)}\n</candidate_output>`,
        );
    }
    if (declared === undefined && input.label !== undefined)
        sections.push(
            `# Ground-truth label\n<label>\n${JSON.stringify(input.label, null, 2)}\n</label>`,
        );
    if (include("reference") && input.reference !== undefined)
        sections.push(
            `# gpt-4o reference output\n<reference>\n${formatJudgeSectionValue(input.reference)}\n</reference>`,
        );

    return {
        system:
            "You are a strict evaluator. Score each rubric criterion independently " +
            "(reason first, then a 0-1 score), then give an overall 0-1 score. " +
            "When a ground-truth label or reference is supplied, set winner to candidate, golden, or tie. " +
            "Set winner to not_applicable only when no comparison answer is supplied. " +
            "Judge only against the rubric: do not reward longer or more verbose answers, " +
            "and do not favor any particular model. Return JSON.",
        prompt: sections.join("\n\n"),
        images: input.images,
        responseSchema: JUDGE_RESPONSE_SCHEMA,
        maxTokens: Math.max(input.maxTokens ?? 0, JUDGE_MIN_OUTPUT_TOKENS),
        reasoningEffort: input.reasoningEffort,
    };
}

export function judgeOutcomeFromCompletion(
    result: Pick<CompletionResult, "schemaViolation" | "parsed">,
): JudgeOutcome {
    if (result.schemaViolation || result.parsed === undefined) {
        return {
            ok: false,
            error: "Judge returned unparseable or truncated output",
        };
    }
    const parsed = result.parsed as {
        score?: unknown;
        criteria?: unknown;
        winner?: unknown;
    };
    const score = Number(parsed.score);
    if (Number.isNaN(score)) {
        return { ok: false, error: "Judge score was not a number" };
    }
    if (
        parsed.winner !== "candidate" &&
        parsed.winner !== "golden" &&
        parsed.winner !== "tie" &&
        parsed.winner !== "not_applicable"
    ) {
        return { ok: false, error: "Judge winner was invalid or missing" };
    }
    const criteria = parseCriteria(parsed.criteria);
    return {
        ok: true,
        score: Math.min(1, Math.max(0, score)),
        rationale: summarizeCriteria(criteria, parsed.winner),
        criteria,
        winner: parsed.winner,
    };
}

function formatJudgeSectionValue(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}
