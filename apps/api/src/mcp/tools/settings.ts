import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
    PROVIDER_KEY_PROVIDERS,
    type IWorkflowLlmProjectDefaultResponse,
    type IWorkflowLlmRoute,
    type IWorkflowLlmRouteConfig,
    type WorkflowLlmTransport as WorkflowLlmTransportName,
} from "@mosaic/api-contract";
import { z } from "zod";
import { ApiBadRequestError } from "../../errors.js";
import { logApiEvent } from "../../observability/logger.js";
import {
    clearProviderKeyPayload,
    listProviderKeysPayload,
    setProviderKeyPayload,
} from "../../routes/keys.js";
import {
    assertWorkflowLlmWritesEnabled,
    clearWorkflowLlmProjectDefaultPayload,
    createWorkflowLlmRouteForModelPayload,
    createWorkflowLlmRouteVersionPayload,
    disableWorkflowLlmRoutePayload,
    getWorkflowLlmProjectDefaultPayload,
    listWorkflowLlmCapabilitiesPayload,
    listWorkflowLlmRouteCandidatesPayload,
    listWorkflowLlmRouteHistoryPayload,
    listWorkflowLlmRoutesPayload,
    refreshWorkflowLlmCapabilitiesPayload,
    setWorkflowLlmProjectDefaultPayload,
} from "../../routes/llmRouting.js";
import {
    parseClearWorkflowLlmProjectDefaultRequest,
    parseCreateWorkflowLlmRouteVersionRequest,
    parseDisableWorkflowLlmRouteRequest,
    parseRefreshWorkflowLlmCapabilitiesRequest,
    parseSetWorkflowLlmProjectDefaultRequest,
    WorkflowLlmRouteConfig,
    WorkflowLlmTransport,
} from "../../routes/llmRoutingSchemas.js";
import { createSttRouteProbePayload } from "../../routes/sttProbes.js";
import { ok } from "../responses.js";
import { ProjectId, ReasoningEffort } from "../schemas.js";
import { resolveProjectId, type IMcpContext } from "./context.js";

const Provider = z.enum(PROVIDER_KEY_PROVIDERS);
const SimpleWorkflowLlmRouteInput = z
    .object({
        projectId: ProjectId,
        transport: WorkflowLlmTransport,
        modelId: z.string().trim().min(1),
        name: z.string().trim().min(1).max(120),
        generation: z
            .object({
                maxOutputTokens: z.number().int().min(1).max(1_000_000),
                temperature: z.number().min(0).max(2).optional(),
                topP: z.number().min(0).max(1).optional(),
                seed: z.number().int().optional(),
                reasoningEffort: ReasoningEffort.optional(),
            })
            .strict()
            .optional(),
        timeoutMs: z.number().int().min(1).max(600_000).optional(),
        maxAttempts: z.number().int().min(1).max(10).optional(),
        mosaicReuse: z.enum(["allow", "force_fresh"]).optional(),
        // Retained for clients that used the pre-node-configuration tool.
        reasoningEffort: ReasoningEffort.optional(),
    })
    .strict();

