import { describe, expect, it, vi } from "vitest";
import type {
    IPipelineComparisonConfig,
    IWorkflowRunAnswer,
} from "@flash-evals/api-contract";
import type { IDb } from "../db.js";
import {
    listPipelineComparisonRunsPayload,
    pipelineComparisonPayload,
} from "./workflowRunComparison.js";
import {
    createWorkflowRunInTransaction,
    createWorkflowRunPayload,
} from "./workflowRuns.js";
import {
    COMPARISON_BENCHMARK,
    COMPARISON_RUN,
    COMPARISON_RUN_ID,
    createRunDb,
    createRunInput,
} from "./workflowRuns.testFixture.js";

// Made-up snack-sales extraction; not client data.
const CONFIG: IPipelineComparisonConfig = {
    runId: "eval-run-1",
    benchmark: {
        source: "model",
        taskMap: {
            tasks: [
                {
                    key: "products",
                    name: "Products",
                    method: "agreement",
                    fields: [{ path: "$.products", matcher: "set_overlap" }],
                },
            ],
        },
    },
    referenceRunModelId: "rm-ref",
    referenceModelId: "openai/big-model",
};

function routingDb(routes: Array<[string, unknown[]]>): IDb {
    return {
        query: vi.fn(async (text: string) => {
            const sql = text.replace(/\s+/g, " ");
            const match = routes.find(([fragment]) => sql.includes(fragment));
            return { rows: match?.[1] ?? [] } as never;
        }),
    };
}

const answers: IWorkflowRunAnswer[] = [
    {
        datasetItemId: "item-1",
        status: "complete",
        costUsd: 0.001,
        latencyMs: 300,
        benchmarkDetails: {
            tasks: [{ key: "products", method: "agreement", agreement: 1 }],
        },
    },
    { datasetItemId: "item-2", status: "failed", costUsd: 0.0005 },
    // Recorded but not scored yet.
    { datasetItemId: "item-3", status: "complete", costUsd: 0.001 },
];

describe("pipelineComparisonPayload", () => {
    it("is absent on a run not compared with an eval run", async () => {
        const db = routingDb([]);
        await expect(
            pipelineComparisonPayload(db, {
                teamId: "team-1",
                projectId: "project-1",
                pipelineName: "Acme chain",
                config: {},
                answers,
                scoredItemIds: new Set(),
            }),
        ).resolves.toBeUndefined();
        expect(db.query).not.toHaveBeenCalled();
    });

    it("compares the final answers with the reference's cells in the eval run", async () => {
        const db = routingDb([
            [
                "from runs r where r.id = $1",
                [
                    {
                        id: "eval-run-1",
                        status: "completed",
                        createdAt: new Date("2026-11-01T00:00:00.000Z"),
                        noteTitle: "Acme baseline",
                    },
                ],
            ],
            [
                "select distinct dataset_item_id",
                [
                    { datasetItemId: "item-1" },
                    { datasetItemId: "item-2" },
                    { datasetItemId: "item-3" },
                ],
            ],
            [
                "left join cell_scores s",
                ["item-1", "item-2", "item-3"].map((datasetItemId) => ({
                    datasetItemId,
                    status: "succeeded",
                    costUsd: "0.004",
                    latencyMs: 1200,
                    details: null,
                })),
            ],
        ]);

        const comparison = await pipelineComparisonPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            pipelineName: "Acme chain",
            config: { comparison: CONFIG },
            answers,
            scoredItemIds: new Set(["item-1"]),
        });

        expect(comparison).toMatchObject({
            run: {
                id: "eval-run-1",
                status: "completed",
                createdAt: "2026-11-01T00:00:00.000Z",
                noteTitle: "Acme baseline",
            },
            benchmark: CONFIG.benchmark,
            referenceRunModelId: "rm-ref",
            comparedItems: 2,
            failedItems: 1,
            unscoredItems: 1,
            referenceCostPerItem: 0.004,
        });
        const pipeline = comparison!.summary.find(
            (row) => row.runModelId === comparison!.pipelineRunModelId,
        )!;
        expect(pipeline).toMatchObject({
            modelId: "Acme chain",
            comparableItems: 2,
            failedItems: 1,
            agreement: 0.5,
        });
        expect(pipeline.relativeCost).toBeCloseTo(0.0015 / 0.008);
        expect(
            comparison!.summary.find((row) => row.runModelId === "rm-ref"),
        ).toMatchObject({ isBenchmark: true, isReference: true });
    });

    it("keeps the run id when the eval run has been deleted", async () => {
        const comparison = await pipelineComparisonPayload(routingDb([]), {
            teamId: "team-1",
            projectId: "project-1",
            pipelineName: "Acme chain",
            config: { comparison: CONFIG },
            answers,
            scoredItemIds: new Set(["item-1"]),
        });
        expect(comparison?.run).toEqual({ id: "eval-run-1" });
        expect(comparison?.comparedItems).toBe(0);
    });
});

