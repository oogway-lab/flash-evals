import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    createWorkflowPayload: vi.fn(),
    createWorkflowRunPayload: vi.fn(),
    deleteWorkflowPayload: vi.fn(),
    listWorkflowRunCellsPagePayload: vi.fn(),
    publishWorkflowRunEnqueue: vi.fn(),
    listWorkflowRunsPayload: vi.fn(),
    listWorkflowsPayload: vi.fn(),
    saveWorkflowRunCellAnnotationPayload: vi.fn(),
    saveWorkflowRunNotePayload: vi.fn(),
    selectWorkflowLlmModelPayload: vi.fn(),
    updateWorkflowPayload: vi.fn(),
    workflowDetailPayload: vi.fn(),
    workflowRunDetailPayload: vi.fn(),
    workflowRunProgressPayload: vi.fn(),
    workflowRunSummaryPayload: vi.fn(),
    assertWorkflowLlmWritesEnabled: vi.fn(),
    listWorkflowLlmRoutesPayload: vi.fn(),
}));

vi.mock("../../routes/workflows.js", () => mocks);
vi.mock("../../workflowRunEnqueue.js", () => ({
    publishWorkflowRunEnqueue: mocks.publishWorkflowRunEnqueue,
}));
vi.mock("../../routes/llmRouting.js", () => ({
    assertWorkflowLlmWritesEnabled: mocks.assertWorkflowLlmWritesEnabled,
    listWorkflowLlmRoutesPayload: mocks.listWorkflowLlmRoutesPayload,
}));

import { registerWorkflowTools } from "./workflows.js";
import { decodeMcpPageCursor, encodeMcpPageCursor } from "../pagination.js";
import { WorkflowNodeInput } from "../schemas.js";
import {
    createToolHarness,
    expectConfirmationGate,
    TEST_PROJECT_ID,
} from "./testSupport.js";

const PROJECT_ID = TEST_PROJECT_ID;
const WORKFLOW_ID = "22222222-2222-4222-8222-222222222222";
const WORKFLOW_RUN_ID = "33333333-3333-4333-8333-333333333333";
const DATASET_ID = "44444444-4444-4444-8444-444444444444";
const VERSION_ID = "55555555-5555-4555-8555-555555555555";

const BASE_NODE = { label: "Node", evalConfig: { type: "none" as const } };
const VALID_NODES = [
    {
        ...BASE_NODE,
        nodeKey: "prompt",
        nodeType: "prompt",
        nodeConfig: { type: "prompt" },
        promptVersionId: VERSION_ID,
        modelId: "gpt-4o",
    },
    {
        ...BASE_NODE,
        nodeKey: "input",
        nodeType: "input",
        nodeConfig: { type: "input", modality: "image", datasetId: DATASET_ID },
    },
    {
        ...BASE_NODE,
        nodeKey: "stt",
        nodeType: "stt",
        nodeConfig: {
            type: "stt",
            sttConfig: { modelId: "whisper-1", language: "en" },
        },
    },
    {
        ...BASE_NODE,
        nodeKey: "llm-text",
        nodeType: "llm_text",
        nodeConfig: { type: "llm_text", promptText: "Describe the image." },
        modelId: "gpt-4o",
    },
    {
        ...BASE_NODE,
        nodeKey: "transliterate",
        nodeType: "transliterate",
        nodeConfig: {
            type: "transliterate",
            transliteration: {
                enabled: true,
                targetScript: "latin",
                modelId: "gpt-4o-mini",
            },
        },
    },
    {
        ...BASE_NODE,
        nodeKey: "judge",
        nodeType: "judge",
        nodeConfig: { type: "judge", rubricPrompt: "Is this accurate?" },
        modelId: "gpt-4o",
    },
    {
        ...BASE_NODE,
        nodeKey: "metric",
        nodeType: "metric_compare",
        nodeConfig: {
            type: "metric_compare",
            referenceField: "expectedTranscript",
        },
    },
] as const;

