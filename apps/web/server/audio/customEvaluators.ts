import type {
    EvalImage,
    ICompletionDataPolicy,
    ReasoningEffort,
} from "@flash-evals/llm-core";
import { runJudge } from "../scoring/judge";
import { resolvePricingFor } from "../llm/pricing";
import { audioReferenceFromLabel } from "./reference";
import type { ApiKeys } from "@flash-evals/llm-core";
import type { LabelJson } from "../db/jsonTypes";

export interface ITranscriptEvaluatorConfig {
    enabled: boolean;
    modelId: string;
    rubricPrompt: string;
    reasoningEffort?: ReasoningEffort;
}

export interface ITranscriptEvaluatorResult {
    score: number | null;
    rationale: string | null;
    /** What the judge call cost, when known (also on an error reply). */
    costUsd?: number;
    details: {
        metricKind: "llm_judge";
        modelId: string;
        rubricPrompt: string;
        referenceKind?: string;
        costUsd?: number;
        criteria?: Array<{
            name: string;
            reasoning: string;
            score: number;
        }>;
        error?: string;
    };
}

export async function runTranscriptEvaluator(input: {
    config: ITranscriptEvaluatorConfig | undefined;
    transcript: string | undefined;
    images?: EvalImage[];
    label: LabelJson | undefined;
    apiKeys: ApiKeys;
    maxTokens: number;
    /** The run's data rules, applied to the judge call too. */
    dataPolicy?: ICompletionDataPolicy;
}): Promise<ITranscriptEvaluatorResult | undefined> {
    if (!input.config?.enabled) return undefined;
    const rubricPrompt = input.config.rubricPrompt.trim();
    if (!input.transcript || !rubricPrompt) return undefined;

    const reference = audioReferenceFromLabel(input.label);
    const pricing = await resolvePricingFor(
        input.config.modelId,
        input.apiKeys,
    ).catch(() => undefined);
    const verdict = await runJudge({
        judgeModelId: input.config.modelId,
        rubricPrompt,
        apiKeys: input.apiKeys,
        inputText: "Transcribe the supplied audio verbatim.",
        hasImage: Boolean(input.images?.length),
        images: input.images,
        output: input.transcript,
        label: input.label,
        reference: reference
            ? {
                  referenceKind: reference.referenceKind ?? "human_gold",
                  expectedTranscript: reference.expectedTranscript,
                  expectedTranscriptLatin: reference.expectedTranscriptLatin,
                  expectedLanguage: reference.expectedLanguage,
                  expectedSpeakerTurns: reference.expectedSpeakerTurns,
                  domainTerms: reference.domainTerms,
                  expectedNumbers: reference.expectedNumbers,
              }
            : undefined,
        maxTokens: input.maxTokens,
        reasoningEffort: input.config.reasoningEffort,
        ...(input.dataPolicy ? { dataPolicy: input.dataPolicy } : {}),
        ...(pricing ? { pricing } : {}),
    });
    const cost =
        verdict.costUsd !== undefined ? { costUsd: verdict.costUsd } : {};

    if (!verdict.ok) {
        return {
            score: null,
            rationale: `transcript judge error: ${verdict.error}`,
            ...cost,
            details: {
                metricKind: "llm_judge",
                modelId: input.config.modelId,
                rubricPrompt,
                referenceKind: reference?.referenceKind,
                ...cost,
                error: verdict.error,
            },
        };
    }

    return {
        score: verdict.score,
        rationale: verdict.rationale,
        ...cost,
        details: {
            metricKind: "llm_judge",
            modelId: input.config.modelId,
            rubricPrompt,
            referenceKind: reference?.referenceKind,
            ...cost,
            criteria: verdict.criteria,
        },
    };
}
