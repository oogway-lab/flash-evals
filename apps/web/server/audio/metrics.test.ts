import { describe, expect, it } from "vitest";
import { scoreTranscriptMetrics } from "./metrics";
import { MAX_TRANSCRIPT_CHARACTERS } from "./editDistance";

// V8 instrumentation distorts wall-clock measurements; regular unit tests keep
// enforcing these performance budgets while coverage runs still test results.
const checkPerformanceBudgets = process.env.MOSAIC_COVERAGE_RUN !== "1";

describe("scoreTranscriptMetrics", () => {
    it("computes WER and CER for 25,000-character transcripts within ten seconds", () => {
        const reference = Array.from({ length: 25_000 }, (_, index) =>
            index % 7 === 0 ? "a" : "b",
        );
        const candidate = [...reference];
        for (let index = 500; index < candidate.length; index += 1_000) {
            candidate[index] = candidate[index] === "a" ? "b" : "a";
        }

        const startedAt = performance.now();
        const result = scoreTranscriptMetrics({
            candidateText: candidate.join(""),
            label: { expectedTranscript: reference.join("") },
        });

        if (checkPerformanceBudgets) {
            expect(performance.now() - startedAt).toBeLessThan(10_000);
        }
        expect(result?.details.wordCounts).toEqual({
            substitutions: 1,
            deletions: 0,
            insertions: 0,
            referenceLength: 1,
        });
        expect(result?.details.characterCounts).toEqual({
            substitutions: 25,
            deletions: 0,
            insertions: 0,
            referenceLength: 25_000,
        });
        expect(result?.details.wer).toBe(1);
        expect(result?.details.cer).toBe(0.001);
    }, 15_000);

    it("bounds runtime for a 23,000-character transcript with distributed errors", () => {
        const alphabet = "abcdefghijklmnopqrstuvw";
        const reference = Array.from(
            { length: 23_000 },
            (_, index) =>
                alphabet[(index * 17 + index * index) % alphabet.length],
        );
        const candidate = reference.map((character, index) =>
            index % 10 === 0 ? "z" : character,
        );

        const startedAt = performance.now();
        const result = scoreTranscriptMetrics({
            candidateText: candidate.join(""),
            label: { expectedTranscript: reference.join("") },
        });

        if (checkPerformanceBudgets) {
            expect(performance.now() - startedAt).toBeLessThan(10_000);
        }
        expect(result?.details.characterCounts.substitutions).toBeGreaterThan(
            0,
        );
        expect(result?.details.cer).toBeGreaterThan(0);
    }, 15_000);

    it("rejects pathological transcript sizes before scoring", () => {
        expect(() =>
            scoreTranscriptMetrics({
                candidateText: "a".repeat(MAX_TRANSCRIPT_CHARACTERS + 1),
                label: { expectedTranscript: "hello" },
            }),
        ).toThrow(
            `Transcript scoring rejected candidate text with ${MAX_TRANSCRIPT_CHARACTERS + 1} characters`,
        );
    });

    it("computes WER and CER against a gold transcript", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello brave world",
            label: { expectedTranscript: "hello world" },
            sttModelId: "soniox:stt-async-v5",
            providerId: "soniox",
            routeId: "soniox-async-file-transcription",
            configHash: "abc123",
        });

        expect(result?.score).toBe(0.5);
        expect(result?.details).toMatchObject({
            metricKind: "mechanical_stt",
            layer: "stt",
            transcriptVariant: "raw",
            sttModelId: "soniox:stt-async-v5",
            providerId: "soniox",
            routeId: "soniox-async-file-transcription",
            configHash: "abc123",
            referenceField: "expectedTranscript",
            referenceKind: "human_gold",
            hardFailures: [],
            wer: 0.5,
            wordCounts: {
                substitutions: 0,
                deletions: 0,
                insertions: 1,
                referenceLength: 2,
            },
        });
        expect(result?.details.cer).toBeGreaterThan(0);
    });

    it("preserves STT latency and cost details for methodology gates", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello world",
            label: { expectedTranscript: "hello world" },
            latencyMsTotal: 2400,
            costUsd: 0.004,
            costSource: "computed",
        });

        expect(result?.details).toMatchObject({
            latencyMsTotal: 2400,
            costUsd: 0.004,
            costSource: "computed",
        });
    });

    it("normalizes case, punctuation, and whitespace before scoring", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "Hello,   world!",
            label: { transcript: "hello world" },
        });

        expect(result?.score).toBe(1);
        expect(result?.details.wer).toBe(0);
        expect(result?.details.cer).toBe(0);
    });

    it("preserves apostrophes and expands digit words in normalization", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "I can't take five hundred tablets",
            label: { expectedTranscript: "i can’t take 500 tablets" },
        });

        expect(result?.score).toBe(1);
        expect(result?.details.wer).toBe(0);
        expect(result?.details.normalization.expandDigitWords).toBe(true);
    });

    it("computes filler-stripped WER separately from default WER", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello um world",
            label: { expectedTranscript: "hello world" },
        });

        expect(result?.details.wer).toBe(0.5);
        expect(result?.details.fillerStrippedWer).toBe(0);
    });

    it("computes domain-term recall and numeric accuracy when gold labels exist", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "patient has hypertension and needs five mg",
            label: {
                expectedTranscript:
                    "patient has hypertension and needs 5 mg aspirin",
                domainTerms: ["hypertension", "aspirin"],
                expectedNumbers: [5],
            },
        });

        expect(result?.details.domainTermRecall).toEqual({
            matched: 1,
            expected: 2,
            recall: 0.5,
            missed: ["aspirin"],
        });
        expect(result?.details.numericAccuracy).toEqual({
            matched: 1,
            expected: 1,
            accuracy: 1,
            missed: [],
        });
    });

    it("scores empty transcripts as hard failures when a reference exists", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "",
            label: { expectedTranscript: "hello world again" },
        });

        expect(result?.score).toBe(0);
        expect(result?.details.wer).toBe(1);
        expect(result?.details.hardFailures).toContain("empty_transcript");
    });

    it("flags obvious repetition and truncation failures", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello hello hello hello hello hello",
            label: {
                expectedTranscript:
                    "hello this is a longer sentence with enough words to catch truncation during evaluation now",
            },
        });

        expect(result?.details.hardFailures).toEqual(
            expect.arrayContaining(["repetition", "truncation"]),
        );
    });

    it("flags replacement-character encoding issues", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello � world",
            label: { expectedTranscript: "hello world" },
        });

        expect(result?.details.hardFailures).toContain("non_utf8_output");
    });

    it("flags latency and cost threshold failures when reference metadata defines them", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello world",
            label: {
                expectedTranscript: "hello world",
                latencySlaMs: 1000,
                costOutlierUsd: 0.01,
            },
            latencyMsTotal: 1500,
            costUsd: 0.02,
            costSource: "computed",
        });

        expect(result?.details.hardFailures).toEqual(
            expect.arrayContaining(["latency_sla_breached", "cost_outlier"]),
        );
    });

    it("uses nested STT transcript labels when present", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "kya haal hai",
            label: { stt: { expectedLatinTranscript: "kya haal hai" } },
            variant: "latin",
        });

        expect(result?.details.referenceField).toBe("expectedTranscriptLatin");
        expect(result?.score).toBe(1);
    });

    it("prefers native transcript references for raw transcript variants", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "namaste",
            label: {
                expectedLatinTranscript: "hello",
                expectedTranscript: "namaste",
            },
            variant: "raw",
        });

        expect(result?.details.referenceField).toBe("expectedTranscript");
        expect(result?.score).toBe(1);
    });

    it("prefers Latin transcript references for Latin transcript variants", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "namaste",
            label: {
                referenceKind: "silver",
                expectedLatinTranscript: "namaste",
                expectedTranscript: "नमस्ते",
            },
            variant: "latin",
        });

        expect(result?.details.referenceField).toBe("expectedTranscriptLatin");
        expect(result?.details.referenceKind).toBe("silver");
        expect(result?.score).toBe(1);
    });

    it("skips metrics when no transcript reference exists", () => {
        expect(
            scoreTranscriptMetrics({
                candidateText: "hello",
                label: { calories: 120 },
            }),
        ).toBeUndefined();
    });

    it("includes diarization details when speaker references and candidate segments exist", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello there",
            candidateSegments: [
                { speaker: "S1", text: "hello there", startMs: 0, endMs: 1000 },
            ],
            label: {
                expectedTranscript: "hello there",
                expectedSpeakerTurns: [
                    {
                        speaker: "A",
                        text: "hello there",
                        startMs: 0,
                        endMs: 1000,
                    },
                ],
            },
        });

        expect(result?.details.diarization).toMatchObject({
            speakerCountDelta: 0,
            der: 0,
            cpWer: 0,
            concatenatedWer: 0,
        });
        expect(result?.details.hardFailures).toEqual([]);
    });

    it("flags wrong speaker counts from diarization metrics", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello there from two people",
            candidateSegments: [
                { speaker: "S1", text: "hello there", startMs: 0, endMs: 1000 },
            ],
            label: {
                expectedTranscript: "hello there from two people",
                expectedSpeakerTurns: [
                    {
                        speaker: "A",
                        text: "hello there",
                        startMs: 0,
                        endMs: 1000,
                    },
                    {
                        speaker: "B",
                        text: "from two people",
                        startMs: 1000,
                        endMs: 2000,
                    },
                ],
            },
        });

        expect(result?.details.hardFailures).toContain("wrong_speaker_count");
    });

    it("does not flag wrong_speaker_count when the candidate has no speaker labels", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "hello there from two people",
            candidateSegments: [
                // OpenAI-style segments: text only, no speaker diarization
                {
                    text: "hello there from two people",
                    startMs: 0,
                    endMs: 2000,
                },
            ],
            label: {
                expectedTranscript: "hello there from two people",
                expectedSpeakerTurns: [
                    {
                        speaker: "A",
                        text: "hello there",
                        startMs: 0,
                        endMs: 1000,
                    },
                    {
                        speaker: "B",
                        text: "from two people",
                        startMs: 1000,
                        endMs: 2000,
                    },
                ],
            },
        });

        expect(result?.details.diarization?.speakerCountDelta).toBe(-2);
        expect(result?.details.hardFailures).not.toContain(
            "wrong_speaker_count",
        );
    });

    it("scores decimal numbers correctly for numeric accuracy", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "take 2.5 mg",
            label: {
                expectedTranscript: "take 2.5 mg",
                expectedNumbers: [2.5],
            },
        });

        expect(result?.details.numericAccuracy).toEqual({
            matched: 1,
            expected: 1,
            accuracy: 1,
            missed: [],
        });
    });

    it("matches domain terms on token boundaries, not substrings", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "the concert started",
            label: {
                expectedTranscript: "the concert started",
                domainTerms: ["art"],
            },
        });

        expect(result?.details.domainTermRecall).toEqual({
            matched: 0,
            expected: 1,
            recall: 0,
            missed: ["art"],
        });
    });

    it("matches multi-word domain terms as consecutive tokens", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "patient has blood pressure issues",
            label: {
                expectedTranscript: "patient has blood pressure issues",
                domainTerms: ["blood pressure"],
            },
        });

        expect(result?.details.domainTermRecall).toEqual({
            matched: 1,
            expected: 1,
            recall: 1,
            missed: [],
        });
    });

    it("skips Latin scoring when only a native-script reference exists", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "namaste duniya",
            label: {
                expectedTranscript: "नमस्ते दुनिया",
            },
            variant: "latin",
        });

        expect(result).toBeUndefined();
    });

    it("skips raw scoring when only a Latin reference exists", () => {
        const result = scoreTranscriptMetrics({
            candidateText: "नमस्ते",
            label: {
                expectedLatinTranscript: "namaste",
            },
            variant: "raw",
        });

        expect(result).toBeUndefined();
    });
});
