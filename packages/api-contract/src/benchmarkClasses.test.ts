import { describe, expect, it } from "vitest";
import {
    summarizeBenchmarkComparison,
    type IBenchmarkCellInput,
    type ITaskMap,
} from "./benchmark.js";

describe("per-class results for classification tasks", () => {
    const taskMap: ITaskMap = {
        tasks: [
            {
                key: "call_type",
                name: "Call type",
                method: "agreement",
                fields: [{ path: "$.call_type", matcher: "exact" }],
            },
        ],
    };
    const cell = (
        item: string,
        truth: unknown,
        answer: unknown,
        succeeded = true,
    ): IBenchmarkCellInput => ({
        runModelId: "rm-cand",
        datasetItemId: item,
        succeeded,
        costUsd: 0.01,
        latencyMs: 500,
        details: {
            tasks: [
                {
                    key: "call_type",
                    method: "agreement",
                    agreement: truth === answer ? 1 : 0,
                    fields: [
                        {
                            path: "$.call_type",
                            matcher: "exact",
                            score: truth === answer ? 1 : 0,
                            candidate: answer,
                            benchmark: truth,
                        },
                    ],
                },
            ],
        },
    });
    const summarize = (cells: IBenchmarkCellInput[], map = taskMap) =>
        summarizeBenchmarkComparison({
            taskMap: map,
            models: [{ id: "rm-cand", modelId: "cheap", isBenchmark: false }],
            cells,
            labeledItemIds: cells.map((entry) => entry.datasetItemId),
        })[0]!.tasks[0]!;

    it("counts, for each true label, the items kept and missed and what was said instead", () => {
        const cells = [
            cell("i1", "sales", "sales"),
            cell("i2", "sales", "sales"),
            cell("i3", "sales", "service"),
            cell("i4", "sales", "other"),
            cell("i5", "sales", "service"),
            cell("i6", "service", "service"),
            cell("i7", "service", "sales"),
            cell("i8", "other", "other"),
            // A failed item has no answer to place in a class.
            cell("i9", "sales", undefined, false),
        ];
        expect(summarize(cells).classes).toEqual([
            {
                label: "sales",
                total: 5,
                correct: 2,
                missed: 3,
                recall: 0.4,
                wronglyGiven: 1,
                confusions: [
                    { predicted: "service", count: 2 },
                    { predicted: "other", count: 1 },
                ],
            },
            {
                label: "service",
                total: 2,
                correct: 1,
                missed: 1,
                recall: 0.5,
                wronglyGiven: 2,
                confusions: [{ predicted: "sales", count: 1 }],
            },
            {
                label: "other",
                total: 1,
                correct: 1,
                missed: 0,
                recall: 1,
                wronglyGiven: 1,
                confusions: [],
            },
        ]);
    });

    it("labels booleans and missing answers as text", () => {
        const classes = summarize([
            cell("i1", true, true),
            cell("i2", true, null),
        ]).classes;
        expect(classes).toEqual([
            expect.objectContaining({
                label: "true",
                total: 2,
                correct: 1,
                confusions: [{ predicted: "(empty)", count: 1 }],
            }),
        ]);
    });

    it("leaves out free text with many distinct values and non-exact matchers", () => {
        const many = Array.from({ length: 21 }, (_, index) =>
            cell(`i${index}`, `label ${index}`, `label ${index}`),
        );
        expect(summarize(many).classes).toBeUndefined();
        const overlap: ITaskMap = {
            tasks: [
                {
                    key: "call_type",
                    name: "Call type",
                    method: "agreement",
                    fields: [{ path: "$.call_type", matcher: "set_overlap" }],
                },
            ],
        };
        expect(
            summarize([cell("i1", "sales", "sales")], overlap).classes,
        ).toBeUndefined();
    });

    describe("labels grouped as scoring compares them", () => {
        // Scored as the scorer does: trimmed, ignoring case, aliases applied.
        const scoredCell = (
            item: string,
            truth: string,
            answer: string,
            score: number,
        ): IBenchmarkCellInput => {
            const base = cell(item, truth, answer);
            const task = base.details!.tasks[0]!;
            task.agreement = score;
            task.fields![0]!.score = score;
            return base;
        };

        it("puts case and space variants on one row, spelled as a stored answer is", () => {
            const classes = summarize([
                scoredCell("i1", "Sales", "sales", 1),
                scoredCell("i2", "sales", "sales", 1),
                scoredCell("i3", "support", "Sales", 0),
                scoredCell("i4", "support", " sales", 0),
            ]).classes;
            expect(classes).toEqual([
                {
                    label: "Sales",
                    total: 2,
                    correct: 2,
                    missed: 0,
                    recall: 1,
                    wronglyGiven: 2,
                    confusions: [],
                },
                {
                    label: "support",
                    total: 2,
                    correct: 0,
                    missed: 2,
                    recall: 0,
                    wronglyGiven: 0,
                    confusions: [{ predicted: "Sales", count: 2 }],
                },
            ]);
        });

        it("counts an alias answer on its label's row", () => {
            const aliased: ITaskMap = {
                tasks: [
                    {
                        ...taskMap.tasks[0]!,
                        textMatching: { aliases: { sales: ["revenue"] } },
                    } as ITaskMap["tasks"][number],
                ],
            };
            const classes = summarize(
                [
                    scoredCell("i1", "sales", "Revenue", 1),
                    scoredCell("i2", "support", "revenue", 0),
                    scoredCell("i3", "support", "support", 1),
                ],
                aliased,
            ).classes;
            expect(classes).toEqual([
                expect.objectContaining({
                    label: "support",
                    total: 2,
                    correct: 1,
                    confusions: [{ predicted: "sales", count: 1 }],
                }),
                expect.objectContaining({
                    label: "sales",
                    total: 1,
                    correct: 1,
                    wronglyGiven: 1,
                }),
            ]);
        });

        it("doesn't spend the label limit on case variants", () => {
            // 25 spellings of one label: trailing spaces.
            const variants = Array.from({ length: 27 }, (_, index) =>
                scoredCell(
                    `i${index}`,
                    `sales${" ".repeat(Math.max(0, index - 2))}`,
                    "sales",
                    1,
                ),
            );
            expect(summarize(variants).classes).toEqual([
                expect.objectContaining({ label: "sales", total: 27 }),
            ]);
        });
    });

    it("leaves out only an item whose answer is a list or object, and counts it", () => {
        const result = summarize([
            cell("i1", "sales", "sales"),
            cell("i2", "sales", ["sales", "service"]),
            cell("i3", "service", { label: "service" }),
            cell("i4", "service", "sales"),
        ]);
        expect(result.classes).toEqual([
            expect.objectContaining({ label: "sales", total: 1, correct: 1 }),
            expect.objectContaining({ label: "service", total: 1, correct: 0 }),
        ]);
        expect(result.classesSkipped).toBe(2);
        expect(
            summarize([cell("i1", "sales", "sales")]).classesSkipped,
        ).toBeUndefined();
    });
});
