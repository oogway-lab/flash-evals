import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IPipelineFieldConfig } from "@mosaic/api-contract";
import {
    createRunFromSelectionPayload,
    deleteRunPayload,
    listRunsPayload,
    listRunSummariesPagePayload,
    listRunCellsPagePayload,
    retryRunPayload,
    runDetailPayload,
    runProgressPayload,
    runSummaryPayload,
    saveCellAnnotationPayload,
    saveRunNotePayload,
} from "../../routes/runs.js";
import { publishRunEnqueue } from "../../runEnqueue.js";
import { ok } from "../responses.js";
import {
    FieldConfig,
    ProjectId,
    ReasoningConfig,
    ReasoningEffort,
    ReviewVerdict,
} from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";
import {
    boundedMcpPageSize,
    decodeMcpPageCursor,
    encodeMcpPageCursor,
} from "../pagination.js";

export function registerRunTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "list_runs",
        {
            title: "List eval runs",
            description:
                "List eval runs for the authenticated Flash Evals team.",
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
        "list_run_summaries_page",
        {
            title: "List eval run summaries page",
            description:
                "Read a bounded, stable page of eval run summaries. Use list_runs for its complete legacy result; the cursor is bound to the project.",
            inputSchema: z.object({
                projectId: ProjectId,
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
            }),
            outputSchema: {
                data: z.object({
                    runs: z.array(
                        z.object({
                            id: z.string().uuid(),
                            status: z.string(),
                            createdAt: z.string(),
                            datasetId: z.string().uuid(),
                            datasetName: z.string(),
                            models: z.array(z.string()),
                            progress: z.object({
                                total: z.number().int(),
                                done: z.number().int(),
                                failed: z.number().int(),
                                pending: z.number().int(),
                            }),
                            noteTitle: z.string().optional(),
                            best: z
                                .object({
                                    modelId: z.string(),
                                    score: z.number(),
                                    metric: z.enum(["judge", "transcript"]),
                                    scored: z.number().int(),
                                    total: z.number().int(),
                                    tiedCount: z.number().int(),
                                })
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
            const scope = JSON.stringify([projectId]);
            const page = await listRunSummariesPagePayload(
                runtime.db,
                principal.teamId,
                projectId,
                {
                    limit: boundedMcpPageSize(input.limit),
                    cursor: decodeMcpPageCursor(input.cursor, scope),
                },
            );
            return ok("Loaded eval run summary page.", {
                runs: page.runs,
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
        "get_run_summary",
        {
            title: "Get eval run summary",
            description:
                "Return compact run status, aggregate progress, and model IDs. Use list_run_cells for bounded cell pages; get_run retains the full legacy matrix.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
            }),
            outputSchema: {
                data: z.object({
                    run: z.object({
                        id: z.string().uuid(),
                        datasetId: z.string().uuid(),
                        status: z.string(),
                        createdAt: z.string(),
                    }),
                    progress: z.object({
                        total: z.number(),
                        done: z.number(),
                        failed: z.number(),
                        pending: z.number(),
                    }),
                    modelIds: z.array(z.string()),
                }),
            },
        },
        async ({ projectId, runId }) =>
            ok(
                "Loaded eval run summary.",
                await runSummaryPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                    runId,
                ),
            ),
    );

    server.registerTool(
        "list_run_cells",
        {
            title: "List eval run cells",
            description:
                "Read a stable, bounded page of eval cells, optionally filtered by item, model, status, or review verdict and ordered oldest-first or newest-first. Input text, outputs, review annotations, and scores are opt-in.",
            inputSchema: z.object({
                projectId: ProjectId,
                runId: z.string().uuid(),
                limit: z.number().int().min(1).max(100).optional(),
                cursor: z.string().optional(),
                itemId: z.string().uuid().optional(),
                modelId: z.string().min(1).optional(),
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
                            modelId: z.string(),
                            status: z.string(),
                            latencyMs: z.number().nullable(),
                            costUsd: z.number().nullable(),
                            promptTokens: z.number().nullable(),
                            completionTokens: z.number().nullable(),
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
                input.runId,
                input.itemId ?? null,
                input.modelId ?? null,
                input.status ?? null,
                input.reviewVerdict ?? null,
                input.order ?? "oldest_first",
            ]);
            const page = await listRunCellsPagePayload(runtime.db, {
                teamId: principal.teamId,
                projectId,
                runId: input.runId,
                limit,
                cursor: decodeMcpPageCursor(input.cursor, scope),
                itemId: input.itemId,
                modelId: input.modelId,
                status: input.status,
                reviewVerdict: input.reviewVerdict,
                order: input.order,
                includeInputText: input.includeInputText,
                includeOutput: input.includeOutput,
                includeReview: input.includeReview,
                includeScores: input.includeScores,
            });
            return ok("Loaded eval run cell page.", {
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
        "create_eval_run",
        {
            title: "Create eval run",
            description:
                "Create an eval run and durably enqueue it. The optional idempotencyKey makes retries safe; when supplied, choose it before the first request and reuse it for the same intent. pending_enqueue means publication will be retried automatically.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid(),
                idempotencyKey: z.string().trim().min(1).max(200).optional(),
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
            const publication = await publishRunEnqueue(
                runtime.db,
                runtime.config,
                result.runId,
            );
            return ok(
                publication.enqueueStatus === "queued"
                    ? "Created and queued eval run."
                    : "Created eval run; queue publication will be retried automatically.",
                publication,
            );
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
            const publication = await publishRunEnqueue(
                runtime.db,
                runtime.config,
                input.runId,
            );
            return ok(
                publication.enqueueStatus === "queued"
                    ? "Retried and queued eval run."
                    : "Retry saved; queue publication will be retried automatically.",
                publication,
            );
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
