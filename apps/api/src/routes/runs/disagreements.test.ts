import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../../db.js";
import {
    decideDisagreementPayload,
    runDisagreementsPayload,
    withValueAtPath,
} from "./disagreements.js";

const RUN = {
    id: "run-1",
    config_snapshot: {
        benchmark: {
            source: "labels",
            taskMap: {
                tasks: [
                    {
                        key: "products",
                        name: "Products",
                        method: "agreement",
                        fields: [{ path: "$.product", matcher: "set_overlap" }],
                    },
                    {
                        key: "writeups",
                        name: "Write-ups",
                        method: "head_to_head",
                        source: "model",
                        paths: ["$.mom"],
                    },
                    {
                        key: "checks",
                        name: "Rule checks",
                        method: "rules",
                        rules: [
                            {
                                key: "labels",
                                name: "No speaker labels",
                                kind: "pattern_absent",
                                paths: ["$.mom"],
                                patterns: ["speaker \\d"],
                            },
                        ],
                    },
                ],
            },
        },
    },
};

const CELLS = [
    {
        id: "cell-1",
        dataset_item_id: "item-1",
        source_name: null,
        input_text: "transcript one",
        status: "succeeded",
        error: null,
        output_json: { product: ["Acme Salt", "Cashew"], mom: "notes A" },
        details_json: {
            tasks: [
                {
                    key: "products",
                    method: "agreement",
                    agreement: 0.5,
                    fields: [
                        {
                            path: "$.product",
                            matcher: "set_overlap",
                            score: 0.5,
                            candidate: ["Acme Salt", "Cashew"],
                            benchmark: ["Acme Salt"],
                        },
                    ],
                },
                {
                    key: "writeups",
                    method: "head_to_head",
                    verdict: "loss",
                    rationale: "B is better.",
                },
                {
                    key: "checks",
                    method: "rules",
                    agreement: 0,
                    rules: [
                        {
                            key: "labels",
                            passed: false,
                            offending: ["Speaker 1"],
                        },
                    ],
                },
            ],
        },
    },
    {
        id: "cell-2",
        dataset_item_id: "item-2",
        source_name: "call-2.txt",
        input_text: "transcript two",
        status: "succeeded",
        error: null,
        output_json: { product: ["Acme Tea"] },
        details_json: {
            tasks: [
                {
                    key: "products",
                    method: "agreement",
                    agreement: 1,
                    fields: [
                        {
                            path: "$.product",
                            matcher: "set_overlap",
                            score: 1,
                            candidate: ["Acme Tea"],
                            benchmark: ["Acme Tea"],
                        },
                    ],
                },
            ],
        },
    },
    {
        id: "cell-3",
        dataset_item_id: "item-3",
        source_name: null,
        input_text: "transcript three",
        status: "failed",
        error: "timeout",
        output_json: null,
        details_json: null,
    },
];

function fakeDb(
    extra: (sql: string) => unknown[] | undefined = () => undefined,
) {
    const query = vi.fn(async (sql: string) => {
        const rows = extra(sql);
        if (rows) return { rows };
        if (sql.includes("from runs")) return { rows: [RUN] };
        if (sql.includes("from run_models"))
            return {
                rows: [
                    {
                        id: "rm-cand",
                        model_id: "gpt-6-luna",
                        is_reference: false,
                    },
                    { id: "rm-ref", model_id: "sonnet", is_reference: true },
                ],
            };
        if (sql.includes("from run_cells c")) return { rows: CELLS };
        if (sql.includes("from labels"))
            return {
                rows: [
                    {
                        dataset_item_id: "item-1",
                        label_json: { product: ["Acme Salt"] },
                    },
                ],
            };
        if (sql.includes("from label_corrections")) return { rows: [] };
        if (sql.includes("from run_cells"))
            return {
                rows: [
                    {
                        dataset_item_id: "item-1",
                        output_json: { mom: "notes B" },
                    },
                ],
            };
        return { rows: [] };
    });
    return { query } as unknown as IDb & {
        query: typeof query;
    };
}

const SCOPE = { teamId: "t", projectId: "p", runId: "run-1" };