export function registerSettingsTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;

    server.registerTool(
        "list_provider_keys",
        {
            title: "List provider keys",
            description:
                "List configured provider-key metadata without returning secret material.",
        },
        async () => {
            const configured = new Map(
                (
                    await listProviderKeysPayload(runtime.db, principal.teamId)
                ).map((key) => [key.provider, key]),
            );
            return ok(
                "Loaded provider-key status.",
                PROVIDER_KEY_PROVIDERS.map((provider) => {
                    const key = configured.get(provider);
                    return {
                        provider,
                        configured: key !== undefined,
                        ...(key?.baseUrl ? { baseUrl: key.baseUrl } : {}),
                    };
                }),
            );
        },
    );

    server.registerTool(
        "set_provider_key",
        {
            title: "Set provider key",
            description:
                "Configure a provider key without returning or logging the secret.",
            inputSchema: z.object({
                provider: Provider,
                key: z.string().min(1),
                baseUrl: z.string().url().optional(),
            }),
        },
        async (input) => {
            await setProviderKeyPayload(
                runtime.db,
                runtime.config.mosaicSecretsEncKey,
                {
                    teamId: principal.teamId,
                    provider: input.provider,
                    key: input.key,
                    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
                },
            );
            logApiEvent("info", "mcp.provider-key.set", {
                provider: input.provider,
                outcome: "configured",
            });
            return ok("Configured provider key.", { provider: input.provider });
        },
    );

    server.registerTool(
        "clear_provider_key",
        {
            title: "Clear provider key",
            description: "Permanently remove a configured provider key.",
            inputSchema: z.object({
                provider: Provider,
                confirm: z.literal(true),
            }),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            await clearProviderKeyPayload(runtime.db, {
                teamId: principal.teamId,
                provider: input.provider,
            });
            logApiEvent("info", "mcp.provider-key.clear", {
                provider: input.provider,
                outcome: "cleared",
            });
            return ok("Cleared provider key.", { provider: input.provider });
        },
    );

    server.registerTool(
        "create_stt_route_probe",
        {
            title: "Probe STT route",
            description:
                "Make a rate-sensitive, credentialed probe of one STT provider route; some providers may take up to 30 seconds.",
            inputSchema: z.object({
                projectId: ProjectId,
                modelId: z.string().min(1),
            }),
        },
        async (input) =>
            ok(
                "Probed STT route.",
                await createSttRouteProbePayload(runtime.db, runtime.config, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(context, input.projectId),
                    modelId: input.modelId,
                    probedBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "list_workflow_llm_capabilities",
        {
            title: "List workflow LLM capabilities",
            description:
                "List immutable capability snapshots and credential availability for workflow LLM routing.",
            inputSchema: z.object({ projectId: ProjectId }).strict(),
        },
        async ({ projectId }) => {
            const resolvedProjectId = await resolveProjectId(
                context,
                projectId,
            );
            return ok(
                "Loaded workflow LLM capabilities.",
                await listWorkflowLlmCapabilitiesPayload(
                    runtime.db,
                    principal.teamId,
                    resolvedProjectId,
                ),
            );
        },
    );

    server.registerTool(
        "refresh_workflow_llm_capabilities",
        {
            title: "Refresh workflow LLM capabilities",
            description:
                "Run an optional diagnostic discovery and persist its immutable evidence snapshot. Route creation checks the provider automatically; this tool is never a prerequisite.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    transport: WorkflowLlmTransport,
                })
                .strict(),
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            const providerKey = (
                await listProviderKeysPayload(runtime.db, principal.teamId)
            ).find((key) => key.provider === input.transport);
            if (!providerKey?.id) {
                throw new ApiBadRequestError(
                    "The selected provider does not have a configured credential.",
                );
            }
            return ok(
                "Completed optional workflow LLM capability diagnostics.",
                await refreshWorkflowLlmCapabilitiesPayload(
                    runtime.db,
                    runtime.config,
                    parseRefreshWorkflowLlmCapabilitiesRequest({
                        teamId: principal.teamId,
                        projectId,
                        transport: input.transport,
                        providerKeyId: providerKey.id,
                        refreshedBy: principal.userId,
                    }),
                ),
            );
        },
    );

    server.registerTool(
        "list_workflow_llm_routes",
        {
            title: "List workflow LLM routes",
            description:
                "List versioned workflow LLM routes without returning credential secrets.",
            inputSchema: z.object({ projectId: ProjectId }).strict(),
        },
        async ({ projectId }) => {
            const resolvedProjectId = await resolveProjectId(
                context,
                projectId,
            );
            return ok(
                "Loaded workflow LLM routes.",
                await listWorkflowLlmRoutesPayload(
                    runtime.db,
                    principal.teamId,
                    resolvedProjectId,
                ),
            );
        },
    );

    server.registerTool(
        "list_workflow_llm_provider_models",
        {
            title: "List workflow LLM provider models",
            description:
                "List live registered model candidates for one selected configured provider. Provider-listed candidates are selection context, not proof that a later execution will succeed.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    transport: WorkflowLlmTransport,
                })
                .strict(),
        },
        async ({ projectId, transport }) => {
            const resolvedProjectId = await resolveProjectId(
                context,
                projectId,
            );
            const credentials = await listProviderKeysPayload(
                runtime.db,
                principal.teamId,
            );
            if (!credentials.some(({ provider }) => provider === transport)) {
                throw new ApiBadRequestError(
                    "The selected provider does not have a configured credential.",
                );
            }
            const result = await listWorkflowLlmRouteCandidatesPayload(
                runtime.db,
                runtime.config,
                resolvedProjectId,
                transport,
                {
                    teamId: principal.teamId,
                    actorId: principal.userId,
                },
            );
            return ok("Loaded workflow LLM provider models.", [
                {
                    provider: transport,
                    label: providerLabel(transport),
                    configured: true,
                    selectionContext:
                        "provider_listed_candidate_not_execution_verified",
                    coverage: result.coverage,
                    models: result.candidates,
                },
            ]);
        },
    );

    server.registerTool(
        "list_workflow_llm_route_history",
        {
            title: "List workflow LLM route history",
            description:
                "List a bounded page of immutable workflow LLM route versions, oldest pins included through a cursor.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    routeId: z.string().uuid(),
                    beforeVersion: z.number().int().gt(1).optional(),
                    limit: z.number().int().min(1).max(100).optional(),
                })
                .strict(),
        },
        async ({ projectId, routeId, beforeVersion, limit }) => {
            const resolvedProjectId = await resolveProjectId(
                context,
                projectId,
            );
            return ok(
                "Loaded workflow LLM route history.",
                await listWorkflowLlmRouteHistoryPayload(
                    runtime.db,
                    principal.teamId,
                    resolvedProjectId,
                    routeId,
                    beforeVersion,
                    limit,
                ),
            );
        },
    );

    server.registerTool(
        "create_workflow_llm_route_version",
        {
            title: "Create workflow LLM route version",
            description:
                "Create a route or append an immutable route version using the canonical routing schema.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    routeId: z.string().uuid().optional(),
                    name: z.string().trim().min(1).max(120),
                    config: WorkflowLlmRouteConfig,
                })
                .strict(),
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            const route = await createWorkflowLlmRouteVersionPayload(
                runtime.db,
                runtime.config,
                parseCreateWorkflowLlmRouteVersionRequest({
                    projectId,
                    ...(input.routeId ? { routeId: input.routeId } : {}),
                    name: input.name,
                    config: input.config,
                }),
                {
                    teamId: principal.teamId,
                    actorId: principal.userId,
                },
            );
            return routeCreationResponse(
                "Saved workflow LLM route version.",
                route,
                await getWorkflowLlmProjectDefaultPayload(
                    runtime.db,
                    principal.teamId,
                    projectId,
                ),
                projectId,
            );
        },
    );

    server.registerTool(
        "create_workflow_llm_route_for_model",
        {
            title: "Create workflow LLM route for model",
            description:
                "Create a pin-ready workflow LLM route from a provider and model. Flash Evals resolves the configured credential and checks the live provider model listing during creation; do not provide credential or capability UUIDs.",
            inputSchema: SimpleWorkflowLlmRouteInput,
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            const route = await createWorkflowLlmRouteForModelPayload(
                runtime.db,
                runtime.config,
                {
                    projectId,
                    name: input.name,
                    config: simpleRouteConfig(input),
                },
                {
                    teamId: principal.teamId,
                    actorId: principal.userId,
                },
            );
            return routeCreationResponse(
                "Created workflow LLM route for provider and model.",
                route,
                await getWorkflowLlmProjectDefaultPayload(
                    runtime.db,
                    principal.teamId,
                    projectId,
                ),
                projectId,
            );
        },
    );

    server.registerTool(
        "disable_workflow_llm_route",
        {
            title: "Disable workflow LLM route",
            description:
                "Disable a route for future selection without deleting immutable versions.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    routeId: z.string().uuid(),
                    confirm: z.literal(true),
                })
                .strict(),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            const route = await disableWorkflowLlmRoutePayload(
                runtime.db,
                parseDisableWorkflowLlmRouteRequest({
                    teamId: principal.teamId,
                    projectId,
                    routeId: input.routeId,
                    disabledBy: principal.userId,
                }),
            );
            return ok("Disabled workflow LLM route.", {
                route,
                default: await getWorkflowLlmProjectDefaultPayload(
                    runtime.db,
                    principal.teamId,
                    projectId,
                ),
                warnings: [],
            });
        },
    );

    server.registerTool(
        "get_workflow_llm_default",
        {
            title: "Get workflow LLM default",
            description:
                "Get the effective project-level workflow LLM default.",
            inputSchema: z.object({ projectId: ProjectId }).strict(),
        },
        async ({ projectId }) => {
            const resolvedProjectId = await resolveProjectId(
                context,
                projectId,
            );
            return ok(
                "Loaded workflow LLM default.",
                await getWorkflowLlmProjectDefaultPayload(
                    runtime.db,
                    principal.teamId,
                    resolvedProjectId,
                ),
            );
        },
    );

    server.registerTool(
        "set_workflow_llm_default",
        {
            title: "Set workflow LLM default",
            description:
                "Set the project default to an immutable workflow LLM route version.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    routeVersionId: z.string().uuid(),
                })
                .strict(),
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            const mutation = await setWorkflowLlmProjectDefaultPayload(
                runtime.db,
                parseSetWorkflowLlmProjectDefaultRequest({
                    teamId: principal.teamId,
                    projectId,
                    routeVersionId: input.routeVersionId,
                    updatedBy: principal.userId,
                }),
            );
            return ok("Set workflow LLM default.", {
                mutation,
                default: mutation.newDefault
                    ? { default: mutation.newDefault }
                    : {},
                warnings: [],
            });
        },
    );

    server.registerTool(
        "clear_workflow_llm_default",
        {
            title: "Clear workflow LLM default",
            description:
                "Clear the project-level workflow LLM default used by default-bound nodes.",
            inputSchema: z
                .object({
                    projectId: ProjectId,
                    confirm: z.literal(true),
                })
                .strict(),
            annotations: { destructiveHint: true, idempotentHint: true },
        },
        async (input) => {
            assertWorkflowLlmWritesEnabled(runtime.config);
            const projectId = await resolveProjectId(context, input.projectId);
            const mutation = await clearWorkflowLlmProjectDefaultPayload(
                runtime.db,
                parseClearWorkflowLlmProjectDefaultRequest({
                    teamId: principal.teamId,
                    projectId,
                    updatedBy: principal.userId,
                }),
            );
            return ok("Cleared workflow LLM default.", {
                mutation,
                default: {},
                warnings: [],
            });
        },
    );
}

