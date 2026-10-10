import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
    ICreateWorkflowRunRequest,
    ISttRunConfig,
} from "@mosaic/api-contract";
import { createMultiWorkflowSeed } from "@mosaic/api-contract";
import { z } from "zod";
import { publishWorkflowRunEnqueue } from "../../workflowRunEnqueue.js";
import {
    createWorkflowPayload,
    createWorkflowRunPayload,
    deleteWorkflowPayload,
    listWorkflowRunCellsPagePayload,
    listWorkflowRunSummariesPagePayload,
    listWorkflowRunsPayload,
    listWorkflowSummariesPagePayload,
    listWorkflowsPayload,
    saveWorkflowRunCellAnnotationPayload,
    saveWorkflowRunNotePayload,
    selectWorkflowLlmModelPayload,
    updateWorkflowPayload,
    workflowDetailPayload,
    workflowRunDetailPayload,
    workflowRunProgressPayload,
    workflowRunSummaryPayload,
} from "../../routes/workflows.js";
import { assertWorkflowLlmWritesEnabled } from "../../routes/llmRouting.js";
import { ok } from "../responses.js";
import {
    ProjectId,
    ReviewVerdict,
    SttRunConfig,
    WorkflowEdgeInput,
    WorkflowNodeInput,
} from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";
import {
    boundedMcpPageSize,
    decodeMcpPageCursor,
    encodeMcpPageCursor,
} from "../pagination.js";

const WorkflowIdInput = {
    projectId: ProjectId,
    workflowId: z.string().uuid(),
};

const WorkflowKindInput = z.enum(["prompt", "stt", "multi"]);

const WorkflowGraphInput = {
    name: z.string().min(1).max(120),
    description: z.string().optional(),
    nodes: z.array(WorkflowNodeInput).min(1),
    edges: z.array(WorkflowEdgeInput),
};

