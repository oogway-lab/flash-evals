import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
    ICreateWorkflowRunRequest,
    ISttRunConfig,
    IWorkflowLlmRouteConfig,
} from "@mosaic/api-contract";
import {
    createMultiWorkflowSeed,
    isWorkflowModelBackedNodeType,
} from "@mosaic/api-contract";
import { z } from "zod";
import { ApiBadRequestError } from "../../errors.js";
import { publishWorkflowRunEnqueue } from "../../workflowRunEnqueue.js";
import {
    createWorkflowPayload,
    createWorkflowRunPayload,
    deleteWorkflowPayload,
    listWorkflowRunsPayload,
    listWorkflowsPayload,
    saveWorkflowRunCellAnnotationPayload,
    saveWorkflowRunNotePayload,
    updateWorkflowPayload,
    workflowDetailPayload,
    workflowRunDetailPayload,
    workflowRunProgressPayload,
} from "../../routes/workflows.js";
import { assertWorkflowLlmWritesEnabled } from "../../routes/llmRouting.js";
import { WorkflowLlmRouteConfig } from "../../routes/llmRoutingSchemas.js";
import { ok } from "../responses.js";
import {
    ProjectId,
    SttRunConfig,
    WorkflowEdgeInput,
    WorkflowNodeInput,
} from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";

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
            const [workflow, routeVersionResult] = await Promise.all([
                workflowDetailPayload(
                    runtime.db,
                    principal.teamId,
                    projectId,
                    input.workflowId,
                ),
                runtime.db.query<{
                    id: string;
                    config: IWorkflowLlmRouteConfig;
                }>(
                    `select v.id, v.config
                    from llm_route_versions v
                    join llm_routes r
                      on r.id = v.route_id
                     and r.team_id = v.team_id
                     and r.project_id = v.project_id
                    where v.id = $1 and v.team_id = $2 and v.project_id = $3
                      and r.disabled_at is null`,
                    [input.routeVersionId, principal.teamId, projectId],
                ),
            ]);
            const routeVersionRow = routeVersionResult.rows[0];
            if (!routeVersionRow) {
                throw new ApiBadRequestError(
                    "The exact active route version was not found in this project.",
                );
            }
            const routeConfig = WorkflowLlmRouteConfig.parse(
                routeVersionRow.config,
            );
            const node = workflow.nodes.find(
                (candidate) => candidate.nodeKey === input.nodeKey,
            );
            if (!node) {
                throw new ApiBadRequestError(
                    `Workflow node ${input.nodeKey} was not found.`,
                );
            }
            if (
                !node.nodeType ||
                !isWorkflowModelBackedNodeType(node.nodeType)
            ) {
                throw new ApiBadRequestError(
                    `Workflow node ${input.nodeKey} does not support an LLM model selection.`,
                );
            }
            const nextNode = {
                ...node,
                modelId: routeConfig.modelId,
                reasoningConfig:
                    routeConfig.generation.reasoningEffort !== undefined
                        ? {
                              effort: routeConfig.generation.reasoningEffort,
                          }
                        : undefined,
                llmExecutionSelection: {
                    mode: "pinned_route" as const,
                    routeVersionId: routeVersionRow.id,
                },
                ...(node.nodeType === "transliterate" &&
                node.nodeConfig?.type === "transliterate"
                    ? {
                          nodeConfig: {
                              ...node.nodeConfig,
                              transliteration: {
                                  ...node.nodeConfig.transliteration,
                                  modelId: routeConfig.modelId,
                              },
                          },
                      }
                    : {}),
            };
            const nodeIds = new Map(
                workflow.nodes.map((candidate) => [
                    candidate.id,
                    candidate.nodeKey,
                ]),
            );
            return ok(
                "Pinned the exact workflow LLM route version to the requested node.",
                await updateWorkflowPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId,
                    workflowId: workflow.id,
                    name: workflow.name,
                    description: workflow.description,
                    kind: workflow.kind,
                    ...(workflow.sttConfig
                        ? { sttConfig: workflow.sttConfig }
                        : {}),
                    nodes: workflow.nodes.map((candidate) =>
                        WorkflowNodeInput.parse(
                            candidate.nodeKey === input.nodeKey
                                ? nextNode
                                : candidate,
                        ),
                    ),
                    edges: workflow.edges.map((edge) => ({
                        fromNodeKey:
                            nodeIds.get(edge.fromNodeId) ?? edge.fromNodeId,
                        toNodeKey: nodeIds.get(edge.toNodeId) ?? edge.toNodeId,
                        carryOriginalInput: edge.carryOriginalInput,
                    })),
                }),
            );
        },
    );

    server.registerTool(
        "create_workflow_run",
        {
            title: "Create workflow run",
            description:
                "Create and enqueue a workflow run for a dataset or one item.",
            inputSchema: z
                .object({
                    ...WorkflowIdInput,
                    datasetId: z.string().uuid(),
                    runTarget: z.enum(["single_item", "dataset"]),
                    itemId: z.string().uuid().optional(),
                    sttConfig: SttRunConfig.optional(),
                    idempotencyKey: z.string().trim().min(1).max(200),
                })
                .strict(),
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
        "get_workflow_run",
        {
            title: "Get workflow run",
            description:
                "Return workflow run detail, cells, review state, scores, and aggregates.",
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
