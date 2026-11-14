import {
    getBareModelName,
    type ApiKeys,
    type ICostPricing,
    type EvalProviderTransport,
    type ReasoningEffort,
    type ICompletionDataPolicy,
} from "@flash-evals/llm-core";
import { scoreFieldDiff } from "./fieldDiff";
import { judgeFields, type JudgeFn } from "./judgeFields";
import { runJudge } from "./judge";
import { isRecord } from "../lib/objects";
import {
    filterFieldConfigsForGoldenLabel,
    ruleFromConfig,
    splitPipelineFields,
} from "../pipelines/service";
import { inferFieldSetFromLabels } from "../datasets/schemaForm";
import type {
    FieldDiffDetails,
    FieldRule,
    IPipelineFieldConfig,
    IJudgeDetails,
    JudgeDeclaredInput,
    LabelJson,
    OutputJson,
} from "../db/jsonTypes";

export interface IScoreOutputArgs {
    output: OutputJson | null;
    label?: LabelJson;
    fieldConfigs: IPipelineFieldConfig[];
    /** Opt in to schema-free answer matching; transcript runs use their own metrics. */
    defaultFieldMatcher?: "exact";
    inputText?: string;
    hasImage: boolean;
    reference?: unknown;
    apiKeys: ApiKeys;
    maxTokens: number;
    judgePrompt?: IJudgePromptScoringConfig;
    /** The run's data rules, applied to judge calls too. */
    dataPolicy?: ICompletionDataPolicy;
    /** Prices for generative-field judge models, to record their cost. */
    fieldJudgePricingFor?: (
        modelId: string,
    ) => Promise<ICostPricing | undefined>;
}

export interface IScoreOutputResult {
    fieldDiff?: { score: number | null; details: FieldDiffDetails };
    judge?: {
        score: number | null;
        details?: IJudgeDetails;
        rationale?: string;
        /** What the judge calls cost, when known. */
        costUsd?: number;
    };
}

export interface IJudgePromptScoringConfig {
    modelId: string;
    transport?: EvalProviderTransport;
    rubricPrompt: string;
    declaredInputs: JudgeDeclaredInput[];
    reasoningEffort?: ReasoningEffort;
    /** The judge model's prices, so the call's cost can be recorded. */
    pricing?: ICostPricing;
}

export async function scoreOutput(
    args: IScoreOutputArgs,
    judge?: JudgeFn,
): Promise<IScoreOutputResult> {
    const { factual, generative } = splitPipelineFields(args.fieldConfigs);
    const structured = isRecord(args.output) ? args.output : undefined;
    const result: IScoreOutputResult = {};

    const hadScorableFactual = factual.some(
        (c) => c.kind === "factual" && c.spec,
    );
    const factualForLabel = args.label
        ? filterFieldConfigsForGoldenLabel(
              factual,
              inferNestedFieldSet(args.label),
          )
        : factual;
    const rules: FieldRule[] = factualForLabel
        .map(ruleFromConfig)
        .filter((rule): rule is FieldRule => rule !== undefined);

    // Schema-free golden datasets need no judge or hand-authored matchers.
    // Explicit field configurations keep their existing scoring semantics.
    if (
        args.defaultFieldMatcher &&
        args.fieldConfigs.length === 0 &&
        args.label
    ) {
        rules.push(
            ...Object.keys(args.label).map((field): FieldRule => ({
                field,
                matcher: "exact",
            })),
        );
    }

    if (args.label && structured) {
        if (rules.length > 0) {
            const { score, details } = scoreFieldDiff(
                structured,
                args.label,
                rules,
            );
            result.fieldDiff = { score: score ?? null, details };
        } else if (Object.keys(args.label).length > 0 && hadScorableFactual) {
            result.fieldDiff = {
                score: null,
                details: { fields: [] },
            };
        }
    }

    const judged = await judgeOutput(args, generative, judge);
    if (judged) result.judge = judged;

    return result;
}

/** Generative-field judges and run-level judge prompts are mutually exclusive. */
async function judgeOutput(
    args: IScoreOutputArgs,
    generative: IPipelineFieldConfig[],
    judge: JudgeFn | undefined,
): Promise<IScoreOutputResult["judge"]> {
    if (generative.length > 0) {
        const judged = await judgeFields(
            {
                generative,
                output: args.output,
                label: args.label,
                inputText: args.inputText,
                hasImage: args.hasImage,
                reference: args.reference,
                apiKeys: args.apiKeys,
                maxTokens: args.maxTokens,
                ...(args.dataPolicy ? { dataPolicy: args.dataPolicy } : {}),
                ...(args.fieldJudgePricingFor
                    ? { pricingFor: args.fieldJudgePricingFor }
                    : {}),
            },
            judge,
        );
        return {
            score: judged.score,
            details: judged.details,
            ...(judged.costUsd !== undefined
                ? { costUsd: judged.costUsd }
                : {}),
        };
    }
    if (args.judgePrompt) {
        const verdict = await (judge ?? runJudge)({
            judgeModelId: getBareModelName(args.judgePrompt.modelId),
            rubricPrompt: args.judgePrompt.rubricPrompt,
            apiKeys: args.apiKeys,
            inputText: args.inputText,
            hasImage: args.hasImage,
            output: args.output,
            reference: args.reference,
            maxTokens: args.maxTokens,
            declaredInputs: args.judgePrompt.declaredInputs,
            reasoningEffort: args.judgePrompt.reasoningEffort,
            transport: args.judgePrompt.transport,
            ...(args.dataPolicy ? { dataPolicy: args.dataPolicy } : {}),
            ...(args.judgePrompt.pricing
                ? { pricing: args.judgePrompt.pricing }
                : {}),
        });
        const cost =
            verdict.costUsd !== undefined ? { costUsd: verdict.costUsd } : {};
        return verdict.ok
            ? { score: verdict.score, rationale: verdict.rationale, ...cost }
            : {
                  score: null,
                  rationale: `judge error: ${verdict.error}`,
                  ...cost,
              };
    }
    return undefined;
}

function inferNestedFieldSet(label: LabelJson): Set<string> {
    const fields = inferFieldSetFromLabels([label]);
    collectNestedFields(label, "$", fields);
    return fields;
}

function collectNestedFields(
    value: unknown,
    path: string,
    fields: Set<string>,
) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    for (const [key, child] of Object.entries(value)) {
        const childPath = path === "$" ? `$.${key}` : `${path}.${key}`;
        fields.add(childPath);
        collectNestedFields(child, childPath, fields);
    }
}