describe("runDisagreementsPayload", () => {
    it("lists the transcripts whose fields differ, plus failed answers", async () => {
        const result = await runDisagreementsPayload(fakeDb(), {
            ...SCOPE,
            runModelId: "rm-cand",
            taskKey: "products",
        });
        expect(result).toMatchObject({
            modelId: "gpt-6-luna",
            taskName: "Products",
            yardstick: "labels",
            compared: 3,
        });
        expect(result.disagreements.map((item) => item.cellId)).toEqual([
            "cell-1",
            "cell-3",
        ]);
        expect(result.disagreements[0]!.fields).toEqual([
            {
                path: "$.product",
                matcher: "set_overlap",
                score: 0.5,
                candidate: ["Acme Salt", "Cashew"],
                benchmark: ["Acme Salt"],
                storedNow: ["Acme Salt"],
            },
        ]);
        expect(result.disagreements[1]).toMatchObject({
            failed: true,
            error: "timeout",
        });
    });

    it("shows judged losses with both answers and which letter was the model", async () => {
        const result = await runDisagreementsPayload(fakeDb(), {
            ...SCOPE,
            runModelId: "rm-cand",
            taskKey: "writeups",
        });
        expect(result.yardstick).toBe("model");
        expect(result.disagreements[0]).toMatchObject({
            cellId: "cell-1",
            rationale: "B is better.",
            candidateAnswer: { "$.mom": "notes A" },
            benchmarkAnswer: { "$.mom": "notes B" },
        });
        expect(["A", "B"]).toContain(result.disagreements[0]!.candidateLetter);
    });
});

describe("runDisagreementsPayload on a judged stored-answer task", () => {
    it("shows the stored answer the judge used, not the reference model's", async () => {
        const labelsRun = structuredClone(RUN);
        labelsRun.config_snapshot.benchmark.taskMap.tasks[1]!.source = "labels";
        const result = await runDisagreementsPayload(
            fakeDb((sql) => {
                if (sql.includes("from runs")) return [labelsRun];
                if (sql.includes("from labels"))
                    return [
                        {
                            dataset_item_id: "item-1",
                            label_json: { mom: "stored notes" },
                        },
                    ];
                return undefined;
            }),
            { ...SCOPE, runModelId: "rm-cand", taskKey: "writeups" },
        );
        expect(result.yardstick).toBe("labels");
        expect(result.disagreements[0]).toMatchObject({
            cellId: "cell-1",
            candidateAnswer: { "$.mom": "notes A" },
            benchmarkAnswer: { "$.mom": "stored notes" },
        });
    });
});

describe("runDisagreementsPayload with rule checks", () => {
    it("lists the answers that broke a check and what broke it", async () => {
        const result = await runDisagreementsPayload(fakeDb(), {
            ...SCOPE,
            runModelId: "rm-cand",
            taskKey: "checks",
        });
        expect(result.method).toBe("rules");
        expect(result.disagreements.map((item) => item.cellId)).toEqual([
            "cell-1",
            "cell-3",
        ]);
        expect(result.disagreements[0]!.brokenRules).toEqual([
            {
                key: "labels",
                name: "No speaker labels",
                offending: ["Speaker 1"],
            },
        ]);
    });
});

describe("runDisagreementsPayload on a rubric", () => {
    const rubricRun = {
        id: "run-1",
        config_snapshot: {
            benchmark: {
                taskMap: {
                    tasks: [
                        {
                            key: "quality",
                            name: "Quality",
                            method: "rubric",
                            paths: ["$.mom"],
                            criteria: [
                                { key: "grounded", name: "Grounded" },
                                { key: "numbers", name: "Numbers right" },
                            ],
                        },
                    ],
                },
            },
        },
    };
    const scored = (grounded: number, numbers: number) => ({
        tasks: [
            {
                key: "quality",
                method: "rubric",
                criteria: [
                    { key: "grounded", score: grounded, reasoning: "ok" },
                    { key: "numbers", score: numbers },
                ],
            },
        ],
    });
    const cell = (id: string, item: string, details: unknown) => ({
        id,
        dataset_item_id: item,
        source_name: null,
        input_text: `transcript ${item}`,
        status: "succeeded",
        error: null,
        output_json: { mom: `notes ${id}` },
        details_json: details,
    });
    const db = () =>
        fakeDb((sql) => {
            if (sql.includes("from runs")) return [rubricRun];
            // Today's model's scores on the same transcripts.
            if (sql.includes("inner join cell_scores"))
                return [
                    { dataset_item_id: "item-1", details_json: scored(5, 4) },
                    { dataset_item_id: "item-2", details_json: scored(4, 4) },
                ];
            if (sql.includes("left join cell_scores"))
                return [
                    // Below today's model on grounded.
                    cell("cell-1", "item-1", scored(4, 4)),
                    // As good on both: not listed.
                    cell("cell-2", "item-2", scored(4, 5)),
                    // No reference score: listed only for a score of 2 or less.
                    cell("cell-3", "item-3", scored(2, 5)),
                    // The judge failed.
                    cell("cell-4", "item-4", {
                        tasks: [
                            {
                                key: "quality",
                                method: "rubric",
                                error: "timeout",
                            },
                        ],
                    }),
                ];
            return undefined;
        });

    it("lists the transcripts scored below today's model, with both scores", async () => {
        const result = await runDisagreementsPayload(db(), {
            ...SCOPE,
            runModelId: "rm-cand",
            taskKey: "quality",
        });
        expect(result.method).toBe("rubric");
        expect(result.compared).toBe(4);
        expect(result.disagreements.map((item) => item.cellId)).toEqual([
            "cell-1",
            "cell-3",
            "cell-4",
        ]);
        expect(result.disagreements[0]!.criterionScores).toEqual([
            {
                key: "grounded",
                name: "Grounded",
                score: 4,
                referenceScore: 5,
                reasoning: "ok",
            },
            {
                key: "numbers",
                name: "Numbers right",
                score: 4,
                referenceScore: 4,
            },
        ]);
        expect(result.disagreements[0]!.candidateAnswer).toEqual({
            "$.mom": "notes cell-1",
        });
        expect(result.disagreements[0]!.benchmarkAnswer).toEqual({
            "$.mom": "notes B",
        });
        expect(result.disagreements[2]!.error).toBe("timeout");
    });
});