function simpleRouteConfig(
    input: z.infer<typeof SimpleWorkflowLlmRouteInput>,
): IWorkflowLlmRouteConfig {
    const reasoningEffort =
        input.generation?.reasoningEffort ?? input.reasoningEffort;
    return {
        modelId: input.modelId,
        transportConfig:
            input.transport === "openai"
                ? { transport: "openai" }
                : input.transport === "gateway"
                  ? {
                        transport: "gateway",
                        upstreamPolicy: { mode: "gateway_auto" },
                        modelFallback: "disabled",
                    }
                  : input.transport === "bifrost"
                    ? {
                          transport: "bifrost",
                          upstreamPolicy: { mode: "bifrost_default" },
                      }
                    : {
                          transport: "openrouter",
                          upstreamPolicy: { mode: "auto" },
                          requireParameters: true,
                          responseCache: "allow",
                      },
        generation: {
            maxOutputTokens: input.generation?.maxOutputTokens ?? 4096,
            ...(input.generation?.temperature !== undefined
                ? { temperature: input.generation.temperature }
                : {}),
            ...(input.generation?.topP !== undefined
                ? { topP: input.generation.topP }
                : {}),
            ...(input.generation?.seed !== undefined
                ? { seed: input.generation.seed }
                : {}),
            ...(reasoningEffort && reasoningEffort !== "none"
                ? { reasoningEffort }
                : {}),
        },
        structuredOutput: { mode: "text" },
        retry:
            input.transport === "gateway"
                ? {
                      owner: "gateway",
                      timeoutMs: input.timeoutMs ?? 60_000,
                  }
                : {
                      owner: "mosaic",
                      maxAttempts: input.maxAttempts ?? 1,
                      timeoutMs: input.timeoutMs ?? 60_000,
                      retryableErrorClasses: [
                          "rate_limit",
                          "timeout",
                          "overloaded",
                          "upstream_unavailable",
                      ],
                  },
        cache: {
            mosaicReuse: input.mosaicReuse ?? "force_fresh",
            providerCaching: "allow",
        },
    };
}

function routeCreationResponse(
    message: string,
    route: IWorkflowLlmRoute,
    projectDefault: IWorkflowLlmProjectDefaultResponse,
    projectId: string,
) {
    const routeVersionId = route.latestVersion?.id;
    if (!routeVersionId) {
        throw new Error("Saved route did not return an immutable version.");
    }
    return ok(message, {
        route,
        routeVersionId,
        default: projectDefault,
        warnings: [],
        pinning: {
            tool: "select_workflow_llm_model",
            instruction:
                "Pin this exact immutable route version to one workflow node by passing routeVersionId unchanged.",
            input: {
                projectId,
                routeVersionId,
                nodeKey: "<target-node-key>",
                workflowId: "<target-workflow-id>",
            },
        },
    });
}

function providerLabel(transport: WorkflowLlmTransportName): string {
    if (transport === "gateway") return "Vercel AI Gateway";
    if (transport === "openrouter") return "OpenRouter";
    if (transport === "openai") return "OpenAI";
    return "Bifrost";
}
