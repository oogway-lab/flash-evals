import { describe, expect, it, vi } from "vitest";

// Pure selection helpers; the executor module only needs a database client
// to load.
vi.mock("../db/client", () => ({ db: {} }));

import { benchmarkForCell } from "./executor";
import {
    cellsToScore,
    paidScoresToKeep,
    paidVerdictsStillApply,
    priorBenchmarkToKeep,
} from "./scoringSelection";

describe("cellsToScore", () => {
    const cell = (
        id: string,
        runModelId: string,
        item: string,
        status = "succeeded",
    ) => ({
        id,
        runModelId,
        datasetItemId: item,
        status,
    });
    const cells = [
        cell("bench-1", "rm-bench", "item-1"),
        cell("cheap-1", "rm-cheap", "item-1"),
        cell("bench-2", "rm-bench", "item-2"),
        cell("cheap-2", "rm-cheap", "item-2"),
        cell("cheap-3", "rm-cheap", "item-3", "failed"),
    ];
    const scored = new Set(["bench-1", "cheap-1", "bench-2", "cheap-2"]);

    it("rescores candidates when their item's benchmark answer is regenerated", () => {
        expect(
            cellsToScore({
                cells,
                claimed: [cells[0]!],
                scoredCellIds: scored,
                referenceModelId: "rm-bench",
                benchmark: { taskMap: { tasks: [] } },
            }).map((c) => c.id),
        ).toEqual(["bench-1", "cheap-1"]);
    });

    it("scores only claimed or unscored cells otherwise", () => {
        const input = {
            cells,
            claimed: [cells[0]!],
            scoredCellIds: new Set(["bench-1", "cheap-1", "bench-2"]),
            referenceModelId: "rm-bench",
        };
        expect(
            cellsToScore({ ...input, benchmark: undefined }).map((c) => c.id),
        ).toEqual(["bench-1", "cheap-2"]);
        expect(
            cellsToScore({
                ...input,
                benchmark: { source: "labels", taskMap: { tasks: [] } },
            }).map((c) => c.id),
        ).toEqual(["bench-1", "cheap-2"]);
    });

    it("rescores when any task uses the benchmark model's answers", () => {
        const task = {
            key: "sales",
            name: "Sales",
            method: "agreement" as const,
            fields: [{ path: "$.is_sales", matcher: "exact" as const }],
        };
        expect(
            cellsToScore({
                cells,
                claimed: [cells[0]!],
                scoredCellIds: scored,
                referenceModelId: "rm-bench",
                benchmark: {
                    source: "labels",
                    taskMap: {
                        tasks: [task, { ...task, key: "b", source: "model" }],
                    },
                },
            }).map((c) => c.id),
        ).toEqual(["bench-1", "cheap-1"]);
    });
});

describe("benchmarkForCell", () => {
    const taskMap = { tasks: [] };

    it("scores today's model's own cells when the run has rule checks", () => {
        const config = {
            taskMap: {
                tasks: [
                    {
                        key: "checks",
                        name: "Checks",
                        method: "rules" as const,
                        rules: [
                            {
                                key: "a",
                                name: "A",
                                kind: "pattern_absent" as const,
                                paths: ["$.summary"],
                                patterns: ["x"],
                            },
                        ],
                    },
                ],
            },
        };
        expect(
            benchmarkForCell({
                config,
                isReference: true,
                referenceOutput: undefined,
                hasReferenceOutput: false,
                label: undefined,
            }),
        ).toEqual({ config });
    });

    it("scores today's model's own cells when the run has a rubric", () => {
        const config = {
            taskMap: {
                tasks: [
                    {
                        key: "quality",
                        name: "Quality",
                        method: "rubric" as const,
                        paths: ["$.summary"],
                        criteria: [{ key: "grounded", name: "Grounded" }],
                    },
                ],
            },
        };
        expect(
            benchmarkForCell({
                config,
                isReference: true,
                referenceOutput: undefined,
                hasReferenceOutput: false,
                label: undefined,
            }),
        ).toEqual({ config });
    });

    it("compares non-reference cells with the reference output", () => {
        const config = { taskMap };
        const base = {
            config,
            referenceOutput: { a: 1 },
            hasReferenceOutput: true,
            label: { a: 2 },
        };
        expect(benchmarkForCell({ ...base, isReference: false })).toEqual({
            config,
            modelAnswer: { a: 1 },
        });
        // A succeeded reference cell without output is an empty answer.
        expect(
            benchmarkForCell({
                ...base,
                isReference: false,
                referenceOutput: undefined,
            }),
        ).toEqual({ config, modelAnswer: {} });
        expect(
            benchmarkForCell({ ...base, isReference: true }),
        ).toBeUndefined();
        expect(
            benchmarkForCell({
                ...base,
                isReference: false,
                hasReferenceOutput: false,
            }),
        ).toBeUndefined();
        expect(
            benchmarkForCell({
                ...base,
                config: undefined,
                isReference: false,
            }),
        ).toBeUndefined();
    });

    it("compares every cell with the stored answer when labels are the benchmark", () => {
        const config = { source: "labels" as const, taskMap };
        const base = {
            config,
            isReference: false,
            referenceOutput: undefined,
            hasReferenceOutput: false,
        };
        expect(benchmarkForCell({ ...base, label: { a: 2 } })).toEqual({
            config,
            storedAnswer: { a: 2 },
        });
        expect(benchmarkForCell({ ...base, label: undefined })).toBeUndefined();
    });

    it("gives each cell the yardsticks its tasks use", () => {
        const task = {
            key: "sales",
            name: "Sales",
            method: "agreement" as const,
            fields: [{ path: "$.is_sales", matcher: "exact" as const }],
        };
        const config = {
            taskMap: {
                tasks: [task, { ...task, key: "b", source: "labels" as const }],
            },
        };
        const base = {
            config,
            referenceOutput: { a: 1 },
            hasReferenceOutput: true,
            label: { a: 2 },
        };
        expect(benchmarkForCell({ ...base, isReference: false })).toEqual({
            config,
            modelAnswer: { a: 1 },
            storedAnswer: { a: 2 },
        });
        // The reference model is scored on the stored-answer tasks only.
        expect(benchmarkForCell({ ...base, isReference: true })).toEqual({
            config,
            storedAnswer: { a: 2 },
        });
        expect(
            benchmarkForCell({
                ...base,
                isReference: true,
                label: undefined,
            }),
        ).toBeUndefined();
    });
});

