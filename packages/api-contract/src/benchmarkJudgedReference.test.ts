import { describe, expect, it } from "vitest";
import {
    summarizeBenchmarkComparison,
    type IBenchmarkCellInput,
    type ITaskMap,
} from "./benchmark.js";
import type { IBenchmarkPolicy } from "./benchmarkVerdict.js";

// Judged tasks (head to head, or agreement settled by a judge) on stored
// answers, where the reference model is judged too. Synthetic data.
describe("judged tasks compared with the reference model", () => {
    it("judges head-to-head tasks on stored answers against the reference's own won-or-tied rate", () => {
        const notes: ITaskMap = {
            tasks: [
                {
                    key: "notes",
                    name: "Meeting notes",
                    method: "head_to_head",
                    paths: ["$.notes"],
                },
            ],
        };
        const items = Array.from({ length: 20 }, (_, index) => `i${index}`);
        const judged = (
            runModelId: string,
            verdict: (index: number) => "win" | "tie" | "loss",
        ): IBenchmarkCellInput[] =>
            items.map((item, index) => ({
                runModelId,
                datasetItemId: item,
                succeeded: true,
                costUsd: 0.01,
                latencyMs: 100,
                details: {
                    tasks: [
                        {
                            key: "notes",
                            method: "head_to_head",
                            verdict: verdict(index),
                        },
                    ],
                },
            }));
        const three = [
            { id: "rm-ref", modelId: "big", isBenchmark: true },
            { id: "rm-same", modelId: "same", isBenchmark: false },
            { id: "rm-worse", modelId: "worse", isBenchmark: false },
        ];
        // The reference wins 11, ties 2 and loses 7 against the stored
        // notes: 65%, under a fixed 90% target. "same" loses the same 7;
        // "worse" also loses 6 the reference won.
        const cells = [
            ...judged("rm-ref", (i) =>
                i < 7 ? "loss" : i < 9 ? "tie" : "win",
            ),
            ...judged("rm-same", (i) =>
                i < 7 ? "loss" : i < 9 ? "tie" : "win",
            ),
            ...judged("rm-worse", (i) => (i < 13 ? "loss" : "win")),
        ];
        const summarize = (policy?: IBenchmarkPolicy) =>
            summarizeBenchmarkComparison({
                taskMap: notes,
                models: three,
                source: "labels",
                labeledItemIds: items,
                cells,
                ...(policy ? { policy } : {}),
            });
        const summaries = summarize({
            minWinOrTieRate: 0.9,
            maxDropBelowReference: 0.02,
        });
        const row = (modelId: string) =>
            summaries.find((summary) => summary.modelId === modelId)!;
        // Matching the reference on 20 items cannot yet rule out a 2-point
        // drop on unseen items: uncertain, not a pass.
        expect(row("same").tasks[0]!.assessment).toMatchObject({
            metric: "winOrTieRate",
            value: 0.65,
            verdict: "uncertain",
            reference: { value: 0.65, difference: 0, items: 20, maxDrop: 0.02 },
        });
        expect(row("same").tasks[0]!.assessment.threshold).toBeCloseTo(0.63);
        expect(row("same").assessment!.verdict).toBe("conditional");
        expect(row("worse").tasks[0]!.assessment.verdict).toBe("fail");
        expect(
            row("worse").tasks[0]!.assessment.reference!.difference,
        ).toBeCloseTo(-0.3);
        expect(row("worse").assessment!.reasons[0]).toMatch(
            /Meeting notes: won or tied -30.0 points against the reference's 65%/,
        );
        // The reference itself is shown with its value, never judged.
        expect(row("big").isReference).toBe(true);
        expect(row("big").assessment).toBeUndefined();
        expect(row("big").tasks[0]!.assessment).toMatchObject({
            value: 0.65,
            verdict: "reference",
        });
        expect(row("big").tasks[0]!.assessment.reference).toBeUndefined();
        // Without an allowed drop, the fixed minimum applies to everyone.
        const fixed = summarize({ minWinOrTieRate: 0.9 });
        const same = fixed.find((summary) => summary.modelId === "same")!;
        expect(same.tasks[0]!.assessment.reference).toBeUndefined();
        expect(same.tasks[0]!.assessment.verdict).toBe("fail");
    });

    it("pairs judged agreement tasks with the reference and counts failed items as losses", () => {
        const competitors: ITaskMap = {
            tasks: [
                {
                    key: "rivals",
                    name: "Rivals",
                    method: "agreement",
                    judgeDisagreements: true,
                    fields: [{ path: "$.rivals", matcher: "set_overlap" }],
                },
            ],
        };
        const items = Array.from({ length: 10 }, (_, index) => `i${index}`);
        const cell = (
            runModelId: string,
            item: string,
            verdict: "win" | "tie" | "loss" | undefined,
        ): IBenchmarkCellInput => ({
            runModelId,
            datasetItemId: item,
            succeeded: verdict !== undefined,
            costUsd: 0.01,
            latencyMs: 100,
            ...(verdict
                ? {
                      details: {
                          tasks: [
                              {
                                  key: "rivals",
                                  method: "agreement" as const,
                                  agreement: verdict === "loss" ? 0 : 1,
                                  verdict,
                              },
                          ],
                      },
                  }
                : {}),
        });
        const [, candidate] = summarizeBenchmarkComparison({
            taskMap: competitors,
            models: [
                { id: "ref", modelId: "big", isBenchmark: true },
                { id: "cand", modelId: "small", isBenchmark: false },
            ],
            source: "labels",
            labeledItemIds: items,
            policy: { maxDropBelowReference: 0.1 },
            cells: [
                ...items.map((item) => cell("ref", item, "tie")),
                // One failed item: a loss, paired with the reference's tie.
                ...items.map((item, index) =>
                    cell("cand", item, index === 0 ? undefined : "tie"),
                ),
            ],
        });
        expect(candidate!.tasks[0]).toMatchObject({ losses: 1, ties: 9 });
        expect(candidate!.tasks[0]!.assessment).toMatchObject({
            metric: "winOrTieRate",
            reference: { value: 1, items: 10, maxDrop: 0.1 },
        });
        expect(
            candidate!.tasks[0]!.assessment.reference!.difference,
        ).toBeCloseTo(-0.1);
    });

    it("keeps the fixed won-or-tied target when the reference is the yardstick", () => {
        const notes: ITaskMap = {
            tasks: [
                {
                    key: "notes",
                    name: "Notes",
                    method: "head_to_head",
                    paths: ["$.notes"],
                },
            ],
        };
        const items = Array.from({ length: 10 }, (_, index) => `i${index}`);
        const [, candidate] = summarizeBenchmarkComparison({
            taskMap: notes,
            models: [
                { id: "ref", modelId: "big", isBenchmark: true },
                { id: "cand", modelId: "small", isBenchmark: false },
            ],
            source: "model",
            policy: { minWinOrTieRate: 0.8, maxDropBelowReference: 0.02 },
            cells: items.flatMap((item) => [
                {
                    runModelId: "ref",
                    datasetItemId: item,
                    succeeded: true,
                    costUsd: 0.01,
                    latencyMs: 100,
                },
                {
                    runModelId: "cand",
                    datasetItemId: item,
                    succeeded: true,
                    costUsd: 0.01,
                    latencyMs: 100,
                    details: {
                        tasks: [
                            {
                                key: "notes",
                                method: "head_to_head" as const,
                                verdict: "tie" as const,
                            },
                        ],
                    },
                },
            ]),
        });
        expect(candidate!.tasks[0]!.assessment).toMatchObject({
            metric: "winOrTieRate",
            threshold: 0.8,
        });
        expect(candidate!.tasks[0]!.assessment.reference).toBeUndefined();
    });
});
