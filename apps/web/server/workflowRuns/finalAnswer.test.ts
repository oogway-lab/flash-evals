import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    inserted: [] as Array<Record<string, unknown>>,
    updates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../db/client", () => ({
    db: {
        insert: vi.fn(() => ({
            values: vi.fn((values: Record<string, unknown>) => {
                mocks.inserted.push(values);
                return {
                    onConflictDoUpdate: vi.fn(
                        async (config: { set: Record<string, unknown> }) => {
                            mocks.updates.push(config.set);
                        },
                    ),
                };
            }),
        })),
    },
}));

import { finalAnswerForItem, recordFinalAnswers } from "./finalAnswer";

const finalAnswer = {
    fields: [
        { path: "$.product", stepKey: "extract", stepPath: "$.product" },
        { path: "$.is_sales", stepKey: "extract", stepPath: "$.is_sales" },
        { path: "$.mom", stepKey: "notes", stepPath: "$.mom" },
    ],
    schema: {
        digest: "sha256:test",
        schema: {
            type: "object",
            properties: {
                product: { type: "string" },
                is_sales: { type: "boolean" },
                mom: { type: "string" },
            },
            required: ["product", "is_sales", "mom"],
            additionalProperties: false,
        },
    },
};

function cell(
    nodeKey: string,
    status: string,
    outputJson: Record<string, unknown> | null,
    costUsd: number | null,
) {
    return {
        nodeKey,
        status,
        outputJson,
        costUsd,
        latencyMs: costUsd === null ? null : 100,
    } as Parameters<typeof finalAnswerForItem>[1][number];
}

beforeEach(() => {
    mocks.inserted = [];
    mocks.updates = [];
});