describe("MCP workflow tools", () => {
    beforeEach(() => vi.clearAllMocks());

    it("registers the full workflow CRUD and run surface", () => {
        expect([...registerTools().tools.keys()]).toEqual([
            "list_workflows",
            "list_workflow_summaries_page",
            "get_workflow",
            "create_workflow",
            "create_multiworkflow",
            "update_workflow",
            "delete_workflow",
            "select_workflow_llm_model",
            "create_workflow_run",
            "list_workflow_runs",
            "list_workflow_run_summaries_page",
            "get_workflow_run",
            "get_workflow_run_summary",
            "list_workflow_run_cells",
            "save_workflow_run_note",
            "annotate_workflow_run_cell",
            "get_workflow_run_progress",
        ]);
    });

    it("passes graphs unchanged with principal-owned scope", async () => {
        const { tools, runtime } = registerTools();
        const nodes = [
            {
                nodeKey: "summarize",
                label: "Summarize",
                promptVersionId: VERSION_ID,
                modelId: "gpt-4o",
                evalConfig: { type: "none" },
            },
        ];
        mocks.createWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });

        await tools.get("create_workflow")!.handler({
            projectId: PROJECT_ID,
            name: "Workflow",
            description: "Description",
            nodes,
            edges: [],
        });

        expect(mocks.createWorkflowPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            name: "Workflow",
            description: "Description",
            nodes,
            edges: [],
            createdBy: "user-1",
        });
    });

    it("delegates a scoped single-node edit without reading and replacing the graph", async () => {
        const { tools, runtime } = registerTools();
        const routeVersionId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        mocks.selectWorkflowLlmModelPayload.mockResolvedValue({
            id: WORKFLOW_ID,
        });
        await tools.get("select_workflow_llm_model")!.handler({
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            nodeKey: "llm",
            routeVersionId,
        });
        expect(mocks.assertWorkflowLlmWritesEnabled).toHaveBeenCalledWith(
            runtime.config,
        );
        expect(mocks.selectWorkflowLlmModelPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                workflowId: WORKFLOW_ID,
                nodeKey: "llm",
                routeVersionId,
            },
        );
        expect(mocks.workflowDetailPayload).not.toHaveBeenCalled();
        expect(mocks.updateWorkflowPayload).not.toHaveBeenCalled();
        expect(mocks.listWorkflowLlmRoutesPayload).not.toHaveBeenCalled();
    });

    it("forwards workflow list kind and preserves the unfiltered call", async () => {
        const { tools, runtime } = registerTools();
        mocks.listWorkflowsPayload.mockResolvedValue([]);

        await tools.get("list_workflows")!.handler({
            projectId: PROJECT_ID,
            kind: "multi",
        });
        await tools.get("list_workflows")!.handler({
            projectId: PROJECT_ID,
        });

        expect(mocks.listWorkflowsPayload).toHaveBeenNthCalledWith(
            1,
            runtime.db,
            "team-1",
            PROJECT_ID,
            "multi",
        );
        expect(mocks.listWorkflowsPayload).toHaveBeenNthCalledWith(
            2,
            runtime.db,
            "team-1",
            PROJECT_ID,
            undefined,
        );
    });

    it("rejects unknown workflow list kinds at the tool schema", () => {
        const schema =
            registerTools().tools.get("list_workflows")!.config.inputSchema!;

        expect(() =>
            schema.parse({ projectId: PROJECT_ID, kind: "unknown" }),
        ).toThrow();
    });

    it("forwards workflow kind on create and update", async () => {
        const { tools, runtime } = registerTools();
        const nodes = [VALID_NODES[1]];
        mocks.createWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });
        mocks.updateWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });

        await tools.get("create_workflow")!.handler({
            projectId: PROJECT_ID,
            name: "Image workflow",
            kind: "multi",
            nodes,
            edges: [],
        });
        await tools.get("update_workflow")!.handler({
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            name: "Image workflow",
            kind: "multi",
            nodes,
            edges: [],
        });

        expect(mocks.createWorkflowPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            name: "Image workflow",
            kind: "multi",
            nodes,
            edges: [],
            createdBy: "user-1",
        });
        expect(mocks.updateWorkflowPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            name: "Image workflow",
            kind: "multi",
            nodes,
            edges: [],
        });
    });

    it("forwards an STT kind with an STT-rooted graph", async () => {
        const { tools, runtime } = registerTools();
        const nodes = [VALID_NODES[2]];
        mocks.createWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });

        await tools.get("create_workflow")!.handler({
            projectId: PROJECT_ID,
            name: "STT workflow",
            kind: "stt",
            nodes,
            edges: [],
        });

        expect(mocks.createWorkflowPayload).toHaveBeenCalledWith(runtime.db, {
            teamId: "team-1",
            projectId: PROJECT_ID,
            name: "STT workflow",
            kind: "stt",
            nodes,
            edges: [],
            createdBy: "user-1",
        });
    });

    it("omits workflow kind when callers do not supply one", async () => {
        const { tools, runtime } = registerTools();
        const nodes = [VALID_NODES[0]];
        mocks.createWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });
        mocks.updateWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });

        await tools.get("create_workflow")!.handler({
            projectId: PROJECT_ID,
            name: "Prompt workflow",
            nodes,
            edges: [],
        });
        await tools.get("update_workflow")!.handler({
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            name: "Prompt workflow",
            nodes,
            edges: [],
        });

        const createRequest = mocks.createWorkflowPayload.mock.calls[0]![1];
        const updateRequest = mocks.updateWorkflowPayload.mock.calls[0]![1];

        expect(mocks.createWorkflowPayload).toHaveBeenCalledWith(
            runtime.db,
            createRequest,
        );
        expect(mocks.updateWorkflowPayload).toHaveBeenCalledWith(
            runtime.db,
            updateRequest,
        );
        expect(createRequest).not.toHaveProperty("kind");
        expect(updateRequest).not.toHaveProperty("kind");
    });

    it("rejects unknown workflow kinds at the tool schema", () => {
        const schema =
            registerTools().tools.get("create_workflow")!.config.inputSchema!;

        expect(() =>
            schema.parse({
                projectId: PROJECT_ID,
                name: "Unknown workflow",
                kind: "unknown",
                nodes: [VALID_NODES[0]],
                edges: [],
            }),
        ).toThrow();
    });

    it.each([
        {
            modality: "audio" as const,
            sttModelId: "stt:openai:whisper-1",
            expectedNodeCount: 2,
            expectedEdgeCount: 1,
        },
        {
            modality: "image" as const,
            expectedNodeCount: 1,
            expectedEdgeCount: 0,
        },
        {
            modality: "text" as const,
            expectedNodeCount: 1,
            expectedEdgeCount: 0,
        },
    ])(
        "seeds a $modality multiworkflow",
        async ({
            modality,
            sttModelId,
            expectedNodeCount,
            expectedEdgeCount,
        }) => {
            const { tools, runtime } = registerTools();
            mocks.createWorkflowPayload.mockResolvedValue({ id: WORKFLOW_ID });

            await tools.get("create_multiworkflow")!.handler({
                projectId: PROJECT_ID,
                name: "Seeded workflow",
                modality,
                datasetId: DATASET_ID,
                ...(sttModelId ? { sttModelId } : {}),
            });

            expect(mocks.createWorkflowPayload).toHaveBeenCalledWith(
                runtime.db,
                expect.objectContaining({
                    teamId: "team-1",
                    projectId: PROJECT_ID,
                    name: "Seeded workflow",
                    kind: "multi",
                    createdBy: "user-1",
                    nodes: expect.arrayContaining([
                        expect.objectContaining({
                            nodeType: "input",
                            nodeConfig: expect.objectContaining({
                                type: "input",
                                modality,
                                datasetId: DATASET_ID,
                            }),
                        }),
                    ]),
                }),
            );
            const request = mocks.createWorkflowPayload.mock.calls[0]![1];
            expect(request.nodes).toHaveLength(expectedNodeCount);
            expect(request.edges).toHaveLength(expectedEdgeCount);
        },
    );

    it("rejects an audio multiworkflow without an STT model", async () => {
        const tool = registerTools().tools.get("create_multiworkflow")!;

        await expect(
            tool.handler({
                projectId: PROJECT_ID,
                name: "Audio workflow",
                modality: "audio",
            }),
        ).rejects.toThrow("An STT model is required for audio inputs.");
        expect(mocks.createWorkflowPayload).not.toHaveBeenCalled();
    });

    it("creates and enqueues a workflow run in order", async () => {
        const { tools, runtime } = registerTools();
        mocks.createWorkflowRunPayload.mockResolvedValue({
            workflowRunId: WORKFLOW_RUN_ID,
            enqueueStatus: "pending_enqueue",
        });
        mocks.publishWorkflowRunEnqueue.mockResolvedValue({
            workflowRunId: WORKFLOW_RUN_ID,
            enqueueStatus: "queued",
        });

        await tools.get("create_workflow_run")!.handler({
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            datasetId: DATASET_ID,
            runTarget: "dataset",
            idempotencyKey: "mcp-run-1",
        });

        expect(mocks.createWorkflowRunPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                workflowId: WORKFLOW_ID,
                datasetId: DATASET_ID,
                runTarget: "dataset",
                idempotencyKey: "mcp-run-1",
                createdBy: "user-1",
            },
            runtime.config,
        );
        expect(mocks.publishWorkflowRunEnqueue).toHaveBeenCalledWith(
            runtime.db,
            runtime.config,
            WORKFLOW_RUN_ID,
        );
    });

    it("requires a stable idempotency key and an itemId for single-item runs", () => {
        const schema = registerTools().tools.get("create_workflow_run")!.config
            .inputSchema!;
        const base = {
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            datasetId: DATASET_ID,
            idempotencyKey: "run-before-first-call",
        };

        expect(
            schema.safeParse({ ...base, runTarget: "dataset" }).success,
        ).toBe(true);
        const withoutIdempotencyKey = {
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            datasetId: DATASET_ID,
        };
        expect(
            schema.safeParse({
                ...withoutIdempotencyKey,
                runTarget: "dataset",
            }).success,
        ).toBe(false);
        expect(
            schema.safeParse({
                ...base,
                idempotencyKey: "   ",
                runTarget: "dataset",
            }).success,
        ).toBe(false);
        expect(
            schema.safeParse({
                ...base,
                runTarget: "single_item",
                itemId: "66666666-6666-4666-8666-666666666666",
            }).success,
        ).toBe(true);
        expect(
            schema.safeParse({ ...base, runTarget: "single_item" }).success,
        ).toBe(false);
    });

    it("passes workflow and run IDs to progress and detail payloads", async () => {
        const { tools, runtime } = registerTools();
        mocks.workflowRunProgressPayload.mockResolvedValue({
            status: "pending",
        });
        const detail = {
            workflowRun: {},
            cells: [
                {
                    id: "cell-1",
                    llmExecution: {
                        routeVersionId: "77777777-7777-4777-8777-777777777777",
                        capabilityDigest: "sha256:capability",
                        attempts: [
                            {
                                owner: "gateway",
                                outcome: "succeeded",
                                safeProviderEvidence: {
                                    provider: "openai",
                                },
                            },
                        ],
                    },
                },
            ],
        };
        mocks.workflowRunDetailPayload.mockResolvedValue(detail);

        const input = {
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
            workflowRunId: WORKFLOW_RUN_ID,
        };
        await tools.get("get_workflow_run_progress")!.handler(input);
        const detailResponse = await tools
            .get("get_workflow_run")!
            .handler(input);

        expect(mocks.workflowRunProgressPayload).toHaveBeenCalledWith(
            runtime.db,
            "team-1",
            PROJECT_ID,
            WORKFLOW_ID,
            WORKFLOW_RUN_ID,
        );
        expect(mocks.workflowRunDetailPayload).toHaveBeenCalledWith(
            runtime.db,
            "team-1",
            PROJECT_ID,
            WORKFLOW_ID,
            WORKFLOW_RUN_ID,
        );
        expect(detailResponse).toMatchObject({
            structuredContent: { data: detail },
        });
    });

    it("returns workflow run summaries and filter-bound bounded cell pages", async () => {
        const { tools, runtime } = registerTools();
        const summary = {
            run: {
                id: WORKFLOW_RUN_ID,
                datasetId: DATASET_ID,
                targetItemId: null,
                status: "completed",
                runTarget: "dataset",
                createdAt: "2026-10-10T00:00:00.000Z",
            },
            progress: {
                status: "completed",
                total: 125,
                done: 125,
                failed: 0,
                pending: 0,
            },
        };
        mocks.workflowRunSummaryPayload.mockResolvedValue(summary);
        const summaryResult = (await tools
            .get("get_workflow_run_summary")!
            .handler({
                projectId: PROJECT_ID,
                workflowId: WORKFLOW_ID,
                workflowRunId: WORKFLOW_RUN_ID,
            })) as { structuredContent: { data: unknown } };
        expect(summaryResult.structuredContent.data).toEqual(summary);

        const nextCursor = {
            createdAt: "2026-10-10T00:00:00.000Z",
            id: "77777777-7777-4777-8777-777777777777",
        };
        mocks.listWorkflowRunCellsPagePayload.mockResolvedValue({
            cells: [
                {
                    id: nextCursor.id,
                    itemId: DATASET_ID,
                    nodeKey: "input",
                    status: "succeeded",
                    latencyMs: null,
                    costUsd: null,
                    error: null,
                    inputText: "synthetic input",
                    output: { answer: "synthetic" },
                },
            ],
            complete: false,
            nextCursor,
        });
        const pageResult = (await tools
            .get("list_workflow_run_cells")!
            .handler({
                projectId: PROJECT_ID,
                workflowId: WORKFLOW_ID,
                workflowRunId: WORKFLOW_RUN_ID,
                limit: 1,
                nodeKey: "input",
                status: "succeeded",
                includeInputText: true,
                includeOutput: true,
            })) as { structuredContent: { data: Record<string, unknown> } };
        expect(
            decodeMcpPageCursor(
                pageResult.structuredContent.data.nextCursor as string,
                JSON.stringify([
                    WORKFLOW_ID,
                    WORKFLOW_RUN_ID,
                    null,
                    "input",
                    "succeeded",
                    null,
                    "oldest_first",
                ]),
            ),
        ).toEqual(nextCursor);
        expect(mocks.listWorkflowRunCellsPagePayload).toHaveBeenCalledWith(
            runtime.db,
            expect.objectContaining({
                teamId: "team-1",
                projectId: PROJECT_ID,
                workflowId: WORKFLOW_ID,
                runId: WORKFLOW_RUN_ID,
                limit: 1,
                nodeKey: "input",
                status: "succeeded",
                includeOutput: true,
            }),
        );
        const wrongFilterCursor = encodeMcpPageCursor(
            JSON.stringify([
                WORKFLOW_ID,
                WORKFLOW_RUN_ID,
                null,
                "other-node",
                "succeeded",
                null,
                "oldest_first",
            ]),
            nextCursor,
        );
        await expect(
            tools.get("list_workflow_run_cells")!.handler({
                projectId: PROJECT_ID,
                workflowId: WORKFLOW_ID,
                workflowRunId: WORKFLOW_RUN_ID,
                nodeKey: "input",
                status: "succeeded",
                cursor: wrongFilterCursor,
            }),
        ).rejects.toMatchObject({ status: 400 });
    });

    it("writes workflow run review state with principal-owned scope", async () => {
        const { tools, runtime } = registerTools();
        mocks.saveWorkflowRunNotePayload.mockResolvedValue(undefined);
        mocks.saveWorkflowRunCellAnnotationPayload.mockResolvedValue({
            workflowRunId: WORKFLOW_RUN_ID,
        });

        await tools.get("save_workflow_run_note")!.handler({
            projectId: PROJECT_ID,
            workflowRunId: WORKFLOW_RUN_ID,
            body: "Ready to ship",
        });
        await tools.get("annotate_workflow_run_cell")!.handler({
            projectId: PROJECT_ID,
            workflowRunCellId: "66666666-6666-4666-8666-666666666666",
            verdict: "approved",
            comment: "Good output",
        });

        expect(mocks.saveWorkflowRunNotePayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                workflowRunId: WORKFLOW_RUN_ID,
                body: "Ready to ship",
                updatedBy: "user-1",
            },
        );
        expect(mocks.saveWorkflowRunCellAnnotationPayload).toHaveBeenCalledWith(
            runtime.db,
            {
                teamId: "team-1",
                projectId: PROJECT_ID,
                workflowRunCellId: "66666666-6666-4666-8666-666666666666",
                verdict: "approved",
                comment: "Good output",
                updatedBy: "user-1",
            },
        );
    });

    it("requires explicit confirmation for workflow deletion", () => {
        const tool = registerTools().tools.get("delete_workflow")!;

        expectConfirmationGate(tool, {
            projectId: PROJECT_ID,
            workflowId: WORKFLOW_ID,
        });
    });
});

