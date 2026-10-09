import { getBareModelName, type ApiKeys } from "@mosaic/llm-core";
import { runJudge, type JudgeInput, type JudgeOutcome } from "./judge";
import { isRecord } from "../lib/objects";
import { mapPool } from "../lib/concurrency";
import type {
    IGenerativeFieldResult,
    IPipelineFieldConfig,
    IJudgeDetails,
    JudgeDeclaredInput,
    LabelJson,
    OutputJson,
} from "../db/jsonTypes";
import type { ReasoningEffort } from "@mosaic/llm-core";

export type JudgeFn = (input: JudgeInput) => Promise<JudgeOutcome>;

type IGenerativeFieldConfig = Extract<
    IPipelineFieldConfig,
    { kind: "generative" }
>;

export interface IJudgeFieldsArgs {
    generative: IPipelineFieldConfig[];
    output: OutputJson | null;
    label?: LabelJson;
    inputText?: string;
    hasImage: boolean;
    reference?: unknown;
    apiKeys: ApiKeys;
    maxTokens: number;
    declaredInputs?: JudgeDeclaredInput[];
    reasoningEffort?: ReasoningEffort;
}

export interface IJudgeFieldsResult {
    score: number | null;
    details: IJudgeDetails;
}

const JUDGE_FIELD_CONCURRENCY = 4;
const JUDGE_MAX_TOKENS = 800;

export async function judgeFields(
    args: IJudgeFieldsArgs,
    judge: JudgeFn = runJudge,
): Promise<IJudgeFieldsResult> {
    const generative = args.generative.filter(
        (c): c is IGenerativeFieldConfig => c.kind === "generative",
    );

    const fields = await mapPool(
        generative,
        JUDGE_FIELD_CONCURRENCY,
        async (config): Promise<IGenerativeFieldResult> => {
            const value = isRecord(args.output)
                ? args.output[config.field]
                : undefined;

            const verdict = await judge({
                judgeModelId: getBareModelName(config.modelId),
                rubricPrompt: `Evaluate only the "${config.field}" field.\n\n${config.rubric}`,
                apiKeys: args.apiKeys,
                inputText: args.inputText,
                hasImage: args.hasImage,
                output: value,
                label: args.label ? args.label[config.field] : undefined,
                reference: args.reference,
                maxTokens: Math.min(args.maxTokens, JUDGE_MAX_TOKENS),
                declaredInputs: args.declaredInputs,
                reasoningEffort: args.reasoningEffort,
            });

            return {
                field: config.field,
                score: verdict.ok ? verdict.score : null,
                rationale: verdict.ok
                    ? verdict.rationale
                    : `judge error: ${verdict.error}`,
            };
        },
    );

    const scored = fields.filter(
        (f): f is IGenerativeFieldResult & { score: number } => f.score !== null,
    );
    const score = scored.length
        ? scored.reduce((sum, f) => sum + f.score, 0) / scored.length
        : null;
    const errorCount = fields.length - scored.length;

    return { score, details: { fields, errorCount } };
}
