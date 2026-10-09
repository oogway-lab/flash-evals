import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IPipelineFieldConfig } from "@mosaic/api-contract";
import {
    createRunFromSelectionPayload,
    deleteRunPayload,
    listRunsPayload,
    retryRunPayload,
    runDetailPayload,
    runProgressPayload,
    saveCellAnnotationPayload,
    saveRunNotePayload,
} from "../../routes/runs.js";
import { enqueueRun } from "../../runQueue.js";
import { ok } from "../responses.js";
import {
    FieldConfig,
    ProjectId,
    ReasoningConfig,
    ReasoningEffort,
} from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";

export function registerRunTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "list_runs",
        {
            title: "List eval runs",
            description: "List eval runs for the authenticated Flash Evals team.",
            inputSchema: z.object({ projectId: ProjectId }),
        },
        async ({ projectId }) =>
            ok(
                "Loaded runs.",
                await listRunsPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                ),
            ),
    );

    server.registerTool(
        "get_run",
        {
            title: "Get eval run",
            description:
                "Return run matrix, progress, leaderboard, notes, and annotations.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
                compareWith: z.string().uuid().optional(),
            }),
        },
        async (input) =>
            ok(
                "Loaded run.",
                await runDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.runId,
                    input.compareWith,
                ),
            ),
    );

    server.registerTool(
        "get_run_progress",
        {
            title: "Get run progress",
            description:
                "Return the current status and aggregate progress for a run.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
            }),
        },
        async ({ projectId: requestedProjectId, runId }) => {
            const projectId = await resolveProjectId(
                context,
                requestedProjectId,
            );
            return ok(
                "Loaded run progress.",
                await runProgressPayload(
                    runtime.db,
                    principal.teamId,
                    projectId,
                    runId,
                ),
            );
        },
    );

    server.registerTool(
        "create_eval_run",
        {
            title: "Create eval run",
            description:
                "Create and enqueue an eval run from a dataset, runnable prompt version, model IDs, and scoring setup.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                pipelineId: z.string().uuid().optional(),
                promptVersionId: z.string().uuid(),
                maxTokens: z.number().int().positive(),
                judgeConfigId: z.string().uuid().optional(),
                judgePromptVersionId: z.string().uuid().optional(),
                judgeRubric: z.string().optional(),
                judgeModelId: z.string().min(1),
                judgeReasoningEffort: ReasoningEffort.optional(),
                referenceModel: z.string().optional(),
                modelIds: z.array(z.string().min(1)).min(1),
                promptAssignments: z
                    .array(
                        z.object({
                            modelId: z.string().min(1),
                            promptVersionId: z.string().uuid(),
                        }),
                    )
                    .optional(),
                reasoningConfigs: z
                    .array(
                        z.object({
                            modelId: z.string().min(1),
                            reasoningConfig: ReasoningConfig.optional(),
                        }),
                    )
                    .optional(),
                fieldConfigs: z.array(FieldConfig),
                sourceRunId: z.string().uuid().optional(),
            }),
        },
        async (input) => {
            const result = await createRunFromSelectionPayload(
                runtime.db,
                {
                    ...input,
                    fieldConfigs: input.fieldConfigs as IPipelineFieldConfig[],
                    promptAssignments: input.promptAssignments ?? [],
                    reasoningConfigs: input.reasoningConfigs ?? [],
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    createdBy: principal.userId,
                },
                runtime.config,
            );
            await enqueueRun(runtime.config, result.runId);
            return ok("Created and queued eval run.", result);
        },
    );

    server.registerTool(
        "save_run_note",
        {
            title: "Save run note",
            description:
                "Create or update the team note attached to an eval run.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
                body: z.string(),
            }),
        },
        async (input) => {
            await saveRunNotePayload(runtime.db, {
                ...input,
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                updatedBy: principal.userId,
            });
            return ok("Saved run note.", { runId: input.runId });
        },
    );

    server.registerTool(
        "annotate_run_cell",
        {
            title: "Annotate run cell",
            description:
                "Mark a run cell as approved, needing review, issue, or unreviewed.",
            inputSchema: z.object({
                projectId: ProjectId,
                runCellId: z.string().uuid(),
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
                "Saved run cell annotation.",
                await saveCellAnnotationPayload(runtime.db, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    updatedBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "retry_run",
        {
            title: "Retry eval run",
            description:
                "Retry failed work for an eval run and enqueue it again.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
            }),
        },
        async (input) => {
            await retryRunPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                runId: input.runId,
            });
            await enqueueRun(runtime.config, input.runId);
            return ok("Retried and queued eval run.", { runId: input.runId });
        },
    );

    server.registerTool(
        "delete_run",
        {
            title: "Delete eval run",
            description: "Permanently delete an eval run and its results.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            await deleteRunPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                runId: input.runId,
            });
            return ok("Deleted eval run.", { runId: input.runId });
        },
    );
}