describe("WorkflowNodeInput", () => {
    it.each(VALID_NODES)("parses a $nodeType node", (node) => {
        expect(WorkflowNodeInput.parse(node)).toEqual(node);
    });

    it("parses a full input to STT to judge graph", () => {
        const schema =
            registerTools().tools.get("create_workflow")!.config.inputSchema!;
        const nodes = [VALID_NODES[1], VALID_NODES[2], VALID_NODES[5]];
        expect(
            schema.parse({
                projectId: PROJECT_ID,
                name: "Audio review",
                nodes,
                edges: [
                    {
                        fromNodeKey: "input",
                        toNodeKey: "stt",
                        carryOriginalInput: false,
                    },
                    {
                        fromNodeKey: "stt",
                        toNodeKey: "judge",
                        carryOriginalInput: false,
                    },
                ],
            }),
        ).toMatchObject({ nodes });
    });

    it("rejects fields forbidden for a node type instead of stripping them", () => {
        expect(() =>
            WorkflowNodeInput.parse({ ...VALID_NODES[1], modelId: "gpt-4o" }),
        ).toThrow();
    });

    it("rejects a prompt without a prompt version", () => {
        const { promptVersionId: _promptVersionId, ...prompt } = VALID_NODES[0];
        expect(() => WorkflowNodeInput.parse(prompt)).toThrow();
    });

    it("rejects malformed STT configuration", () => {
        expect(() =>
            WorkflowNodeInput.parse({
                ...VALID_NODES[2],
                nodeConfig: { type: "stt", sttConfig: {} },
            }),
        ).toThrow();
    });

    it("rejects a node type that disagrees with its configuration", () => {
        expect(() =>
            WorkflowNodeInput.parse({
                ...VALID_NODES[5],
                nodeConfig: { type: "llm_text", promptText: "Judge this." },
            }),
        ).toThrow();
    });

    it("accepts zero numeric tolerance and rejects negative tolerance", () => {
        const node = {
            ...VALID_NODES[0],
            evalConfig: {
                type: "field_diff" as const,
                fieldConfigs: [
                    {
                        field: "score",
                        kind: "factual" as const,
                        spec: {
                            matcher: "numeric_tolerance" as const,
                            tolerance: 0,
                        },
                    },
                ],
            },
        };

        expect(WorkflowNodeInput.safeParse(node).success).toBe(true);
        expect(
            WorkflowNodeInput.safeParse({
                ...node,
                evalConfig: {
                    ...node.evalConfig,
                    fieldConfigs: [
                        {
                            ...node.evalConfig.fieldConfigs[0],
                            spec: {
                                matcher: "numeric_tolerance",
                                tolerance: -0.1,
                            },
                        },
                    ],
                },
            }).success,
        ).toBe(false);
    });

    it("keeps accepting legacy prompt nodes without explicit type fields", () => {
        const legacyPrompt = {
            ...BASE_NODE,
            nodeKey: "legacy-prompt",
            promptVersionId: VERSION_ID,
            modelId: "gpt-4o",
        };
        expect(WorkflowNodeInput.parse(legacyPrompt)).toMatchObject(
            legacyPrompt,
        );
    });
});

function registerTools() {
    return createToolHarness(registerWorkflowTools);
}
