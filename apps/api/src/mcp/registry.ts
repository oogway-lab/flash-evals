import {
    ResourceTemplate,
    type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ApiError } from "../errors.js";
import { logApiEvent } from "../observability/logger.js";
import { datasetDetailPayload } from "../routes/datasets.js";
import {
    promptDetailPayload,
    promptWorkbenchSetupPayload,
} from "../routes/prompts.js";
import { runDetailPayload } from "../routes/runs.js";
import { resourceJson } from "./responses.js";
import {
    registerContextTools,
    resolveProjectId,
    type IMcpContext,
} from "./tools/context.js";
import { registerDatasetTools } from "./tools/datasets.js";
import { registerPromptTools } from "./tools/prompts.js";
import { registerRunTools } from "./tools/runs.js";
import { registerSettingsTools } from "./tools/settings.js";
import { registerWorkflowTools } from "./tools/workflows.js";
import { enforceRateLimit, mcpToolRateLimitCategory } from "../rateLimit.js";

export function registerMosaicMcpCapabilities(
    server: McpServer,
    context: IMcpContext,
): void {
    const guarded = withSanitizedHandlerErrors(server, context);
    registerContextTools(guarded, context);
    registerDatasetTools(guarded, context);
    registerPromptTools(guarded, context);
    registerRunTools(guarded, context);
    registerSettingsTools(guarded, context);
    registerWorkflowTools(guarded, context);
    registerResources(guarded, context);
    registerPrompts(guarded);
}

type IAnyHandler = (...args: unknown[]) => unknown;

// The SDK returns handler error messages verbatim to MCP clients; ApiError
// messages are written for users, anything else may carry internals.
function withSanitizedHandlerErrors(
    server: McpServer,
    context: IMcpContext,
): McpServer {
    const wrapHandler =
        (handler: IAnyHandler, toolName?: string): IAnyHandler =>
        async (...handlerArgs: unknown[]) => {
            try {
                const category = toolName
                    ? mcpToolRateLimitCategory(toolName)
                    : undefined;
                if (category)
                    await enforceRateLimit(
                        context.runtime.db,
                        context.runtime.config,
                        category,
                        context.principal,
                    );
                return await handler(...handlerArgs);
            } catch (err) {
                if (err instanceof ApiError) throw err;
                logApiEvent("error", "mcp.handler.failed", {
                    teamId: context.principal.teamId,
                    userId: context.principal.userId,
                    errorName: err instanceof Error ? err.name : "UnknownError",
                });
                throw new Error("Internal server error");
            }
        };
    return new Proxy(server, {
        get(target, prop, receiver) {
            const value = Reflect.get(target, prop, receiver) as unknown;
            if (typeof value !== "function") return value;
            const bound = (value as IAnyHandler).bind(target);
            if (prop !== "registerTool" && prop !== "registerResource") {
                return bound;
            }
            return (...args: unknown[]) => {
                const last = args.length - 1;
                if (typeof args[last] === "function") {
                    args[last] = wrapHandler(
                        args[last] as IAnyHandler,
                        prop === "registerTool" && typeof args[0] === "string"
                            ? args[0]
                            : undefined,
                    );
                }
                return bound(...args);
            };
        },
    });
}

function registerResources(server: McpServer, context: IMcpContext): void {
    const { runtime, principal } = context;

    server.registerResource(
        "mosaic-dataset",
        new ResourceTemplate("mosaic://projects/{projectId}/datasets/{id}", {
            list: undefined,
        }),
        {
            title: "Flash Evals dataset",
            description:
                "Dataset metadata, items, labels, and schema context from an explicit project.",
            mimeType: "application/json",
        },
        async (uri, variables) =>
            resourceJson(
                uri.href,
                await datasetDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(
                        context,
                        String(variables.projectId),
                    ),
                    String(variables.id),
                ),
            ),
    );

    server.registerResource(
        "mosaic-prompt",
        new ResourceTemplate("mosaic://projects/{projectId}/prompts/{id}", {
            list: undefined,
        }),
        {
            title: "Flash Evals prompt",
            description:
                "Prompt metadata, versions, and latest schema context from an explicit project.",
            mimeType: "application/json",
        },
        async (uri, variables) =>
            resourceJson(
                uri.href,
                await promptDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(
                        context,
                        String(variables.projectId),
                    ),
                    String(variables.id),
                ),
            ),
    );

    server.registerResource(
        "mosaic-run",
        new ResourceTemplate("mosaic://projects/{projectId}/runs/{id}", {
            list: undefined,
        }),
        {
            title: "Flash Evals eval run",
            description:
                "Run detail, progress, scores, notes, and annotations from an explicit project.",
            mimeType: "application/json",
        },
        async (uri, variables) =>
            resourceJson(
                uri.href,
                await runDetailPayload(
                    runtime.db,
                    principal.teamId,
                    await resolveProjectId(
                        context,
                        String(variables.projectId),
                    ),
                    String(variables.id),
                ),
            ),
    );

    server.registerResource(
        "mosaic-models",
        new ResourceTemplate("mosaic://projects/{projectId}/models", {
            list: undefined,
        }),
        {
            title: "Flash Evals model options",
            description:
                "Available model options for eval and prompt workflows in an explicit project.",
            mimeType: "application/json",
        },
        async (uri, variables) =>
            resourceJson(
                uri.href,
                await promptWorkbenchSetupPayload(
                    runtime.db,
                    runtime.config,
                    principal.teamId,
                    await resolveProjectId(
                        context,
                        String(variables.projectId),
                    ),
                ),
            ),
    );
}

function registerPrompts(server: McpServer): void {
    server.registerPrompt(
        "create_eval_happy_path",
        {
            title: "Create Flash Evals eval happy path",
            description:
                "Guide an agent through dataset creation/import, prompt validation, runnable prompt creation, run creation, and review.",
        },
        async () => ({
            messages: [
                {
                    role: "user",
                    content: {
                        type: "text",
                        text: "Create a complete Flash Evals eval. First call get_current_user and list_eval_context. Create or select a dataset, then import text, image, audio, golden-answer, or paired items as appropriate. Generate or provide a prompt schema, test the prompt draft, validate it, create a runnable prompt, create_eval_run, poll get_run_progress, inspect get_run, then save_run_note and annotate_run_cell for review findings. For multi-step prompt graphs, use list_eval_context to choose explicit llmExecutionSelection values for every model-backed node. Pass a stable idempotencyKey to create_workflow_run and reuse that same key on every retry, then poll get_workflow_run_progress. Destructive delete and archive tools require confirm: true; inspect the target before confirming.",
                    },
                },
            ],
        }),
    );
}
