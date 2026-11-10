import { describe, expect, it, vi } from "vitest";
import type { ICreateSetupComparisonRequest } from "@flash-evals/api-contract";
import type { IDb } from "../db.js";
import { ApiBadRequestError } from "../errors.js";
import {
    cancelSetupComparisonPayload,
    createSetupComparisonPayload,
    listSetupComparisonPipelinesPayload,
    setupComparisonPayload,
    type ISetupComparisonCreators,
} from "./setupComparisons.js";

// Made-up snack-sales extraction; not client data.
const COMPARISON_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const PIPELINE_A = "bbbbbbbb-0000-4000-8000-000000000001";
const PIPELINE_B = "bbbbbbbb-0000-4000-8000-000000000002";

function request(
    overrides: Partial<ICreateSetupComparisonRequest> = {},
): ICreateSetupComparisonRequest {
    return {
        teamId: "team-1",
        projectId: "project-1",
        createdBy: "user-1",
        datasetId: "dataset-1",
        promptVersionId: "pv-big",
        maxTokens: 8000,
        judgeModelId: "openai/judge",
        referenceModel: "openai/big-model",
        modelIds: ["openai/big-model", "openai/small-model"],
        promptAssignments: [],
        reasoningConfigs: [],
        fieldConfigs: [],
        benchmark: {
            source: "model",
            taskMap: {
                tasks: [
                    {
                        key: "products",
                        name: "Products",
                        method: "agreement",
                        fields: [
                            { path: "$.products", matcher: "set_overlap" },
                        ],
                    },
                ],
            },
        },
        maxCostUsd: 5,
        dataPolicy: { onlyHosts: ["vertex"] },
        pipelineIds: [PIPELINE_A, PIPELINE_B],
        ...overrides,
    };
}

/** Answers queries by the first route whose SQL fragment matches. */
function routingDb(routes: Array<[string, unknown[]]>): IDb & {
    calls: Array<{ sql: string; values: unknown[] }>;
} {
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    return {
        calls,
        query: vi.fn(async (text: string, values: unknown[] = []) => {
            const sql = text.replace(/\s+/g, " ");
            calls.push({ sql, values });
            const match = routes.find(([fragment]) => sql.includes(fragment));
            return { rows: match?.[1] ?? [] } as never;
        }),
    };
}

function creators(): ISetupComparisonCreators & {
    createEvalRun: ReturnType<typeof vi.fn>;
    createPipelineRun: ReturnType<typeof vi.fn>;
} {
    let n = 0;
    return {
        createEvalRun: vi.fn(async () => ({
            runId: "eval-run-1",
            enqueueStatus: "pending_enqueue" as const,
        })),
        createPipelineRun: vi.fn(async () => ({
            workflowRunId: `pipeline-run-${++n}`,
            enqueueStatus: "pending_enqueue" as const,
        })),
    };
}

const PIPELINE_ROWS = [
    { id: PIPELINE_A, name: "Three steps" },
    { id: PIPELINE_B, name: "Two steps" },
];

