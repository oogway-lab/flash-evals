import { describe, expect, it } from "vitest";
import {
    formatTranscriptReferenceKind,
    toJudgeCriteria,
    toTranscriptJudgeMetricDetails,
    toTranscriptMetricDetails,
} from "./types";

describe("toJudgeCriteria", () => {
    it("parses a well-formed criteria breakdown", () => {
        const out = toJudgeCriteria({
            criteria: [
                { name: "correctness", score: 0.9, reasoning: "right" },
                { name: "format", score: 1, reasoning: "valid json" },
            ],
        });
        expect(out).toHaveLength(2);
        expect(out?.[0]).toEqual({
            name: "correctness",
            score: 0.9,
            reasoning: "right",
        });
    });

    it("returns undefined for legacy/empty/malformed details (drawer falls back)", () => {
        expect(toJudgeCriteria(null)).toBeUndefined();
        expect(toJudgeCriteria({})).toBeUndefined();
        expect(toJudgeCriteria({ criteria: [] })).toBeUndefined();
        // missing score on a criterion → not a valid breakdown
        expect(
            toJudgeCriteria({ criteria: [{ name: "x", reasoning: "y" }] }),
        ).toBeUndefined();
    });
});

describe("toTranscriptMetricDetails", () => {
    it("parses supplemental transcript metrics", () => {
        const details = toTranscriptMetricDetails({
            metricKind: "mechanical_stt",
            layer: "stt",
            transcriptVariant: "latin",
            sttModelId: "gpt-4o-mini-transcribe",
            providerId: "openai",
            routeId: "openai-audio-transcriptions",
            configHash: "hash-1",
            referenceField: "expectedTranscript",
            referenceKind: "human_gold",
            wer: 0.2,
            cer: 0.1,
            fillerStrippedWer: 0,
            wordCounts: {
                substitutions: 1,
                deletions: 0,
                insertions: 0,
                referenceLength: 5,
            },
            characterCounts: {
                substitutions: 1,
                deletions: 0,
                insertions: 0,
                referenceLength: 20,
            },
            domainTermRecall: {
                matched: 1,
                expected: 2,
                recall: 0.5,
                missed: ["aspirin"],
            },
            numericAccuracy: {
                matched: 1,
                expected: 1,
                accuracy: 1,
                missed: [],
            },
            diarization: {
                speakerCountDelta: 0,
                coverageRatio: 1,
                der: 0,
                falseAlarmRate: 0,
                missedDetectionRate: 0,
                speakerConfusionRate: 0,
                cpWer: 0,
                perSpeakerWer: { A: 0, B: 0.5 },
                concatenatedWer: 0,
            },
            hardFailures: ["truncation"],
        });

        expect(details?.metricKind).toBe("mechanical_stt");
        expect(details?.layer).toBe("stt");
        expect(details?.transcriptVariant).toBe("latin");
        expect(details?.sttModelId).toBe("gpt-4o-mini-transcribe");
        expect(details?.routeId).toBe("openai-audio-transcriptions");
        expect(details?.fillerStrippedWer).toBe(0);
        expect(details?.domainTermRecall?.missed).toEqual(["aspirin"]);
        expect(details?.numericAccuracy?.accuracy).toBe(1);
        expect(details?.diarization?.perSpeakerWer?.B).toBe(0.5);
        expect(details?.hardFailures).toEqual(["truncation"]);
    });

    it("accepts stored workflow metrics without supplemental fields", () => {
        expect(
            toTranscriptMetricDetails({
                metricKind: "mechanical_stt",
                layer: "stt",
                wer: 0,
                cer: 0,
                wordCounts: {
                    substitutions: 0,
                    deletions: 0,
                    insertions: 0,
                    referenceLength: 4,
                },
                hardFailures: [],
            }),
        ).toMatchObject({ wer: 0, cer: 0 });
    });
});

describe("toTranscriptJudgeMetricDetails", () => {
    it("parses transcript judge details", () => {
        expect(
            toTranscriptJudgeMetricDetails({
                metricKind: "llm_judge",
                modelId: "gpt-4o-mini",
                rubricPrompt: "Score semantic accuracy.",
                referenceKind: "silver",
                criteria: [
                    {
                        name: "semantic_accuracy",
                        reasoning: "mostly correct",
                        score: 0.8,
                    },
                ],
            }),
        ).toMatchObject({
            modelId: "gpt-4o-mini",
            referenceKind: "silver",
            criteria: [{ name: "semantic_accuracy", score: 0.8 }],
        });
    });

    it("accepts stored workflow judge details without a metric kind", () => {
        expect(
            toTranscriptJudgeMetricDetails({
                modelId: "gpt-5-mini",
                rubricPrompt: "Judge fidelity.",
                criteria: [
                    { name: "accuracy", reasoning: "correct", score: 1 },
                ],
            }),
        ).toMatchObject({ modelId: "gpt-5-mini" });
    });
});

describe("formatTranscriptReferenceKind", () => {
    it("labels gold and agreement metrics explicitly", () => {
        expect(formatTranscriptReferenceKind("human_gold")).toBe(
            "Human gold reference",
        );
        expect(formatTranscriptReferenceKind("silver")).toBe(
            "Agreement with silver reference",
        );
        expect(formatTranscriptReferenceKind("prod_reference")).toBe(
            "Agreement with production reference",
        );
        expect(formatTranscriptReferenceKind(undefined)).toBe("not provided");
    });
});
