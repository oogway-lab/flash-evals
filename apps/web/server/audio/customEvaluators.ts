import type { EvalImage, ReasoningEffort } from "@mosaic/llm-core";
import { runJudge } from "../scoring/judge";
import { audioReferenceFromLabel } from "./reference";
import type { ApiKeys } from "@mosaic/llm-core";
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
    details: {
        metricKind: "llm_judge";
        modelId: string;
        rubricPrompt: string;
        referenceKind?: string;
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
}): Promise<ITranscriptEvaluatorResult | undefined> {
    if (!input.config?.enabled) return undefined;
    const rubricPrompt = input.config.rubricPrompt.trim();
    if (!input.transcript || !rubricPrompt) return undefined;

    const reference = audioReferenceFromLabel(input.label);
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
    });

    if (!verdict.ok) {
        return {
            score: null,
            rationale: `transcript judge error: ${verdict.error}`,
            details: {
                metricKind: "llm_judge",
                modelId: input.config.modelId,
                rubricPrompt,
                referenceKind: reference?.referenceKind,
                error: verdict.error,
            },
        };
    }

    return {
        score: verdict.score,
        rationale: verdict.rationale,
        details: {
            metricKind: "llm_judge",
            modelId: input.config.modelId,
            rubricPrompt,
            referenceKind: reference?.referenceKind,
            criteria: verdict.criteria,
        },
    };
}