describe("createSetupComparisonPayload", () => {
    it("creates the eval run, then one pipeline run per pipeline compared with it", async () => {
        const db = routingDb([
            ["from prompt_workflows", PIPELINE_ROWS],
            ["insert into setup_comparisons", [{ id: COMPARISON_ID }]],
            [
                "from run_cells where run_id",
                [{ datasetItemId: "item-1" }, { datasetItemId: "item-2" }],
            ],
        ]);
        const deps = creators();

        const created = await createSetupComparisonPayload(
            db,
            request(),
            undefined,
            deps,
        );

        expect(created).toEqual({
            setupComparisonId: COMPARISON_ID,
            evalRunId: "eval-run-1",
            workflowRunIds: ["pipeline-run-1", "pipeline-run-2"],
        });
        const evalInput = deps.createEvalRun.mock.calls[0]![1];
        expect(evalInput).not.toHaveProperty("pipelineIds");
        expect(evalInput).toMatchObject({
            maxCostUsd: 5,
            dataPolicy: { onlyHosts: ["vertex"] },
            referenceModel: "openai/big-model",
        });
        expect(deps.createEvalRun.mock.calls[0]![3]).toEqual({
            allowReferenceOnly: true,
        });
        expect(
            db.calls.some((call) =>
                call.sql.includes("update runs set setup_comparison_id"),
            ),
        ).toBe(true);
        expect(deps.createPipelineRun).toHaveBeenCalledTimes(2);
        const [, pipelineInput, , options] =
            deps.createPipelineRun.mock.calls[0]!;
        expect(pipelineInput).toMatchObject({
            workflowId: PIPELINE_A,
            datasetId: "dataset-1",
            runTarget: "dataset",
            maxCostUsd: 5,
            dataPolicy: { onlyHosts: ["vertex"] },
            compareWithRunId: "eval-run-1",
        });
        expect(options).toEqual({
            setupComparisonId: COMPARISON_ID,
            itemIds: ["item-1", "item-2"],
        });
    });

    it("lets the eval run hold only the reference when every candidate is a pipeline", async () => {
        const db = routingDb([
            ["from prompt_workflows", PIPELINE_ROWS.slice(0, 1)],
            ["insert into setup_comparisons", [{ id: COMPARISON_ID }]],
        ]);
        const deps = creators();

        await createSetupComparisonPayload(
            db,
            request({
                modelIds: ["openai/big-model"],
                pipelineIds: [PIPELINE_A],
            }),
            undefined,
            deps,
        );

        expect(deps.createEvalRun.mock.calls[0]![3]).toEqual({
            allowReferenceOnly: true,
        });
    });

    it.each([
        [
            "no reference",
            { referenceModel: undefined },
            "referenceModel: Choose the model you use today",
        ],
        [
            "no Task Map",
            { benchmark: undefined },
            "benchmark: A comparison needs a Task Map",
        ],
        [
            "no candidate",
            { modelIds: ["openai/big-model"], pipelineIds: [] },
            "Add at least one model or pipeline",
        ],
        [
            "a pipeline twice",
            { pipelineIds: [PIPELINE_A, PIPELINE_A] },
            "Each pipeline can be chosen once",
        ],
        [
            "too many pipelines",
            {
                pipelineIds: Array.from(
                    { length: 11 },
                    (_, i) =>
                        `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, "0")}`,
                ),
            },
            "at most 10 pipelines",
        ],
    ])("refuses a comparison with %s", async (_, overrides, message) => {
        const db = routingDb([]);
        await expect(
            createSetupComparisonPayload(
                db,
                request(overrides as Partial<ICreateSetupComparisonRequest>),
                undefined,
                creators(),
            ),
        ).rejects.toThrow(message);
        expect(db.query).not.toHaveBeenCalled();
    });

    it("refuses a pipeline from another project", async () => {
        const db = routingDb([
            ["from prompt_workflows", PIPELINE_ROWS.slice(1)],
        ]);
        await expect(
            createSetupComparisonPayload(db, request(), undefined, creators()),
        ).rejects.toThrow(`Pipeline ${PIPELINE_A} isn't in this project`);
    });

    it("names the pipeline a member error came from", async () => {
        const db = routingDb([
            ["from prompt_workflows", PIPELINE_ROWS],
            ["insert into setup_comparisons", [{ id: COMPARISON_ID }]],
        ]);
        const deps = creators();
        deps.createPipelineRun.mockRejectedValueOnce(
            new ApiBadRequestError(
                "compareWithRunId: This pipeline has no final answer.",
            ),
        );

        await expect(
            createSetupComparisonPayload(db, request(), undefined, deps),
        ).rejects.toThrow(
            'Pipeline "Three steps": compareWithRunId: This pipeline has no final answer.',
        );
    });

    it("returns the same comparison for a repeated idempotency key", async () => {
        const first = routingDb([
            ["from prompt_workflows", PIPELINE_ROWS],
            ["insert into setup_comparisons", [{ id: COMPARISON_ID }]],
        ]);
        await createSetupComparisonPayload(
            first,
            request({ idempotencyKey: "retry-1" }),
            undefined,
            creators(),
        );
        const insert = first.calls.find((call) =>
            call.sql.includes("insert into setup_comparisons"),
        )!;
        const fingerprint = insert.values[7];

        const replay = routingDb([
            [
                "from setup_comparisons where team_id",
                [{ id: COMPARISON_ID, fingerprint }],
            ],
            ["from runs where setup_comparison_id", [{ id: "eval-run-1" }]],
            [
                "from workflow_runs where setup_comparison_id",
                [{ id: "pipeline-run-1" }, { id: "pipeline-run-2" }],
            ],
        ]);
        const deps = creators();
        await expect(
            createSetupComparisonPayload(
                replay,
                request({ idempotencyKey: "retry-1" }),
                undefined,
                deps,
            ),
        ).resolves.toEqual({
            setupComparisonId: COMPARISON_ID,
            evalRunId: "eval-run-1",
            workflowRunIds: ["pipeline-run-1", "pipeline-run-2"],
        });
        expect(deps.createEvalRun).not.toHaveBeenCalled();

        await expect(
            createSetupComparisonPayload(
                replay,
                request({ idempotencyKey: "retry-1", maxCostUsd: 9 }),
                undefined,
                creators(),
            ),
        ).rejects.toThrow("already used for a different request");
    });
});

const COMPARISON_ROW = {
    id: COMPARISON_ID,
    datasetId: "dataset-1",
    datasetName: "Snack calls",
    createdAt: "2026-11-06T10:00:00.000Z",
    maxCostUsd: "5",
    config: { dataPolicy: { onlyHosts: ["vertex"] } },
    cancelRequestedAt: null,
};

