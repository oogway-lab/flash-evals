import { describe, expect, it } from "vitest";
import {
    agreementInterval,
    assessModel,
    assessTask,
    differenceInterval,
    meanInterval,
    sampleSizeFor,
    wilsonInterval,
} from "./benchmarkVerdict.js";

describe("intervals", () => {
    it("computes a Wilson interval that stays inside 0 to 1", () => {
        const interval = wilsonInterval(19, 20)!;
        expect(interval.low).toBeCloseTo(0.7639, 3);
        expect(interval.high).toBeCloseTo(0.9911, 3);
        expect(wilsonInterval(20, 20)!.high).toBe(1);
        expect(wilsonInterval(0, 0)).toBeUndefined();
    });

    it("computes a t interval for mean agreement, clamped to 0 to 1", () => {
        const interval = meanInterval([1, 1, 1, 0.5, 1])!;
        // mean 0.9, sd 0.2236, t(4) = 2.776
        expect(interval.low).toBeCloseTo(
            0.9 - (2.776 * 0.2236) / Math.sqrt(5),
            3,
        );
        expect(interval.high).toBe(1);
        expect(meanInterval([1])).toBeUndefined();
    });

    it("uses Wilson on the total for agreement, not a point interval", () => {
        // 5 of 5 right is not certainty: a t interval would be [1, 1].
        expect(agreementInterval([1, 1, 1, 1, 1])).toEqual(
            wilsonInterval(5, 5),
        );
        expect(agreementInterval([1, 0, 1, 1, 1])).toEqual(
            wilsonInterval(4, 5),
        );
        expect(agreementInterval([0.8, 0.8, 0.8])!.high).toBeGreaterThan(0.8);
        // Mixed scores too: a t interval here is narrower and could pass a
        // run that 20 perfect items cannot.
        expect(agreementInterval([1, 0.5, 1])).toEqual(wilsonInterval(2.5, 3));
        expect(agreementInterval([])).toBeUndefined();
        expect(
            assessTask({
                key: "sales",
                judged: false,
                n: 5,
                value: 1,
                interval: agreementInterval([1, 1, 1, 1, 1]),
            }).verdict,
        ).toBe("uncertain");
    });

    it("widens identical paired differences instead of a point at the difference", () => {
        const none = differenceInterval([0, 0, 0, 0, 0])!;
        expect(none.low).toBeCloseTo(-wilsonInterval(0, 5)!.high);
        expect(none.high).toBeCloseTo(wilsonInterval(0, 5)!.high);
        // Gains and losses each get a Wilson interval; their distances
        // from the estimates combine as a square root of squares plus the
        // cross term for their correlation: sqrt(0.25 * 0.25 / 0.75²) = 1/3.
        const mixed = differenceInterval([0.5, -0.5])!;
        const share = wilsonInterval(0.5, 2)!;
        const [down, up] = [0.25 - share.low, share.high - 0.25];
        expect(mixed.low).toBeCloseTo(
            -Math.sqrt(down * down + up * up + (2 * down * up) / 3),
        );
        expect(mixed.high).toBeCloseTo(-mixed.low);
        const tied = (n: number) =>
            assessTask({
                key: "sales",
                judged: false,
                n,
                value: 1,
                policy: { maxDropBelowReference: 0.02 },
                referencePairs: Array.from(
                    { length: n },
                    (): [number, number] => [1, 1],
                ),
            }).verdict;
        // Agreeing on 5 items cannot rule out a 2-point drop; on 400 it can.
        expect(tied(5)).toBe("uncertain");
        expect(tied(400)).toBe("pass");
    });

    it("covers the true paired difference about 95% of the time", () => {
        // Seeded draws of n items, each a gain (pg), a loss (pl) or a tie.
        // Gains and losses come from the same items; treated as independent
        // they covered about 87% at pg = pl = 0.4, n = 100.
        const coverage = (pg: number, pl: number, n: number) => {
            let state = 42;
            const next = () => {
                state = (state * 1103515245 + 12345) % 2147483648;
                return state / 2147483648;
            };
            let covered = 0;
            const runs = 4000;
            for (let run = 0; run < runs; run++) {
                const differences = Array.from({ length: n }, () => {
                    const draw = next();
                    return draw < pg ? 1 : draw < pg + pl ? -1 : 0;
                });
                const interval = differenceInterval(differences)!;
                if (interval.low <= pg - pl && pg - pl <= interval.high)
                    covered++;
            }
            return covered / runs;
        };
        expect(coverage(0.4, 0.4, 100)).toBeGreaterThanOrEqual(0.93);
        expect(coverage(0.45, 0.45, 30)).toBeGreaterThanOrEqual(0.93);
        expect(coverage(0.3, 0.1, 50)).toBeGreaterThanOrEqual(0.93);
    });

    it("keeps both ends monotone when almost no item ties", () => {
        // Gains spread over the fewest items, losses over the rest; one more
        // loss or one less gain must not raise either end.
        const paired = (gained: number, lost: number, n: number) => {
            const gainItems = Math.ceil(gained - 1e-9);
            const lossItems = n - gainItems;
            if (lost > lossItems + 1e-9) return undefined;
            return differenceInterval([
                ...Array.from({ length: gainItems }, () => gained / gainItems),
                ...Array.from({ length: lossItems }, () => -lost / lossItems),
            ]);
        };
        for (const n of [5, 12, 40]) {
            const step = n / 200;
            for (let gained = 0; gained <= n; gained += step)
                for (let lost = 0; gained + lost <= n; lost += step) {
                    const at = paired(gained, lost, n);
                    if (!at) continue;
                    for (const worse of [
                        paired(gained, lost + step, n),
                        paired(Math.max(0, gained - step), lost, n),
                    ]) {
                        if (!worse) continue;
                        expect(worse.low).toBeLessThanOrEqual(at.low + 1e-12);
                        expect(worse.high).toBeLessThanOrEqual(at.high + 1e-12);
                    }
                }
        }
    });

    it("labels sample sizes", () => {
        expect(sampleSizeFor(4)).toBe("insufficient");
        expect(sampleSizeFor(5)).toBe("uncertain");
        expect(sampleSizeFor(20)).toBe("sufficient");
    });
});

