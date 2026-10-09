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
    listWorkflowRunsPayload,
    listWorkflowsPayload,
    saveWorkflowRunCellAnnotationPayload,
    saveWorkflowRunNotePayload,
    selectWorkflowLlmModelPayload,
    updateWorkflowPayload,
    workflowDetailPayload,
    workflowRunDetailPayload,
    workflowRunProgressPayload,
} from "../../routes/workflows.js";
import { assertWorkflowLlmWritesEnabled } from "../../routes/llmRouting.js";
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