function pipelineRow(overrides: Record<string, unknown> = {}) {
    return {
        id: "pipeline-run-1",
        workflowId: PIPELINE_A,
        status: "running",
        stopReason: null,
        error: null,
        createdAt: "2026-11-06T10:00:00.000Z",
        enqueueStatus: "queued",
        pendingSince: "2026-11-06T10:00:00.000Z",
        snapshot: {
            name: "Three steps",
            // Stored out of order: Notes reads Points, which reads Extract.
            nodes: [
                {
                    id: "n-notes",
                    label: "Notes",
                    modelId: "openai/model-c",
                },
                { id: "n-input", label: "Input", nodeType: "input" },
                {
                    id: "n-extract",
                    label: "Extract",
                    resolvedLlmExecution: {
                        route: { modelId: "openai/model-a" },
                    },
                },
                { id: "n-points", label: "Points", modelId: "openai/model-b" },
            ],
            edges: [
                { fromNodeId: "n-input", toNodeId: "n-extract" },
                { fromNodeId: "n-extract", toNodeId: "n-points" },
                { fromNodeId: "n-points", toNodeId: "n-notes" },
            ],
        },
        openCells: "0",
        spent: "0.25",
        ...overrides,
    };
}

describe("setupComparisonPayload", () => {
    it("derives the status from the members and adds up their spend", async () => {
        const db = routingDb([
            ["from setup_comparisons c", [COMPARISON_ROW]],
            [
                "from runs r",
                [
                    {
                        id: "eval-run-1",
                        status: "running",
                        stopReason: null,
                        error: null,
                        createdAt: "2026-11-06T10:00:00.000Z",
                        enqueueStatus: "queued",
                        pendingSince: "2026-11-06T10:00:00.000Z",
                        spent: "1.5",
                    },
                ],
            ],
            ["from workflow_runs w", [pipelineRow()]],
        ]);

        const comparison = await setupComparisonPayload(
            db,
            "team-1",
            "project-1",
            COMPARISON_ID,
        );

        expect(comparison).toMatchObject({
            id: COMPARISON_ID,
            datasetName: "Snack calls",
            status: "running",
            maxCostUsd: 5,
            spentUsd: 1.75,
            dataPolicy: { onlyHosts: ["vertex"] },
            cancelRequested: false,
        });
        expect(comparison.members).toEqual([
            expect.objectContaining({ kind: "eval_run", runId: "eval-run-1" }),
            expect.objectContaining({
                kind: "pipeline",
                runId: "pipeline-run-1",
                name: "Three steps",
                stepModels: [
                    "openai/model-a",
                    "openai/model-b",
                    "openai/model-c",
                ],
                // Steps done, eval run still running: scoring waits.
                waitingForEvalRun: true,
            }),
        ]);
    });

    it("ranks every setup with the eval run's Task Map", async () => {
        const benchmark = request().benchmark!;
        const db = routingDb([
            ["from setup_comparisons c", [COMPARISON_ROW]],
            [
                "from runs r",
                [
                    {
                        id: "eval-run-1",
                        status: "completed",
                        stopReason: null,
                        error: null,
                        configSnapshot: { benchmark },
                        createdAt: "2026-11-06T10:00:00.000Z",
                        enqueueStatus: "queued",
                        pendingSince: null,
                        spent: "0.02",
                    },
                ],
            ],
            ["from workflow_runs w", [pipelineRow({ status: "completed" })]],
            [
                "from run_models",
                [
                    {
                        id: "rm-ref",
                        modelId: "openai/big-model",
                        isReference: true,
                    },
                ],
            ],
            [
                "from run_cells c",
                [
                    {
                        runModelId: "rm-ref",
                        datasetItemId: "item-1",
                        status: "succeeded",
                        costUsd: "0.01",
                        latencyMs: 1000,
                        details: null,
                    },
                ],
            ],
            [
                "from workflow_run_answers",
                [
                    {
                        workflowRunId: "pipeline-run-1",
                        datasetItemId: "item-1",
                        status: "complete",
                        costUsd: "0.002",
                        latencyMs: 600,
                        scored: true,
                        details: {
                            tasks: [
                                {
                                    key: "products",
                                    method: "agreement",
                                    agreement: 1,
                                },
                            ],
                        },
                    },
                ],
            ],
            [
                "count(distinct dataset_item_id)",
                [{ workflowRunId: "pipeline-run-1", items: "1" }],
            ],
        ]);

        const comparison = await setupComparisonPayload(
            db,
            "team-1",
            "project-1",
            COMPARISON_ID,
        );

        expect(comparison.ranking?.referenceRowId).toBe("rm-ref");
        expect(comparison.ranking?.rows).toEqual([
            expect.objectContaining({
                id: "rm-ref",
                kind: "reference",
                costPerCall: 0.01,
                scoredItems: 1,
            }),
            expect.objectContaining({
                id: "pipeline:pipeline-run-1",
                kind: "pipeline",
                costPerCall: 0.002,
                accuracy: 1,
                scoredItems: 1,
                waitingItems: 0,
                // As accurate as the reference at a fifth of the cost.
                notBeaten: true,
            }),
        ]);
    });

    it("is not found in another project", async () => {
        await expect(
            setupComparisonPayload(
                routingDb([]),
                "team-1",
                "project-2",
                COMPARISON_ID,
            ),
        ).rejects.toThrow("Comparison not found.");
    });
});

