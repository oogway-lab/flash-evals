import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
    MAX_RUN_COST_LIMIT_USD,
    MAX_SETUP_COMPARISON_PIPELINES,
    type IPipelineFieldConfig,
} from "@flash-evals/api-contract";
import {
    cancelSetupComparisonPayload,
    createSetupComparisonPayload,
    listSetupComparisonPipelinesPayload,
    publishSetupComparisonEnqueues,
    setupComparisonPayload,
} from "../../routes/setupComparisons.js";
import { listPipelineComparisonRunsPayload } from "../../routes/workflowRunComparison.js";
import { ok } from "../responses.js";
import { ProjectId } from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";
import { EvalRunInput } from "./runs.js";

const SetupComparisonId = z.object({
    projectId: ProjectId,
    setupComparisonId: z.string().uuid(),
});

/**
 * Setup comparisons (one launch for an eval run and pipeline runs scored
 * against its reference), and the eval runs a pipeline run can be compared
 * with.
 */
export function registerSetupComparisonTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "create_setup_comparison",
        {
            title: "Create setup comparison",
            description:
                "Compare setups on one dataset with one call: creates an eval run (referenceModel, today's model, plus the other modelIds) and one pipeline run per pipelineIds entry, each pipeline's final answers scored against that eval run's reference with its benchmark Task Map, targets and judge. Every member run follows dataPolicy and shares one maxCostUsd spend limit (judge calls included). Pipeline steps run straight away; their answers are scored once the eval run finishes. Needs referenceModel and benchmark; pipelines need a final answer and must read this dataset. Read the result with get_setup_comparison.",
            inputSchema: z.object({
                ...EvalRunInput,
                modelIds: z
                    .array(z.string().min(1))
                    .min(1)
                    .describe(
                        "The reference model and any single-model candidates. Pass only the reference when every candidate is a pipeline.",
                    ),
                pipelineIds: z
                    .array(z.string().uuid())
                    .max(MAX_SETUP_COMPARISON_PIPELINES)
                    .describe(
                        "Saved pipelines to try, each with a final answer. May be empty.",
                    ),
                maxCostUsd: z
                    .number()
                    .positive()
                    .max(MAX_RUN_COST_LIMIT_USD)
                    .optional()
                    .describe(
                        "One spend limit in USD for the whole comparison: every member run's model, step and judge calls count toward it, and each member stops starting work once their total reaches it. Calls already sent finish, so spend can go slightly over.",
                    ),
            }),
        },
        async (input) => {
            const created = await createSetupComparisonPayload(
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
            const published = await publishSetupComparisonEnqueues(
                runtime.db,
                runtime.config,
                created,
            );
            return ok(
                published.enqueueStatus === "queued"
                    ? "Created and queued the comparison's runs."
                    : "Created the comparison; queue publication will be retried automatically.",
                published,
            );
        },
    );

    server.registerTool(
        "get_setup_comparison",
        {
            title: "Get setup comparison",
            description:
                "Return a setup comparison: its status (derived from its member runs), shared spend and limit, and each member run (the eval run and the pipeline runs, with whether a pipeline waits for the eval run before scoring).",
            inputSchema: SetupComparisonId,
        },
        async (input) =>
            ok(
                "Loaded setup comparison.",
                await setupComparisonPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.setupComparisonId,
                ),
            ),
    );

    server.registerTool(
        "cancel_setup_comparison",
        {
            title: "Cancel setup comparison",
            description:
                "Stop every pending or running member run of a setup comparison. Calls already sent finish; work not started is not run. Finished members are left as they are.",
            inputSchema: SetupComparisonId,
        },
        async (input) => {
            const result = await cancelSetupComparisonPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                setupComparisonId: input.setupComparisonId,
            });
            return ok(
                result.status === "pending" || result.status === "running"
                    ? "Cancel requested; each run stops before its next call."
                    : `Comparison ended (${result.status}).`,
                result,
            );
        },
    );

    server.registerTool(
        "list_setup_comparison_pipelines",
        {
            title: "List pipelines for a setup comparison",
            description:
                "List saved text pipelines with their model steps in order, the dataset each reads, whether it has a final answer, and why it can't be compared when it can't.",
            inputSchema: z.object({ projectId: ProjectId }),
        },
        async (input) =>
            ok(
                "Loaded pipelines.",
                await listSetupComparisonPipelinesPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                ),
            ),
    );

    server.registerTool(
        "list_pipeline_comparison_runs",
        {
            title: "List eval runs a pipeline can be compared with",
            description:
                "List finished eval runs (completed or partial) with a benchmark Task Map, newest first, optionally on one dataset. Pass one as compareWithRunId to create_workflow_run.",
            inputSchema: z.object({
                projectId: ProjectId,
                datasetId: z.string().uuid().optional(),
            }),
        },
        async (input) =>
            ok(
                "Loaded comparable eval runs.",
                await listPipelineComparisonRunsPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, input.projectId),
                    input.datasetId,
                ),
            ),
    );
}