describe("decideDisagreementPayload", () => {
    it("writes the chosen value into the stored answer and logs the change", async () => {
        const writes: Array<[string, unknown[]]> = [];
        const db = fakeDb((sql) => {
            if (sql.includes("left join cell_scores"))
                return [
                    {
                        dataset_item_id: "item-1",
                        details_json: CELLS[0]!.details_json,
                    },
                ];
            return undefined;
        });
        const tx = {
            query: vi.fn(async (sql: string, params: unknown[]) => {
                writes.push([sql, params]);
                return sql.includes("for update")
                    ? {
                          rows: [
                              {
                                  label_json: {
                                      domain: "Sales",
                                      product: ["Acme Salt"],
                                  },
                              },
                          ],
                      }
                    : { rows: [] };
            }),
        };
        Object.assign(db, {
            transaction: (run: (inner: typeof tx) => Promise<unknown>) =>
                run(tx),
        });
        const result = await decideDisagreementPayload(db, {
            ...SCOPE,
            cellId: "cell-1",
            taskKey: "products",
            path: "$.product",
            choice: "candidate",
            decidedBy: "user-1",
        });
        expect(result).toEqual({
            itemId: "item-1",
            path: "$.product",
            newValue: ["Acme Salt", "Cashew"],
        });
        const label = writes.find(([sql]) =>
            sql.includes("insert into labels"),
        );
        expect(JSON.parse(label![1][1] as string)).toEqual({
            domain: "Sales",
            product: ["Acme Salt", "Cashew"],
        });
        const log = writes.find(([sql]) => sql.includes("label_corrections"));
        expect(log![1]).toEqual([
            "item-1",
            "$.product",
            JSON.stringify(["Acme Salt"]),
            JSON.stringify(["Acme Salt", "Cashew"]),
            "candidate",
            "products",
            "cell-1",
            "user-1",
        ]);
    });

    it("refuses judged tasks and unknown fields", async () => {
        await expect(
            decideDisagreementPayload(fakeDb(), {
                ...SCOPE,
                cellId: "cell-1",
                taskKey: "writeups",
                path: "$.mom",
                choice: "candidate",
                decidedBy: "u",
            }),
        ).rejects.toThrow("Only tasks compared field by field");
        await expect(
            decideDisagreementPayload(
                fakeDb((sql) =>
                    sql.includes("left join cell_scores")
                        ? [
                              {
                                  dataset_item_id: "item-1",
                                  details_json: CELLS[0]!.details_json,
                              },
                          ]
                        : undefined,
                ),
                {
                    ...SCOPE,
                    cellId: "cell-1",
                    taskKey: "products",
                    path: "$.competitors",
                    choice: "candidate",
                    decidedBy: "u",
                },
            ),
        ).rejects.toThrow("no compared value for $.competitors");
    });
});

describe("withValueAtPath", () => {
    it("sets nested values without touching the rest", () => {
        expect(
            withValueAtPath(
                { a: 1, customer: { name: "x" } },
                "$.customer.type",
                "Retailer",
            ),
        ).toEqual({ a: 1, customer: { name: "x", type: "Retailer" } });
        expect(withValueAtPath(undefined, "$.domain", "Sales")).toEqual({
            domain: "Sales",
        });
    });

    it("refuses paths that could reach object internals", () => {
        expect(() => withValueAtPath({}, "$.__proto__.x", 1)).toThrow();
    });
});