describe("assessTask", () => {
    it("passes only when the whole interval clears the threshold", () => {
        expect(
            assessTask({
                key: "sales",
                judged: false,
                n: 30,
                value: 0.97,
                interval: { low: 0.93, high: 1 },
            }),
        ).toMatchObject({
            verdict: "pass",
            threshold: 0.9,
            sampleSize: "sufficient",
        });
        expect(
            assessTask({
                key: "sales",
                judged: false,
                n: 30,
                value: 0.92,
                interval: { low: 0.86, high: 0.98 },
            }).verdict,
        ).toBe("uncertain");
        expect(
            assessTask({
                key: "sales",
                judged: false,
                n: 30,
                value: 0.8,
                interval: { low: 0.74, high: 0.86 },
            }).verdict,
        ).toBe("fail");
    });

    it("never passes on too few items and uses per-task thresholds", () => {
        expect(
            assessTask({ key: "a", judged: true, n: 4, value: 1 }).verdict,
        ).toBe("insufficient");
        expect(
            assessTask({
                key: "summary",
                judged: true,
                n: 25,
                value: 0.8,
                interval: { low: 0.72, high: 0.86 },
                policy: {
                    minWinOrTieRate: 0.95,
                    tasks: { summary: { minWinOrTieRate: 0.7 } },
                },
            }),
        ).toMatchObject({
            metric: "winOrTieRate",
            threshold: 0.7,
            verdict: "pass",
        });
    });
});

describe("assessModel", () => {
    const pass = assessTask({
        key: "a",
        judged: false,
        n: 25,
        value: 0.99,
        interval: { low: 0.95, high: 1 },
    });

    it("passes when every task passes on enough items", () => {
        expect(
            assessModel({
                tasks: [{ name: "Sales call", assessment: pass }],
                relativeCost: 0.2,
                failedItems: 0,
                policy: { maxRelativeCost: 0.4 },
            }),
        ).toEqual({ verdict: "pass", reasons: [] });
    });

    it("fails on a failed task or on cost, listing failures first", () => {
        const fail = assessTask({
            key: "b",
            judged: false,
            n: 25,
            value: 0.7,
            interval: { low: 0.6, high: 0.8 },
        });
        const result = assessModel({
            tasks: [
                { name: "Sales call", assessment: pass },
                { name: "Competitors", assessment: fail },
            ],
            relativeCost: 0.5,
            failedItems: 1,
            policy: { maxRelativeCost: 0.4 },
        });
        expect(result.verdict).toBe("fail");
        expect(result.reasons).toEqual([
            "Competitors: agreement 70% (95% CI 60%–80%), below target 90%.",
            "Cost is 50% of the benchmark's, above the 40% limit.",
            "Failed on 1 item (counted as losses).",
        ]);
    });

    it("is conditional on small samples and inconclusive with no data", () => {
        const small = assessTask({
            key: "a",
            judged: false,
            n: 8,
            value: 1,
            interval: { low: 1, high: 1 },
        });
        expect(
            assessModel({
                tasks: [{ name: "Sales call", assessment: small }],
                failedItems: 0,
            }),
        ).toEqual({
            verdict: "conditional",
            reasons: ["Sales call: passes, but on fewer than 20 items."],
        });
        expect(
            assessModel({
                tasks: [
                    {
                        name: "Sales call",
                        assessment: assessTask({
                            key: "a",
                            judged: false,
                            n: 2,
                        }),
                    },
                ],
                failedItems: 0,
            }).verdict,
        ).toBe("inconclusive");
    });
});

