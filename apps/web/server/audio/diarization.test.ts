import { describe, expect, it } from "vitest";
import { DiarizationLimitError, scoreDiarizationMetrics } from "./diarization";
import { MAX_TRANSCRIPT_CHARACTERS } from "./editDistance";

describe("scoreDiarizationMetrics", () => {
    it("rejects pathological concatenated speaker transcripts", () => {
        expect(() =>
            scoreDiarizationMetrics({
                referenceTurns: [
                    {
                        speaker: "A",
                        text: "a".repeat(MAX_TRANSCRIPT_CHARACTERS + 1),
                    },
                ],
                candidateSegments: [{ speaker: "S1", text: "hello" }],
            }),
        ).toThrow(
            `Diarization scoring rejected reference text with ${MAX_TRANSCRIPT_CHARACTERS + 1} characters`,
        );
    });

    it("rejects a pathological speaker-mapping workload", () => {
        expect(() =>
            scoreDiarizationMetrics({
                referenceTurns: Array.from({ length: 9 }, (_, index) => ({
                    speaker: `R${index}`,
                    text: "hello",
                })),
                candidateSegments: Array.from({ length: 9 }, (_, index) => ({
                    speaker: `C${index}`,
                    text: "hello",
                })),
            }),
        ).toThrow("speaker mapping exceeds the safe limit");
    });

    it("rejects excessive speaker recursion even with one reference speaker", () => {
        expect(() =>
            scoreDiarizationMetrics({
                referenceTurns: [{ speaker: "R", text: "hello" }],
                candidateSegments: Array.from({ length: 65 }, (_, index) => ({
                    speaker: `C${index}`,
                    text: "hello",
                })),
            }),
        ).toThrow("maximum accepted speaker count is 64");
    });

    it("caps combined mapping and transcript traversal work", () => {
        // 4^8 mappings, each set of candidate speakers walking 20,000 turns.
        const referenceSpeakers = ["A", "B", "C", "D"];
        expect(() =>
            scoreDiarizationMetrics({
                referenceTurns: Array.from({ length: 10_000 }, (_, index) => ({
                    speaker: referenceSpeakers[index % 4],
                    text: "hello",
                })),
                candidateSegments: Array.from(
                    { length: 10_000 },
                    (_, index) => ({
                        speaker: `S${index % 8}`,
                        text: "hello",
                    }),
                ),
            }),
        ).toThrow(DiarizationLimitError);
    });

    it("scores a long recording with many reference speakers", () => {
        // The shape that used to fail: 9 reference speakers, 3 candidate
        // speakers (729 mappings), hundreds of timed turns on each side.
        const referenceTurns = Array.from({ length: 216 }, (_, index) => ({
            speaker: `R${index % 9}`,
            text: `शब्द ${index} बात`,
            startMs: index * 3_000,
            endMs: index * 3_000 + 2_800,
        }));
        const candidateSegments = Array.from({ length: 538 }, (_, index) => ({
            speaker: `C${index % 3}`,
            text: `शब्द ${index}`,
            startMs: index * 1_200,
            endMs: index * 1_200 + 1_100,
        }));

        const result = scoreDiarizationMetrics({
            referenceTurns,
            candidateSegments,
        });

        expect(result?.der).toEqual(expect.any(Number));
        expect(result?.cpWer).toEqual(expect.any(Number));
        expect(Object.keys(result?.perSpeakerWer ?? {})).toHaveLength(9);
        expect(result?.speakerCountDelta).toBe(-6);
    });

    it("maps speakers by total overlap and scores cpWER over merged speakers", () => {
        // S2 speaks for both B and C: one of them is confused and cpWER
        // counts two insertions and two deletions out of six words.
        const result = scoreDiarizationMetrics({
            referenceTurns: [
                { speaker: "A", text: "one two", startMs: 0, endMs: 1_000 },
                {
                    speaker: "B",
                    text: "three four",
                    startMs: 1_000,
                    endMs: 2_000,
                },
                {
                    speaker: "C",
                    text: "five six",
                    startMs: 2_000,
                    endMs: 3_000,
                },
            ],
            candidateSegments: [
                { speaker: "S1", text: "one two", startMs: 0, endMs: 1_000 },
                {
                    speaker: "S2",
                    text: "three four five six",
                    startMs: 1_000,
                    endMs: 3_000,
                },
            ],
        });

        // After the 250 ms collar each reference turn keeps 500 ms; C's
        // 500 ms is heard from S2, which maps to B.
        expect(result?.der).toBeCloseTo(1 / 3);
        expect(result?.speakerConfusionRate).toBeCloseTo(1 / 3);
        expect(result?.missedDetectionRate).toBe(0);
        expect(result?.falseAlarmRate).toBe(0);
        expect(result?.cpWer).toBeCloseTo(4 / 6);
        expect(result?.perSpeakerWer).toEqual({ A: 0, B: 1, C: 1 });
    });

    it("does not multiply overlap comparisons by speaker mappings", () => {
        const referenceTurns = Array.from({ length: 1_000 }, (_, index) => ({
            speaker: `R${index % 4}`,
            text: "hello",
            startMs: index * 10,
            endMs: index * 10 + 5,
        }));
        const candidateSegments = Array.from({ length: 1_000 }, (_, index) => ({
            speaker: `C${index % 4}`,
            text: "hello",
            startMs: index * 10,
            endMs: index * 10 + 5,
        }));

        expect(
            scoreDiarizationMetrics({ referenceTurns, candidateSegments }),
        ).toEqual(expect.objectContaining({ der: 0, cpWer: 0 }));
    });

    it("does not charge untimed turns against the overlap budget", () => {
        const referenceTurns = Array.from({ length: 2_000 }, (_, index) => ({
            speaker: `R${index % 2}`,
            text: "hello",
        }));
        const candidateSegments = Array.from({ length: 2_000 }, (_, index) => ({
            speaker: `C${index % 2}`,
            text: "hello",
        }));

        expect(
            scoreDiarizationMetrics({ referenceTurns, candidateSegments }),
        ).toEqual(expect.objectContaining({ der: null, cpWer: 0 }));
    });

    it("computes speaker-count delta, coverage, DER, cpWER, and concatenated WER", () => {
        const result = scoreDiarizationMetrics({
            referenceTurns: [
                { speaker: "A", text: "hello there", startMs: 0, endMs: 1000 },
                {
                    speaker: "B",
                    text: "general kenobi",
                    startMs: 1000,
                    endMs: 2000,
                },
            ],
            candidateSegments: [
                { speaker: "S1", text: "hello there", startMs: 0, endMs: 1000 },
                {
                    speaker: "S2",
                    text: "general kenobi",
                    startMs: 1000,
                    endMs: 2000,
                },
            ],
        });

        expect(result).toEqual({
            speakerCountDelta: 0,
            coverageRatio: 1,
            der: 0,
            falseAlarmRate: 0,
            missedDetectionRate: 0,
            speakerConfusionRate: 0,
            cpWer: 0,
            perSpeakerWer: {
                A: 0,
                B: 0,
            },
            concatenatedWer: 0,
            config: {
                derCollarMs: 250,
                derSkipOverlap: false,
                sampleStepMs: 50,
            },
        });
    });

    it("does not penalize boundary jitter inside the DER collar", () => {
        const result = scoreDiarizationMetrics({
            referenceTurns: [
                { speaker: "A", text: "hello there", startMs: 0, endMs: 2000 },
            ],
            candidateSegments: [
                {
                    speaker: "S1",
                    text: "hello there",
                    startMs: 150,
                    endMs: 1850,
                },
            ],
        });

        expect(result?.der).toBe(0);
        expect(result?.config.derCollarMs).toBe(250);
    });

    it("uses best speaker permutation for swapped anonymous speaker labels", () => {
        const result = scoreDiarizationMetrics({
            referenceTurns: [
                { speaker: "A", text: "alpha", startMs: 0, endMs: 1000 },
                { speaker: "B", text: "beta", startMs: 1000, endMs: 2000 },
            ],
            candidateSegments: [
                { speaker: "S2", text: "alpha", startMs: 0, endMs: 1000 },
                { speaker: "S1", text: "beta", startMs: 1000, endMs: 2000 },
            ],
        });

        expect(result?.der).toBe(0);
        expect(result?.cpWer).toBe(0);
    });

    it("penalizes wrong speaker attribution in cpWER even when plain text matches", () => {
        const result = scoreDiarizationMetrics({
            referenceTurns: [
                { speaker: "A", text: "alpha" },
                { speaker: "B", text: "beta" },
            ],
            candidateSegments: [{ speaker: "S1", text: "alpha beta" }],
        });

        expect(result?.speakerCountDelta).toBe(-1);
        expect(result?.concatenatedWer).toBe(0);
        expect(result?.cpWer).toBeGreaterThan(0);
        expect(Object.keys(result?.perSpeakerWer ?? {}).sort()).toEqual([
            "A",
            "B",
        ]);
        expect(Object.values(result?.perSpeakerWer ?? {})).toContain(1);
        expect(result?.der).toBeNull();
        expect(result?.falseAlarmRate).toBeNull();
        expect(result?.missedDetectionRate).toBeNull();
        expect(result?.speakerConfusionRate).toBeNull();
    });

    it("returns undefined when either side has no speaker data", () => {
        expect(
            scoreDiarizationMetrics({
                referenceTurns: [{ speaker: "A", text: "hello" }],
                candidateSegments: [],
            }),
        ).toBeUndefined();
    });
});
