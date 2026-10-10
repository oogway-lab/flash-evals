import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { IPipelineFieldConfig } from "@mosaic/api-contract";
import {
    createJudgePromptPayload,
    deletePromptPayload,
    duplicatePromptVersionPayload,
    generatePromptSchemaPayload,
    listPromptsPayload,
    optimizePromptPayload,
    promptDetailPayload,
    saveRunnablePromptPayload,
    testJudgeDraftPayload,
    testPromptDraftPayload,
    validateRunnablePromptPayload,
} from "../../routes/prompts.js";
import { generateJudgeForRunPayload } from "../../routes/runs.js";
import { ok } from "../responses.js";
import { withMcpIdempotency } from "../idempotency.js";
import {
    FieldConfig,
    JudgeDeclaredInput,
    JsonObject,
    ProjectId,
    PromptSampleInput,
    ProviderTransport,
    ReasoningConfig,
    ReasoningEffort,
} from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";

export function registerPromptTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "list_prompts",
        {
            title: "List prompts",
            description:
                "List eval and judge prompts for the authenticated team.",
            inputSchema: z.object({ projectId: ProjectId }),
        },
        async ({ projectId }) =>
            ok(
                "Loaded prompts.",
                await listPromptsPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                ),
            ),
    );

    server.registerTool(
        "get_prompt",
        {
            title: "Get prompt",
            description:
                "Return prompt details, latest version, and schema details.",
            inputSchema: z.object({
                projectId: ProjectId,
                promptId: z.string().uuid(),
            }),
        },
        async ({ projectId, promptId }) =>
            ok(
                "Loaded prompt.",
                await promptDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId),
                    promptId,
                ),
            ),
    );

    server.registerTool(
        "generate_schema_from_prompt",
        {
            title: "Generate schema from prompt",
            description:
                "Use Flash Evals's schema generator to propose structured output fields for a prompt draft.",
            inputSchema: z.object({
                projectId: ProjectId,
                content: z.string().min(1),
                targetModelId: z.string().min(1),
                generatorModelId: z.string().min(1),
            }),
        },
        async (input) =>
            ok(
                "Generated prompt schema.",
                await generatePromptSchemaPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "test_prompt_draft",
        {
            title: "Test prompt draft",
            description:
                "Run a prompt draft against sample inputs before creating a runnable prompt version.",
            inputSchema: z.object({
                prompt: z.string().min(1),
                jsonSchema: JsonObject,
                targetModelId: z.string().min(1),
                transport: ProviderTransport.optional(),
                reasoningEffort: ReasoningEffort.optional(),
                samples: z.array(PromptSampleInput).min(1),
                image: z
                    .object({
                        mimeType: z.string().min(1),
                        base64Data: z.string().min(1),
                    })
                    .optional(),
                timeoutMs: z.number().int().positive().optional(),
            }),
        },
        async (input) =>
            ok(
                "Tested prompt draft.",
                await testPromptDraftPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                }),
            ),
    );

    server.registerTool(
        "validate_runnable_prompt",
        {
            title: "Validate runnable prompt",
            description:
                "Validate a prompt, JSON schema, and samples before saving it as runnable.",
            inputSchema: z.object({
                projectId: ProjectId,
                prompt: z.string().min(1),
                jsonSchema: JsonObject,
                samples: z.array(PromptSampleInput).min(1),
                targetModelId: z.string().min(1),
                transport: ProviderTransport.optional(),
                reasoningEffort: ReasoningEffort.optional(),
            }),
        },
        async (input) =>
            ok(
                "Validated runnable prompt.",
                await validateRunnablePromptPayload(
                    runtime.db,
                    runtime.config,
                    {
                        ...input,
                        teamId: principal.teamId,
                        projectId: await resolveProjectId(
                            context,
                            input.projectId,
                        ),
                        createdBy: principal.userId,
                    },
                ),
            ),
    );

    server.registerTool(
        "create_runnable_prompt",
        {
            title: "Create runnable prompt",
            description:
                "Validate and create or update a runnable eval prompt version.",
            inputSchema: z.object({
                projectId: ProjectId,
                promptId: z.string().uuid().optional(),
                name: z.string().min(1),
                description: z.string().optional(),
                targetModelId: z.string().min(1),
                transport: ProviderTransport.optional(),
                content: z.string().min(1),
                jsonSchema: JsonObject,
                fieldConfigs: z.array(FieldConfig),
                samples: z.array(PromptSampleInput).min(1),
                optimizerAttemptId: z.string().uuid().optional(),
                reasoningConfig: ReasoningConfig.optional(),
                fitTags: z.array(z.string()).optional(),
            }),
        },
        async (input) => {
            const projectId = await resolveProjectId(context, input.projectId);
            const validation = await validateRunnablePromptPayload(
                runtime.db,
                runtime.config,
                {
                    prompt: input.content,
                    jsonSchema: input.jsonSchema,
                    samples: input.samples,
                    targetModelId: input.targetModelId,
                    transport: input.transport,
                    reasoningEffort: input.reasoningConfig?.effort,
                    teamId: principal.teamId,
                    projectId,
                    createdBy: principal.userId,
                },
            );
            if (!validation.passed) {
                const outcome = validation.evidence.sampleResults.some(
                    (sample) => sample.status === "provider_error",
                )
                    ? "provider_error"
                    : "validation_failed";
                return ok("Prompt validation failed.", {
                    ...validation,
                    outcome,
                });
            }
            const saved = await saveRunnablePromptPayload(runtime.db, {
                ...input,
                fieldConfigs: input.fieldConfigs as IPipelineFieldConfig[],
                validationEvidence: validation.evidence,
                fitTags: input.fitTags ?? [],
                teamId: principal.teamId,
                projectId,
                createdBy: principal.userId,
            });
            return ok("Saved runnable prompt.", { ...saved, outcome: "saved" });
        },
    );

    server.registerTool(
        "optimize_prompt",
        {
            title: "Optimize prompt",
            description:
                "Ask Flash Evals's optimizer to improve a prompt for a target model and schema.",
            inputSchema: z.object({
                projectId: ProjectId,
                content: z.string().min(1),
                targetModelId: z.string().min(1),
                optimizerModelId: z.string().min(1),
                jsonSchema: JsonObject,
            }),
        },
        async (input) =>
            ok(
                "Optimized prompt.",
                await optimizePromptPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "test_judge_draft",
        {
            title: "Test judge draft",
            description: "Run a judge prompt draft against a candidate output.",
            inputSchema: z.object({
                content: z.string().min(1),
                targetModelId: z.string().min(1),
                reasoningEffort: ReasoningEffort.optional(),
                declaredInputs: z.array(JudgeDeclaredInput),
                taskInput: z.string().optional(),
                candidateOutput: z.unknown(),
                reference: z.unknown().optional(),
            }),
        },
        async (input) =>
            ok(
                "Tested judge draft.",
                await testJudgeDraftPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                }),
            ),
    );

    server.registerTool(
        "generate_judge_for_run",
        {
            title: "Generate judge for run",
            description:
                "Generate a run-level judge rubric for a runnable prompt version and dataset.",
            inputSchema: z.object({
                projectId: ProjectId,
                promptVersionId: z.string().uuid(),
                datasetId: z.string().uuid(),
                generatorModelId: z.string().min(1).optional(),
            }),
        },
        async (input) =>
            ok(
                "Generated judge rubric.",
                await generateJudgeForRunPayload(runtime.db, runtime.config, {
                    ...input,
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                }),
            ),
    );

    server.registerTool(
        "create_judge_prompt",
        {
            title: "Create judge prompt",
            description:
                "Create a runnable judge prompt and its first version.",
            inputSchema: z.object({
                projectId: ProjectId,
                name: z.string().min(1).max(120),
                modelId: z.string().min(1),
                rubricPrompt: z.string().min(1),
                transport: ProviderTransport.optional(),
                declaredInputs: z.array(JudgeDeclaredInput).min(1),
                reasoningEffort: ReasoningEffort.optional(),
            }),
        },
        async (input) =>
            ok(
                "Created judge prompt.",
                await createJudgePromptPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    name: input.name,
                    modelId: input.modelId,
                    rubricPrompt: input.rubricPrompt,
                    judgeSpec: {
                        modelId: input.modelId,
                        ...(input.transport
                            ? { transport: input.transport }
                            : {}),
                        declaredInputs: input.declaredInputs,
                    },
                    ...(input.reasoningEffort
                        ? { reasoningConfig: { effort: input.reasoningEffort } }
                        : {}),
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "duplicate_prompt_version",
        {
            title: "Duplicate prompt version",
            description:
                "Create a new prompt from an existing structured prompt version. The optional idempotencyKey makes retries safe; when supplied, choose it before the first request and reuse it for this same copy.",
            inputSchema: z.object({
                projectId: ProjectId,
                sourcePromptVersionId: z.string().uuid(),
                idempotencyKey: z.string().trim().min(1).max(200).optional(),
            }),
            outputSchema: {
                data: z.object({
                    sourcePromptVersionId: z.string().uuid(),
                    promptId: z.string().uuid(),
                    promptVersionId: z.string().uuid(),
                }),
            },
        },
        async (input) => {
            const request = {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                sourcePromptVersionId: input.sourcePromptVersionId,
                createdBy: principal.userId,
            };
            const result = await withMcpIdempotency(
                runtime.db,
                {
                    teamId: principal.teamId,
                    operation: "duplicate_prompt_version",
                    idempotencyKey: input.idempotencyKey,
                    request,
                },
                (tx) => duplicatePromptVersionPayload(tx, request),
            );
            return ok("Duplicated prompt version.", result);
        },
    );

    server.registerTool(
        "delete_prompt",
        {
            title: "Delete prompt",
            description: "Permanently delete a prompt and its unused versions.",
            inputSchema: z.object({
                projectId: ProjectId,
                promptId: z.string().uuid(),
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            await deletePromptPayload(runtime.db, {
                teamId: principal.teamId,
                projectId: await resolveProjectId(context, input.projectId),
                promptId: input.promptId,
            });
            return ok("Deleted prompt.", { promptId: input.promptId });
        },
    );
}