describe("priorBenchmarkToKeep", () => {
    const earlier = {
        tasks: [{ key: "sales", method: "agreement" as const, error: "402" }],
    };
    const base = {
        claimed: [] as Array<{
            id: string;
            datasetItemId: string;
            runModelId: string;
        }>,
        referenceModelId: "rm-bench",
        benchmark: { taskMap: { tasks: [] } },
        toRetry: new Map([["cheap-1", earlier]]),
    };
    const cheap1 = { id: "cheap-1", datasetItemId: "item-1" };

    it("keeps earlier details for a cell scored again only because a judge failed", () => {
        expect(priorBenchmarkToKeep(cheap1, base)).toBe(earlier);
    });

    it("keeps nothing for a cell with no failed judge call", () => {
        expect(
            priorBenchmarkToKeep(
                { id: "cheap-2", datasetItemId: "item-2" },
                base,
            ),
        ).toBeUndefined();
    });

    it("keeps nothing when the cell has a new answer", () => {
        expect(
            priorBenchmarkToKeep(cheap1, {
                ...base,
                claimed: [{ ...cheap1, runModelId: "rm-cheap" }],
            }),
        ).toBeUndefined();
    });

    it("keeps nothing when the item's benchmark answer is new", () => {
        expect(
            priorBenchmarkToKeep(cheap1, {
                ...base,
                claimed: [
                    {
                        id: "bench-1",
                        datasetItemId: "item-1",
                        runModelId: "rm-bench",
                    },
                ],
            }),
        ).toBeUndefined();
    });
});

describe("paidScoresToKeep", () => {
    const row = (scorerType: string, score: number | null) => ({
        scorerType,
        score,
        detailsJson: null,
        rationale: null,
    });

    it("keeps judges that gave a score and drops failed or free ones", () => {
        expect(
            paidScoresToKeep([
                row("judge", null),
                row("transcript_judge", 0.5),
                row("field_diff", 1),
                row("benchmark", 1),
            ]),
        ).toEqual({ transcriptJudge: row("transcript_judge", 0.5) });
        expect(paidScoresToKeep([row("judge", 0)])).toEqual({
            judge: row("judge", 0),
        });
    });
});

describe("paidVerdictsStillApply", () => {
    const cell = { id: "cheap-1", datasetItemId: "item-1" };
    const claimed = (
        id: string,
        runModelId: string,
        datasetItemId: string,
    ) => ({
        id,
        runModelId,
        datasetItemId,
    });

    it("keeps verdicts for an answer and reference this pass did not regenerate", () => {
        expect(
            paidVerdictsStillApply(cell, {
                claimed: [claimed("bench-2", "rm-bench", "item-2")],
                referenceModelId: "rm-bench",
            }),
        ).toBe(true);
    });

    it("drops them when the answer or its reference is new", () => {
        expect(
            paidVerdictsStillApply(cell, {
                claimed: [claimed("cheap-1", "rm-cheap", "item-1")],
                referenceModelId: "rm-bench",
            }),
        ).toBe(false);
        expect(
            paidVerdictsStillApply(cell, {
                claimed: [claimed("bench-1", "rm-bench", "item-1")],
                referenceModelId: "rm-bench",
            }),
        ).toBe(false);
    });
});