describe("cancelSetupComparisonPayload", () => {
    it("asks every member run to stop", async () => {
        const db = routingDb([
            ["update setup_comparisons", [{ id: COMPARISON_ID }]],
            ["from runs where setup_comparison_id", [{ id: "eval-run-1" }]],
            [
                "from workflow_runs where setup_comparison_id",
                [{ id: "pipeline-run-1", workflowId: PIPELINE_A }],
            ],
            [
                "from runs where id=$1",
                [{ status: "running", stopReason: null, executing: true }],
            ],
            [
                "from workflow_runs",
                [
                    {
                        id: "pipeline-run-1",
                        status: "pending",
                        stopReason: null,
                    },
                ],
            ],
        ]);

        const result = await cancelSetupComparisonPayload(db, {
            teamId: "team-1",
            projectId: "project-1",
            setupComparisonId: COMPARISON_ID,
        });

        expect(result.status).toBe("running");
        const updates = db.calls.filter((call) =>
            /update (runs|workflow_runs) set status/.test(call.sql),
        );
        expect(updates.map((call) => call.values[0])).toEqual([
            "eval-run-1",
            "pipeline-run-1",
        ]);
    });

    it("is not found in another project", async () => {
        await expect(
            cancelSetupComparisonPayload(routingDb([]), {
                teamId: "team-1",
                projectId: "project-2",
                setupComparisonId: COMPARISON_ID,
            }),
        ).rejects.toThrow("Comparison not found.");
    });
});

describe("listSetupComparisonPipelinesPayload", () => {
    it("lists steps in order and says why a pipeline can't be compared", async () => {
        const db = routingDb([
            [
                "from prompt_workflows w",
                [
                    {
                        id: PIPELINE_A,
                        name: "Three steps",
                        kind: "multi",
                        finalAnswer: {
                            fields: [
                                {
                                    path: "$.products",
                                    stepKey: "extract",
                                    stepPath: "$.products",
                                },
                            ],
                        },
                        nodes: [
                            {
                                id: "n-points",
                                label: "Points",
                                nodeType: "prompt",
                                nodeConfig: null,
                                modelId: "openai/model-b",
                                transport: "openrouter",
                                promptVersionId: "pv-points",
                                promptChars: 120,
                            },
                            {
                                id: "n-input",
                                label: "Input",
                                nodeType: "input",
                                nodeConfig: {
                                    type: "input",
                                    modality: "text",
                                    datasetId: "dataset-1",
                                },
                                modelId: null,
                                transport: null,
                                promptVersionId: null,
                                promptChars: null,
                            },
                            {
                                id: "n-extract",
                                label: "Extract",
                                nodeType: "prompt",
                                nodeConfig: null,
                                modelId: "openai/model-a",
                                transport: "gateway",
                                promptVersionId: "pv-extract",
                                promptChars: 300,
                            },
                        ],
                        edges: [
                            { fromNodeId: "n-input", toNodeId: "n-extract" },
                            { fromNodeId: "n-extract", toNodeId: "n-points" },
                        ],
                    },
                    {
                        id: PIPELINE_B,
                        name: "No answer",
                        kind: "prompt",
                        finalAnswer: null,
                        nodes: [],
                        edges: [],
                    },
                ],
            ],
        ]);

        const options = await listSetupComparisonPipelinesPayload(
            db,
            "team-1",
            "project-1",
        );

        expect(options[0]).toEqual({
            id: PIPELINE_A,
            name: "Three steps",
            kind: "multi",
            datasetId: "dataset-1",
            hasFinalAnswer: true,
            steps: [
                {
                    label: "Extract",
                    modelId: "openai/model-a",
                    transport: "gateway",
                    promptVersionId: "pv-extract",
                    promptChars: 300,
                },
                {
                    label: "Points",
                    modelId: "openai/model-b",
                    transport: "openrouter",
                    promptVersionId: "pv-points",
                    promptChars: 120,
                },
            ],
        });
        expect(options[1]).toMatchObject({
            hasFinalAnswer: false,
            unavailableReason:
                "No final answer yet. Add one under the canvas to compare it.",
        });
    });
});