describe("finalAnswerForItem", () => {
    it("combines steps 1 and 3 into one answer that matches the schema", () => {
        expect(
            finalAnswerForItem(finalAnswer, [
                cell("input", "succeeded", { text: "call" }, null),
                cell(
                    "extract",
                    "succeeded",
                    { text: "", json: { product: "crisps", is_sales: true } },
                    0.001,
                ),
                cell("points", "succeeded", { text: "price, stock" }, 0.002),
                cell(
                    "notes",
                    "succeeded",
                    { text: '{"mom":"Agreed."}' },
                    0.003,
                ),
            ]),
        ).toEqual({
            answer: { product: "crisps", is_sales: true, mom: "Agreed." },
            status: "complete",
            costUsd: 0.006,
            latencyMs: 300,
        });
    });

    it("leaves out skipped steps' fields, costs them nothing and reports the schema gap", () => {
        const result = finalAnswerForItem(finalAnswer, [
            cell(
                "extract",
                "succeeded",
                { text: "", json: { product: "crisps", is_sales: false } },
                0.001,
            ),
            cell("points", "skipped", { text: "", skipReason: "x" }, 0),
            cell("notes", "skipped", { text: "", skipReason: "x" }, 0),
        ]);
        expect(result).toMatchObject({
            answer: { product: "crisps", is_sales: false },
            status: "complete",
            costUsd: 0.001,
        });
        expect(result?.schemaErrors?.[0]?.message).toMatch(/mom/);
    });

    it("completes a skipped step's field from its fallback, naming steps by label", () => {
        const result = finalAnswerForItem(
            {
                ...finalAnswer,
                fields: finalAnswer.fields.map((field) =>
                    field.path === "$.mom"
                        ? {
                              ...field,
                              fallback: {
                                  template:
                                      "Not a sales call: {{Extract.$.product}}",
                              },
                          }
                        : field,
                ),
            },
            [
                cell(
                    "extract",
                    "succeeded",
                    { text: "", json: { product: "crisps", is_sales: false } },
                    0.001,
                ),
                cell("points", "skipped", { text: "", skipReason: "x" }, 0),
                cell("notes", "skipped", { text: "", skipReason: "x" }, 0),
            ],
            new Map([["extract", "Extract"]]),
        );
        expect(result).toMatchObject({
            answer: {
                product: "crisps",
                is_sales: false,
                mom: "Not a sales call: crisps",
            },
            status: "complete",
        });
        expect(result?.schemaErrors).toBeUndefined();
    });

    it("marks an item with a failed step and waits while steps are pending", () => {
        expect(
            finalAnswerForItem(finalAnswer, [
                cell("extract", "failed", null, null),
            ])?.status,
        ).toBe("failed");
        expect(
            finalAnswerForItem(finalAnswer, [
                cell("extract", "pending", null, null),
            ]),
        ).toBeUndefined();
    });

    it("keeps an answer complete when only a scoring step failed, and leaves scoring cost out", () => {
        const result = finalAnswerForItem(
            finalAnswer,
            [
                cell(
                    "extract",
                    "succeeded",
                    { text: "", json: { product: "crisps", is_sales: true } },
                    0.001,
                ),
                cell(
                    "notes",
                    "succeeded",
                    { text: '{"mom":"Agreed."}' },
                    0.003,
                ),
                cell("grade", "failed", null, 0.05),
            ],
            new Map(),
            new Set(["grade"]),
        );
        expect(result).toMatchObject({
            status: "complete",
            costUsd: 0.004,
            latencyMs: 200,
        });
    });

    it("treats steps named in fallbacks, and scoring steps the answer reads, as answer steps", () => {
        const withFallback = {
            ...finalAnswer,
            fields: finalAnswer.fields.map((field) =>
                field.path === "$.mom"
                    ? {
                          ...field,
                          fallback: {
                              template: "Summary: {{Summarise.$.text}}",
                          },
                      }
                    : field,
            ),
        };
        // The fallback's step failed: the answer it fills is not complete.
        expect(
            finalAnswerForItem(
                withFallback,
                [
                    cell(
                        "extract",
                        "succeeded",
                        { text: "", json: { product: "x", is_sales: false } },
                        0.001,
                    ),
                    cell("notes", "skipped", { text: "", skipReason: "x" }, 0),
                    cell("summarise", "failed", null, null),
                ],
                new Map([["summarise", "Summarise"]]),
            )?.status,
        ).toBe("failed");
        // A field read straight from a judge step: its cost is the answer's.
        const fromJudge = finalAnswerForItem(
            {
                fields: [
                    { path: "$.grade", stepKey: "grade", stepPath: "$.score" },
                    {
                        path: "$.product",
                        stepKey: "extract",
                        stepPath: "$.product",
                    },
                ],
            },
            [
                cell(
                    "extract",
                    "succeeded",
                    { text: "", json: { product: "x" } },
                    0.001,
                ),
                cell(
                    "grade",
                    "succeeded",
                    { text: "", json: { score: 4 } },
                    0.05,
                ),
                cell("other-judge", "succeeded", { text: "" }, 0.5),
            ],
            new Map(),
            new Set(["grade", "other-judge"]),
        );
        expect(fromJudge?.costUsd).toBeCloseTo(0.051);
    });

    it("fails an answer when a step one of its rules checks failed", () => {
        expect(
            finalAnswerForItem(
                {
                    ...finalAnswer,
                    fields: [
                        {
                            path: "$.archived",
                            stepKey: "extract",
                            stepPath: "$.is_sales",
                            setWhen: [
                                {
                                    when: {
                                        stepKey: "classify",
                                        path: "$.type",
                                        operator: "equals" as const,
                                        values: ["non-sales"],
                                    },
                                    value: true,
                                },
                            ],
                        },
                    ],
                },
                [
                    cell(
                        "extract",
                        "succeeded",
                        { text: "", json: { is_sales: true } },
                        0.001,
                    ),
                    cell("classify", "failed", null, null),
                    cell("unused", "failed", null, null),
                ],
            )?.status,
        ).toBe("failed");
    });
});

describe("recordFinalAnswers", () => {
    it("upserts one row per finished item and nothing without a mapping", async () => {
        const cells = [
            {
                ...cell(
                    "extract",
                    "succeeded",
                    { text: "", json: { product: "a", is_sales: false } },
                    0.001,
                ),
                datasetItemId: "item-1",
            },
            {
                ...cell("extract", "running", null, null),
                datasetItemId: "item-2",
            },
        ];
        await recordFinalAnswers({
            workflowRunId: "run-1",
            snapshot: {
                workflowId: "w",
                name: "w",
                nodes: [],
                edges: [],
            },
            cells,
        });
        expect(mocks.inserted).toEqual([]);
        await recordFinalAnswers({
            workflowRunId: "run-1",
            snapshot: {
                workflowId: "w",
                name: "w",
                nodes: [],
                edges: [],
                finalAnswer,
            },
            cells,
        });
        expect(mocks.inserted).toHaveLength(1);
        expect(mocks.inserted[0]).toMatchObject({
            workflowRunId: "run-1",
            datasetItemId: "item-1",
            status: "complete",
            answer: { product: "a", is_sales: false },
            costUsd: 0.001,
        });
        expect(mocks.updates[0]).toHaveProperty("updatedAt");
        // A changed answer loses its comparison score so it is scored again.
        for (const column of [
            "benchmarkScore",
            "benchmarkDetails",
            "benchmarkScoredAt",
        ])
            expect(mocks.updates[0]).toHaveProperty(column);
    });
});
