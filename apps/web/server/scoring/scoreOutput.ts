import { getBareModelName, type ApiKeys, type EvalProviderTransport, type ReasoningEffort } from "@mosaic/llm-core";
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
    inputText?: string;
    hasImage: boolean;
    reference?: unknown;
    apiKeys: ApiKeys;
    maxTokens: number;
    judgePrompt?: IJudgePromptScoringConfig;
}

export interface IScoreOutputResult {
    fieldDiff?: { score: number | null; details: FieldDiffDetails };
    judge?: {
        score: number | null;
        details?: IJudgeDetails;
        rationale?: string;
    };
}

export interface IJudgePromptScoringConfig {
    modelId: string;
    transport?: EvalProviderTransport;
    rubricPrompt: string;
    declaredInputs: JudgeDeclaredInput[];
    reasoningEffort?: ReasoningEffort;
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
    const rules = factualForLabel
        .map(ruleFromConfig)
        .filter((rule): rule is FieldRule => rule !== undefined);

    if (args.label && structured) {
        if (rules.length > 0) {
            const { score, details } = scoreFieldDiff(structured, args.label, rules);
            result.fieldDiff = { score: score ?? null, details };
        } else if (
            Object.keys(args.label).length > 0 &&
            hadScorableFactual
        ) {
            result.fieldDiff = {
                score: null,
                details: { fields: [] },
            };
        }
    }

    // Generative-field judges and run-level judge prompts are mutually exclusive.
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
            },
            judge,
        );
        result.judge = { score: judged.score, details: judged.details };
    } else if (args.judgePrompt) {
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
        });
        result.judge = verdict.ok
            ? { score: verdict.score, rationale: verdict.rationale }
            : { score: null, rationale: `judge error: ${verdict.error}` };
    }

    return result;
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
