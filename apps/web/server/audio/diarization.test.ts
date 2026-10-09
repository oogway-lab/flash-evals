import { describe, expect, it } from "vitest";
import { scoreDiarizationMetrics } from "./diarization";
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
        const speakers = ["A", "B", "C", "D", "E"];
        expect(() =>
            scoreDiarizationMetrics({
                referenceTurns: Array.from({ length: 1_000 }, (_, index) => ({
                    speaker: speakers[index % speakers.length],
                    text: "hello",
                })),
                candidateSegments: Array.from(
                    { length: 1_000 },
                    (_, index) => ({
                        speaker: `S${index % speakers.length}`,
                        text: "hello",
                    }),
                ),
            }),
        ).toThrow("speaker attribution workload above the safe limit");
    });

    it("counts overlap comparisons across every speaker mapping", () => {
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

        expect(() =>
            scoreDiarizationMetrics({ referenceTurns, candidateSegments }),
        ).toThrow("speaker attribution workload above the safe limit");
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
