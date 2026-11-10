import { getBareModelName, type ApiKeys } from "@flash-evals/llm-core";
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
import type {
    ICompletionDataPolicy,
    ICostPricing,
    ReasoningEffort,
} from "@flash-evals/llm-core";

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
    /** The run's data rules, applied to each judge call. */
    dataPolicy?: ICompletionDataPolicy;
    /** Prices for a field's judge model, so each call's cost is recorded. */
    pricingFor?: (modelId: string) => Promise<ICostPricing | undefined>;
}

export interface IJudgeFieldsResult {
    score: number | null;
    details: IJudgeDetails;
    /** What the field judges cost together, when any cost was known. */
    costUsd?: number;
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

    const costs: number[] = [];
    const fields = await mapPool(
        generative,
        JUDGE_FIELD_CONCURRENCY,
        async (config): Promise<IGenerativeFieldResult> => {
            const pricing = await args.pricingFor?.(config.modelId);
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
                ...(args.dataPolicy ? { dataPolicy: args.dataPolicy } : {}),
                ...(pricing ? { pricing } : {}),
            });
            if (verdict.costUsd !== undefined) costs.push(verdict.costUsd);

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
        (f): f is IGenerativeFieldResult & { score: number } =>
            f.score !== null,
    );
    const score = scored.length
        ? scored.reduce((sum, f) => sum + f.score, 0) / scored.length
        : null;
    const errorCount = fields.length - scored.length;

    return {
        score,
        details: { fields, errorCount },
        ...(costs.length > 0
            ? { costUsd: costs.reduce((total, cost) => total + cost, 0) }
            : {}),
    };
}
