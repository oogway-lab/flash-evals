import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiNotFoundError } from "../../errors.js";
import { dashboardPayload } from "../../routes/dashboard.js";
import { listProviderKeysPayload } from "../../routes/keys.js";
import {
    getWorkflowLlmProjectDefaultPayload,
    listWorkflowLlmCapabilitiesPayload,
    listWorkflowLlmRoutesPayload,
} from "../../routes/llmRouting.js";
import {
    createProjectPayload,
    listProjectsPayload,
    updateProjectPayload,
} from "../../routes/projects.js";
import {
    createWorkspacePayload,
    listWorkspacesPayload,
    updateWorkspacePayload,
} from "../../routes/workspaces.js";
import { runSetupPayload } from "../../routes/runs.js";
import type { IApiRuntime } from "../../server.js";
import type { IMcpPrincipal } from "../auth.js";
import { ok } from "../responses.js";
import { ProjectId, WorkspaceId } from "../schemas.js";

export interface IMcpContext {
    runtime: IApiRuntime;
    principal: IMcpPrincipal;
}

export async function resolveProjectId(
    context: IMcpContext,
    requestedProjectId: string,
    requestedWorkspaceId?: string,
): Promise<string> {
    const result = await context.runtime.db.query<{ id: string }>(
        `select id from projects
        where team_id = $1 and id = $2
          and ($3::uuid is null or workspace_id = $3)
        limit 1`,
        [
            context.principal.teamId,
            requestedProjectId,
            requestedWorkspaceId ?? null,
        ],
    );
    const projectId = result.rows[0]?.id;
    if (!projectId) {
        throw new ApiNotFoundError(
            "Project was not found in the authenticated workspace.",
        );
    }
    return projectId;
}

export function registerContextTools(
    server: McpServer,
    context: IMcpContext,
): void {
    const { runtime, principal } = context;
    server.registerTool(
        "list_workspaces",
        {
            title: "List Flash Evals workspaces",
            description:
                "List shared workspaces in the authenticated Flash Evals tenant.",
        },
        async () =>
            ok(
                "Loaded workspaces.",
                await listWorkspacesPayload(runtime.db, principal.teamId),
            ),
    );

    server.registerTool(
        "create_workspace",
        {
            title: "Create Flash Evals workspace",
            description:
                "Create a shared workspace in the authenticated Flash Evals tenant.",
            inputSchema: z.object({ name: z.string().min(1).max(120) }),
        },
        async ({ name }) =>
            ok(
                "Created workspace.",
                await createWorkspacePayload(runtime.db, {
                    teamId: principal.teamId,
                    name,
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "rename_workspace",
        {
            title: "Rename Flash Evals workspace",
            description:
                "Rename a shared workspace in the authenticated Flash Evals tenant.",
            inputSchema: z.object({
                workspaceId: z.string().uuid(),
                name: z.string().min(1).max(120),
            }),
        },
        async ({ workspaceId, name }) =>
            ok(
                "Renamed workspace.",
                await updateWorkspacePayload(runtime.db, {
                    teamId: principal.teamId,
                    workspaceId,
                    name,
                    updatedBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "get_current_user",
        {
            title: "Get current Flash Evals user",
            description:
                "Return the Flash Evals user and team bound to this MCP token.",
        },
        async () =>
            ok("Authenticated Flash Evals MCP user.", {
                userId: principal.userId,
                teamId: principal.teamId,
                email: principal.email,
                name: principal.name,
            }),
    );

    server.registerTool(
        "list_eval_context",
        {
            title: "List eval setup context",
            description:
                "Return datasets, runnable prompt versions, judge prompts, saved LLM routes, and configured provider status. Use list_workflow_llm_provider_models with one selected transport for live model candidates.",
            inputSchema: z.object({
                workspaceId: WorkspaceId,
                projectId: ProjectId,
            }),
        },
        async ({ workspaceId, projectId }) => {
            const resolvedProjectId = await resolveProjectId(
                context,
                projectId,
                workspaceId,
            );
            const [setup, capabilities, routes, defaultRoute, credentials] =
                await Promise.all([
                    runSetupPayload(
                        runtime.db,
                        runtime.config,
                        principal.teamId,
                        resolvedProjectId,
                    ),
                    listWorkflowLlmCapabilitiesPayload(
                        runtime.db,
                        principal.teamId,
                        resolvedProjectId,
                    ),
                    listWorkflowLlmRoutesPayload(
                        runtime.db,
                        principal.teamId,
                        resolvedProjectId,
                    ),
                    getWorkflowLlmProjectDefaultPayload(
                        runtime.db,
                        principal.teamId,
                        resolvedProjectId,
                    ),
                    listProviderKeysPayload(runtime.db, principal.teamId),
                ]);
            return ok("Loaded Flash Evals eval setup context.", {
                ...setup,
                llmRouting: {
                    capabilities,
                    routes,
                    default: defaultRoute,
                    credentials: credentials.map(({ provider, baseUrl }) => ({
                        provider,
                        configured: true,
                        ...(baseUrl ? { baseUrl } : {}),
                    })),
                },
            });
        },
    );

    server.registerTool(
        "list_projects",
        {
            title: "List Flash Evals projects",
            description:
                "List projects in one explicit shared Flash Evals workspace.",
            inputSchema: z.object({ workspaceId: WorkspaceId }),
        },
        async ({ workspaceId }) =>
            ok(
                "Loaded projects.",
                await listProjectsPayload(
                    runtime.db,
                    principal.teamId,
                    workspaceId,
                ),
            ),
    );

    server.registerTool(
        "create_project",
        {
            title: "Create Flash Evals project",
            description:
                "Create a project in the authenticated Flash Evals workspace.",
            inputSchema: z.object({
                workspaceId: WorkspaceId,
                name: z.string().min(1).max(120),
            }),
        },
        async ({ workspaceId, name }) =>
            ok(
                "Created project.",
                await createProjectPayload(runtime.db, {
                    teamId: principal.teamId,
                    workspaceId,
                    name,
                    createdBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "update_project",
        {
            title: "Rename Flash Evals project",
            description:
                "Rename a project in the authenticated Flash Evals workspace without changing its ID or resources.",
            inputSchema: z.object({
                projectId: ProjectId,
                workspaceId: WorkspaceId,
                name: z.string().trim().min(1).max(120),
            }),
        },
        async ({ projectId, workspaceId, name }) =>
            ok(
                "Updated project.",
                await updateProjectPayload(runtime.db, {
                    teamId: principal.teamId,
                    projectId: await resolveProjectId(
                        context,
                        projectId,
                        workspaceId,
                    ),
                    workspaceId,
                    name,
                    updatedBy: principal.userId,
                }),
            ),
    );

    server.registerTool(
        "get_dashboard",
        {
            title: "Get Flash Evals dashboard",
            description:
                "Return workspace statistics and recent eval runs for a project.",
            inputSchema: z.object({
                workspaceId: WorkspaceId,
                projectId: ProjectId,
            }),
        },
        async ({ workspaceId, projectId }) =>
            ok(
                "Loaded dashboard.",
                await dashboardPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(context, projectId, workspaceId),
                ),
            ),
    );
}