export function registerWorkflowTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "list_workflows",
        {
            title: "List workflows",
            description:
                "List workflows in a Flash Evals project, optionally by kind.",
            inputSchema: z.object({
                projectId: ProjectId,
                kind: WorkflowKindInput.optional(),
            }),
        },
        async ({ projectId, kind }) =>
            ok(
                "Loaded workflows.",
                await listWorkflowsPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                    kind,
                ),
            ),
    );

    server.registerTool(
        "list_workflow_summaries_page",
        {
            title: "List workflow summaries page",
            description:
                "Read a bounded, stable page of workflow summaries; use this for large collections. The legacy list_workflows tool returns all matching summaries. The cursor is bound to project and kind.",
            inputSchema: z.object({
                projectId: ProjectId,
                kind: WorkflowKindInput.optional(),
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
            }),
            outputSchema: {
                data: z.object({
                    workflows: z.array(
                        z.object({
                            id: z.string().uuid(),
                            teamId: z.string().uuid(),
                            projectId: z.string().uuid(),
                            name: z.string(),
                            description: z.string(),
                            kind: WorkflowKindInput,
                            createdAt: z.string(),
                            nodeCount: z.number().int(),
                        }),
                    ),
                    complete: z.boolean(),
                    nextCursor: z.string().optional(),
                }),
            },
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const scope = JSON.stringify([projectId, input.kind ?? null]);
            const page = await listWorkflowSummariesPagePayload(
                runtime.db,
                principal.teamId,
                projectId,
                {
                    limit: boundedMcpPageSize(input.limit),
                    kind: input.kind,
                    cursor: decodeMcpPageCursor(input.cursor, scope),
                },
            );
            return ok("Loaded workflow summary page.", {
                workflows: page.workflows,
                complete: page.complete,
                ...(page.nextCursor
                    ? {
                          nextCursor: encodeMcpPageCursor(
                              scope,
                              page.nextCursor,
                          ),
                      }
                    : {}),
            });
        },
    );

    server.registerTool(
        "get_workflow",
        {
            title: "Get workflow",
            description: "Return a workflow graph and configuration.",
            inputSchema: z.object(WorkflowIdInput),
        },
        async (input) =>
            ok(
                "Loaded workflow.",
                await workflowDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.workflowId,
                ),
            ),
    );

    server.registerTool(
        "create_workflow",
        {
            title: "Create workflow",
            description: "Create a validated workflow graph.",
            inputSchema: z.object({
                projectId: ProjectId,
                ...WorkflowGraphInput,
                kind: WorkflowKindInput.optional(),
                sttConfig: SttRunConfig.optional(),
            }),
        },
        async (input) =>
            ok(
                "Created workflow.",
                await createWorkflowPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    name: input.name,
                    ...(input.description !== undefined
                        ? { description: input.description }
                        : {}),
                    ...(input.kind !== undefined ? { kind: input.kind } : {}),
                    ...(input.sttConfig ? { sttConfig: input.sttConfig } : {}),
                    nodes: input.nodes,
                    edges: input.edges,
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "create_multiworkflow",
        {
            title: "Create Multiworkflow",
            description:
                "Create a valid Multiworkflow seed matching the New Multiworkflow canvas.",
            inputSchema: z.object({
                projectId: ProjectId,
                name: WorkflowGraphInput.name,
                modality: z.enum(["audio", "image", "text"]),
                datasetId: z.string().uuid().optional(),
                sttModelId: z
                    .string()
                    .min(1)
                    .optional()
                    .describe("Required for audio; unused for image and text."),
            }),
        },
        async (input) => {
            const seed = createMultiWorkflowSeed({
                modality: input.modality,
                ...(input.datasetId ? { datasetId: input.datasetId } : {}),
                ...(input.sttModelId ? { sttModelId: input.sttModelId } : {}),
            });
            return ok(
                "Created Multiworkflow.",
                await createWorkflowPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    name: input.name,
                    kind: "multi",
                    nodes: seed.nodes,
                    edges: seed.edges,
                    createdBy: principal.userId,
                }),
            );
        },
    );

    server.registerTool(
        "update_workflow",
        {
            title: "Update workflow",
            description: "Replace a workflow's metadata and validated graph.",
            inputSchema: z.object({
                ...WorkflowIdInput,
                ...WorkflowGraphInput,
                kind: WorkflowKindInput.optional(),
                sttConfig: SttRunConfig.nullable().optional(),
            }),
        },
        async (input) =>
            ok(
                "Updated workflow.",
                await updateWorkflowPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    workflowId: input.workflowId,
                    name: input.name,
                    ...(input.description !== undefined
                        ? { description: input.description }
                        : {}),
                    ...(input.kind !== undefined ? { kind: input.kind } : {}),
                    ...(input.sttConfig !== undefined
                        ? { sttConfig: input.sttConfig }
                        : {}),
                    nodes: input.nodes,
                    edges: input.edges,
                }),
            ),
    );

    server.registerTool(
        "delete_workflow",
        {
            title: "Delete workflow",
            description:
                "Archive a workflow so it is no longer available for runs.",
            inputSchema: z.object({
                ...WorkflowIdInput,
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            await deleteWorkflowPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                workflowId: input.workflowId,
            });
            return ok("Deleted workflow.", { workflowId: input.workflowId });
        },
    );

    server.registerTool(
        "select_workflow_llm_model",
        {
            title: "Select workflow LLM model",
            description:
                "Pin one exact immutable workflow LLM route version to one Multiworkflow model node. Pass the routeVersionId returned by route creation unchanged.",
            inputSchema: z
                .object({
                    ...WorkflowIdInput,
                    nodeKey: z.string().min(1),
                    routeVersionId: z.string().uuid(),
                })
                .strict(),
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            return ok(
                "Pinned the exact workflow LLM route version to the requested node.",
                await selectWorkflowLlmModelPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId,
                    workflowId: input.workflowId,
                    nodeKey: input.nodeKey,
                    routeVersionId: input.routeVersionId,
                }),
            );
        },
    );

    server.registerTool(
        "create_workflow_run",
        {
            title: "Create workflow run",
            description:
                "Create and enqueue a workflow run for a dataset or one item. Pass a stable idempotencyKey chosen before the first request, and reuse it for retries of the same intent.",
            inputSchema: z
                .object({
                    ...WorkflowIdInput,
                    datasetId: z.string().uuid(),
                    runTarget: z.enum(["single_item", "dataset"]),
                    itemId: z.string().uuid().optional(),
                    sttConfig: SttRunConfig.optional(),
                    idempotencyKey: z.string().trim().min(1).max(200),
                })
                .strict()
                .superRefine((input, ctx) => {
                    if (input.runTarget === "single_item" && !input.itemId) {
                        ctx.addIssue({
                            code: "custom",
                            path: ["itemId"],
                            message:
                                "itemId is required when runTarget is single_item.",
                        });
                    }
                }),
        },
        async (input) => {
            const result = await createWorkflowRunPayload(
                runtime.db,
                {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    workflowId: input.workflowId,
                    datasetId: input.datasetId,
                    runTarget: input.runTarget,
                    ...(input.itemId ? { itemId: input.itemId } : {}),
                    ...(input.sttConfig
                        ? { sttConfig: input.sttConfig as ISttRunConfig }
                        : {}),
                    idempotencyKey: input.idempotencyKey,
                    createdBy: principal.userId,
                } satisfies ICreateWorkflowRunRequest,
                runtime.config,
            );
            const published = await publishWorkflowRunEnqueue(
                runtime.db,
                runtime.config,
                result.workflowRunId,
            );
            return ok(
                published.enqueueStatus === "queued"
                    ? "Created and queued workflow run."
                    : "Created workflow run; queue publication is pending retry.",
                published,
            );
        },
    );

    server.registerTool(
        "list_workflow_runs",
        {
            title: "List workflow runs",
            description: "List runs for a workflow.",
            inputSchema: z.object(WorkflowIdInput),
        },
        async (input) =>
            ok(
                "Loaded workflow runs.",
                await listWorkflowRunsPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.workflowId,
                ),
            ),
    );

    const workflowRunInput = z.object({
        ...WorkflowIdInput,
        workflowRunId: z.string().uuid(),
    });

    server.registerTool(
        "list_workflow_run_summaries_page",
        {
            title: "List workflow run summaries page",
            description:
                "Read a bounded, stable page of workflow run summaries; use this for large collections. The legacy list_workflow_runs tool returns all matching summaries. The cursor is bound to the workflow.",
            inputSchema: z.object({
                ...WorkflowIdInput,
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
            }),
            outputSchema: {
                data: z.object({
                    workflowRuns: z.array(
                        z.object({
                            id: z.string().uuid(),
                            workflowId: z.string().uuid(),
                            datasetId: z.string().uuid(),
                            datasetName: z.string(),
                            status: z.string(),
                            runTarget: z.string(),
                            total: z.number().int(),
                            done: z.number().int(),
                            failed: z.number().int(),
                            createdAt: z.string(),
                        }),
                    ),
                    complete: z.boolean(),
                    nextCursor: z.string().optional(),
                }),
            },
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const scope = JSON.stringify([projectId, input.workflowId]);
            const page = await listWorkflowRunSummariesPagePayload(
                runtime.db,
                principal.teamId,
                projectId,
                input.workflowId,
                {
                    limit: boundedMcpPageSize(input.limit),
                    cursor: decodeMcpPageCursor(input.cursor, scope),
                },
            );
            return ok("Loaded workflow run summary page.", {
                workflowRuns: page.workflowRuns,
                complete: page.complete,
                ...(page.nextCursor
                    ? {
                          nextCursor: encodeMcpPageCursor(
                              scope,
                              page.nextCursor,
                          ),
                      }
                    : {}),
            });
        },
    );

    server.registerTool(
        "get_workflow_run",
        {
            title: "Get workflow run",
            description:
                "Return the complete legacy workflow run with cells, review state, scores, and aggregates. For large runs, use get_workflow_run_summary and bounded list_workflow_run_cells pages.",
            inputSchema: workflowRunInput,
        },
        async (input) =>
            ok(
                "Loaded workflow run.",
                await workflowRunDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.workflowId,
                    input.workflowRunId,
                ),
            ),
    );

    server.registerTool(
        "get_workflow_run_summary",
        {
            title: "Get workflow run summary",
            description:
                "Return compact workflow run status and aggregate progress. Use list_workflow_run_cells for bounded cell pages; get_workflow_run retains the full legacy response.",
            inputSchema: workflowRunInput,
            outputSchema: {
                data: z.object({
                    run: z.object({
                        id: z.string().uuid(),
                        datasetId: z.string().uuid(),
                        targetItemId: z.string().uuid().nullable(),
                        status: z.string(),
                        runTarget: z.string(),
                        createdAt: z.string(),
                    }),
                    progress: z.object({
                        status: z.string(),
                        total: z.number(),
                        done: z.number(),
                        failed: z.number(),
                        pending: z.number(),
                    }),
                }),
            },
        },
        async (input) =>
            ok(
                "Loaded workflow run summary.",
                await workflowRunSummaryPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.workflowId,
                    input.workflowRunId,
                ),
            ),
    );

    server.registerTool(
        "list_workflow_run_cells",
        {
            title: "List workflow run cells",
            description:
                "Read a stable, bounded page of workflow cells, optionally filtered by item, node, status, or review verdict and ordered oldest or newest first. Input text, outputs, review annotations, and scores are included only when requested.",
            inputSchema: z.object({
                ...WorkflowIdInput,
                workflowRunId: z.string().uuid(),
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
                itemId: z.string().uuid().optional(),
                nodeKey: z.string().min(1).optional(),
                status: z
                    .enum([
                        "pending",
                        "running",
                        "succeeded",
                        "failed",
                        "cached",
                    ])
                    .optional(),
                reviewVerdict: ReviewVerdict.optional(),
                order: z.enum(["oldest_first", "newest_first"]).optional(),
                includeInputText: z.boolean().optional(),
                includeOutput: z.boolean().optional(),
                includeReview: z.boolean().optional(),
                includeScores: z.boolean().optional(),
            }),
            outputSchema: {
                data: z.object({
                    cells: z.array(
                        z.object({
                            id: z.string().uuid(),
                            itemId: z.string().uuid(),
                            nodeKey: z.string(),
                            status: z.string(),
                            latencyMs: z.number().nullable(),
                            costUsd: z.number().nullable(),
                            error: z.string().nullable(),
                            inputText: z.string().nullable().optional(),
                            output: z.unknown().optional(),
                            review: z
                                .object({
                                    verdict: ReviewVerdict,
                                    comment: z.string(),
                                })
                                .nullable()
                                .optional(),
                            scores: z
                                .array(
                                    z.object({
                                        scorerType: z.string(),
                                        score: z.number().nullable(),
                                    }),
                                )
                                .optional(),
                        }),
                    ),
                    complete: z.boolean(),
                    nextCursor: z.string().optional(),
                }),
            },
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const limit = boundedMcpPageSize(input.limit);
            const scope = JSON.stringify([
                input.workflowId,
                input.workflowRunId,
                input.itemId ?? null,
                input.nodeKey ?? null,
                input.status ?? null,
                input.reviewVerdict ?? null,
                input.order ?? "oldest_first",
            ]);
            const page = await listWorkflowRunCellsPagePayload(runtime.db, {
                teamId: principal.teamId,
                projectId,
                workflowId: input.workflowId,
                runId: input.workflowRunId,
                limit,
                cursor: decodeMcpPageCursor(input.cursor, scope),
                itemId: input.itemId,
                nodeKey: input.nodeKey,
                status: input.status,
                reviewVerdict: input.reviewVerdict,
                order: input.order,
                includeInputText: input.includeInputText,
                includeOutput: input.includeOutput,
                includeReview: input.includeReview,
                includeScores: input.includeScores,
            });
            return ok("Loaded workflow run cell page.", {
                cells: page.cells,
                complete: page.complete,
                ...(page.nextCursor
                    ? {
                          nextCursor: encodeMcpPageCursor(
                              scope,
                              page.nextCursor,
                          ),
                      }
                    : {}),
            });
        },
    );

    server.registerTool(
        "save_workflow_run_note",
        {
            title: "Save workflow run note",
            description:
                "Create or update the note attached to a workflow run.",
            inputSchema: z.object({
                projectId: ProjectId,
                workflowRunId: z.string().uuid(),
                body: z.string(),
            }),
        },
        async (input) => {
            await saveWorkflowRunNotePayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                workflowRunId: input.workflowRunId,
                body: input.body,
                updatedBy: principal.userId,
            });
            return ok("Saved workflow run note.", {
                workflowRunId: input.workflowRunId,
            });
        },
    );

    server.registerTool(
        "annotate_workflow_run_cell",
        {
            title: "Annotate workflow run cell",
            description:
                "Mark a workflow run cell as approved, needing review, issue, or unreviewed.",
            inputSchema: z.object({
                projectId: ProjectId,
                workflowRunCellId: z.string().uuid(),
                verdict: z.enum([
                    "unreviewed",
                    "approved",
                    "needs_review",
                    "issue",
                ]),
                comment: z.string(),
            }),
        },
        async (input) =>
            ok(
                "Saved workflow run cell annotation.",
                await saveWorkflowRunCellAnnotationPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    workflowRunCellId: input.workflowRunCellId,
                    verdict: input.verdict,
                    comment: input.comment,
                    updatedBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "get_workflow_run_progress",
        {
            title: "Get workflow run progress",
            description:
                "Return current aggregate progress for a workflow run.",
            inputSchema: workflowRunInput,
        },
        async (input) =>
            ok(
                "Loaded workflow run progress.",
                await workflowRunProgressPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.workflowId,
                    input.workflowRunId,
                ),
            ),
    );
}