describe("listPipelineComparisonRunsPayload", () => {
    it("returns nothing for a dataset id that is not a UUID", async () => {
        const db = routingDb([]);
        await expect(
            listPipelineComparisonRunsPayload(db, "team-1", "project-1", "x"),
        ).resolves.toEqual([]);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("leaves out runs whose tasks need a reference model they lack", async () => {
        const db = routingDb([
            [
                "from runs r",
                [
                    {
                        id: "run-a",
                        datasetId: "dataset-1",
                        status: "partial",
                        createdAt: "2026-11-02T00:00:00.000Z",
                        configSnapshot: { benchmark: CONFIG.benchmark },
                        noteTitle: null,
                        referenceRunModelId: null,
                        referenceModelId: null,
                    },
                    {
                        id: "run-b",
                        datasetId: "dataset-1",
                        status: "partial",
                        createdAt: "2026-11-01T00:00:00.000Z",
                        configSnapshot: {
                            benchmark: {
                                ...CONFIG.benchmark,
                                source: "labels",
                            },
                        },
                        noteTitle: null,
                        referenceRunModelId: null,
                        referenceModelId: null,
                    },
                ],
            ],
        ]);
        await expect(
            listPipelineComparisonRunsPayload(db, "team-1", "project-1"),
        ).resolves.toEqual([
            {
                id: "run-b",
                datasetId: "dataset-1",
                status: "partial",
                createdAt: "2026-11-01T00:00:00.000Z",
                taskCount: 1,
            },
        ]);
    });
});

describe("creating a setup comparison's pipeline run", () => {
    it("compares with its own eval run before it finishes, on that run's items", async () => {
        const fixture = createRunDb({
            finalAnswer: true,
            comparisonRun: { ...COMPARISON_RUN, status: "pending" },
        });

        await fixture.db.transaction((tx) =>
            createWorkflowRunInTransaction(
                tx,
                { ...createRunInput, compareWithRunId: COMPARISON_RUN_ID },
                undefined,
                {
                    setupComparisonId: "comparison-1",
                    itemIds: ["item-1"],
                },
            ),
        );

        const insert = fixture.committedWrites.find(({ sql }) =>
            sql.includes("insert into workflow_runs"),
        );
        expect(insert?.values[12]).toBe("comparison-1");
        expect(insert?.values[11]).toMatchObject({
            comparison: { runId: COMPARISON_RUN_ID },
        });
        const items = fixture.query.mock.calls.find(([sql]) =>
            String(sql).includes("from dataset_items"),
        );
        expect(items?.[1]?.[2]).toEqual(["item-1"]);
    });
});

describe("creating a pipeline run compared with an eval run", () => {
    it("captures the compared eval run's Task Map, policy, judge and rules", async () => {
        const fixture = createRunDb({
            finalAnswer: true,
            comparisonRun: COMPARISON_RUN,
        });

        await createWorkflowRunPayload(fixture.db, {
            ...createRunInput,
            dataPolicy: { onlyHosts: ["openai", "azure"] },
            compareWithRunId: COMPARISON_RUN_ID,
        });

        const insert = fixture.committedWrites.find(({ sql }) =>
            sql.includes("insert into workflow_runs"),
        );
        expect(insert?.values[11]).toEqual({
            dataPolicy: { onlyHosts: ["openai", "azure"] },
            comparison: {
                runId: COMPARISON_RUN_ID,
                benchmark: COMPARISON_BENCHMARK,
                referenceRunModelId: "rm-ref",
                referenceModelId: "openai/big-model",
                dataPolicy: {
                    onlyHosts: ["azure", "bedrock"],
                    zeroDataRetention: true,
                },
                // Hosts both allow; every stricter rule.
                judgeDataPolicy: {
                    onlyHosts: ["azure"],
                    zeroDataRetention: true,
                },
                maxTokens: 4000,
            },
        });
    });

    it.each([
        [
            "a pipeline without a final answer",
            { comparisonRun: undefined, finalAnswer: false },
            /no final answer/,
        ],
        [
            "a run outside the project",
            { comparisonRun: undefined, finalAnswer: true },
            /isn't in this project/,
        ],
        [
            "a run on another dataset",
            {
                comparisonRun: { datasetId: "other-dataset" },
                finalAnswer: true,
            },
            /different dataset/,
        ],
        [
            "a run that hasn't finished",
            { comparisonRun: { status: "running" }, finalAnswer: true },
            /hasn't finished/,
        ],
        [
            "a cancelled run",
            { comparisonRun: { status: "cancelled" }, finalAnswer: true },
            /hasn't finished/,
        ],
        [
            "a run without a benchmark",
            { comparisonRun: { configSnapshot: {} }, finalAnswer: true },
            /no benchmark Task Map/,
        ],
        [
            "a run without the reference model its tasks compare with",
            {
                comparisonRun: { referenceRunModelId: null },
                finalAnswer: true,
            },
            /no reference model/,
        ],
    ])("refuses to compare with %s", async (_, options, message) => {
        const fixture = createRunDb({
            finalAnswer: options.finalAnswer,
            ...(options.comparisonRun
                ? {
                      comparisonRun: {
                          ...COMPARISON_RUN,
                          ...options.comparisonRun,
                      },
                  }
                : {}),
        });

        await expect(
            createWorkflowRunPayload(fixture.db, {
                ...createRunInput,
                compareWithRunId: COMPARISON_RUN_ID,
            }),
        ).rejects.toThrow(message);
        expect(fixture.committedWrites).toEqual([]);
    });

    it("refuses data rules that leave the judge no host", async () => {
        const fixture = createRunDb({
            finalAnswer: true,
            comparisonRun: COMPARISON_RUN,
        });

        await expect(
            createWorkflowRunPayload(fixture.db, {
                ...createRunInput,
                dataPolicy: { onlyHosts: ["openai"] },
                compareWithRunId: COMPARISON_RUN_ID,
            }),
        ).rejects.toThrow(/none in common/);
    });

    it("refuses combined data rules the compared run's judge can't follow", async () => {
        const fixture = createRunDb({
            finalAnswer: true,
            comparisonRun: {
                ...COMPARISON_RUN,
                configSnapshot: {
                    benchmark: {
                        ...COMPARISON_BENCHMARK,
                        judge: {
                            modelId: "anthropic/claude-judge",
                            transport: "anthropic",
                        },
                    },
                    dataPolicy: { onlyHosts: ["anthropic"] },
                },
            },
        });

        await expect(
            createWorkflowRunPayload(fixture.db, {
                ...createRunInput,
                dataPolicy: {
                    onlyHosts: ["openai", "anthropic"],
                    zeroDataRetention: true,
                },
                compareWithRunId: COMPARISON_RUN_ID,
            }),
        ).rejects.toThrow(/can only follow an allowed-host list/);
    });
});