describe("verdict monotonicity", () => {
    const RANK: Record<string, number> = {
        fail: 0,
        uncertain: 1,
        insufficient: 1,
        pass: 2,
    };
    // Small seeded generator so a failure reproduces.
    function random(seed: number): () => number {
        let state = seed;
        return () => {
            state = (state * 1103515245 + 12345) % 2147483648;
            return state / 2147483648;
        };
    }
    const agreementVerdict = (scores: number[], minAgreement: number) =>
        assessTask({
            key: "sales",
            judged: false,
            n: scores.length,
            value:
                scores.reduce((total, score) => total + score, 0) /
                scores.length,
            interval: agreementInterval(scores),
            policy: { minAgreement },
        }).verdict;
    const referenceVerdict = (
        pairs: Array<[number, number]>,
        maxDropBelowReference: number,
    ) =>
        assessTask({
            key: "sales",
            judged: false,
            n: pairs.length,
            value: 1,
            policy: { maxDropBelowReference },
            referencePairs: pairs,
        }).verdict;

    it("never improves agreement when one item is slightly worse", () => {
        const all = Array.from({ length: 20 }, () => 1);
        expect(agreementVerdict(all, 0.85)).toBe("uncertain");
        expect(agreementVerdict([...all.slice(1), 0.99], 0.85)).toBe(
            "uncertain",
        );
        const next = random(7);
        for (let run = 0; run < 3000; run++) {
            const n = 5 + Math.floor(next() * 60);
            const style = next();
            const scores = Array.from({ length: n }, () =>
                style < 0.3
                    ? next() < 0.85
                        ? 1
                        : 0
                    : style < 0.6
                      ? Math.round(next() * 4) / 4
                      : 0.7 + next() * 0.3,
            );
            const worse = [...scores];
            const index = Math.floor(next() * n);
            worse[index] = Math.max(
                0,
                worse[index]! - (next() < 0.5 ? 0.01 : next()),
            );
            const threshold = 0.5 + next() * 0.45;
            const before = agreementInterval(scores)!;
            const after = agreementInterval(worse)!;
            expect(after.low).toBeLessThanOrEqual(before.low + 1e-12);
            expect(after.high).toBeLessThanOrEqual(before.high + 1e-12);
            expect(
                RANK[agreementVerdict(worse, threshold)]!,
            ).toBeLessThanOrEqual(RANK[agreementVerdict(scores, threshold)]!);
        }
    });

    it("never improves against the reference when one item is slightly worse", () => {
        const ties = Array.from({ length: 100 }, (): [number, number] => [
            1, 1,
        ]);
        // 100 exact ties cannot rule out a 2-point drop, and one small
        // loss on top must not turn that into a pass.
        expect(referenceVerdict(ties, 0.02)).toBe("uncertain");
        expect(referenceVerdict([...ties.slice(1), [0.99, 1]], 0.02)).toBe(
            "uncertain",
        );
        const next = random(11);
        for (let run = 0; run < 3000; run++) {
            const n = 5 + Math.floor(next() * 400);
            const style = next();
            const score = () =>
                style < 0.4
                    ? next() < 0.9
                        ? 1
                        : 0
                    : Math.round((0.6 + next() * 0.4) * 20) / 20;
            const pairs = Array.from({ length: n }, (): [number, number] => {
                const reference = score();
                return [next() < 0.7 ? reference : score(), reference];
            });
            const worse = pairs.map((pair): [number, number] => [
                pair[0],
                pair[1],
            ]);
            const index = Math.floor(next() * n);
            worse[index]![0] = Math.max(
                0,
                worse[index]![0] - (next() < 0.5 ? 0.01 : next()),
            );
            const maxDrop = next() * 0.1;
            const before = differenceInterval(
                pairs.map(([candidate, reference]) => candidate - reference),
            )!;
            const after = differenceInterval(
                worse.map(([candidate, reference]) => candidate - reference),
            )!;
            expect(after.low).toBeLessThanOrEqual(before.low + 1e-12);
            expect(after.high).toBeLessThanOrEqual(before.high + 1e-12);
            expect(RANK[referenceVerdict(worse, maxDrop)]!).toBeLessThanOrEqual(
                RANK[referenceVerdict(pairs, maxDrop)]!,
            );
        }
    });
});
