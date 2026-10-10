import {
    ResourceTemplate,
    type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "node:crypto";
import {
    ApiError,
    ApiBadRequestError,
    ApiFieldValidationError,
    ApiRateLimitedError,
    ApiForbiddenError,
} from "../errors.js";
import { logApiEvent } from "../observability/logger.js";
import {
    datasetDetailPayload,
    datasetSummaryPayload,
    listDatasetItemsPagePayload,
} from "../routes/datasets.js";
import {
    promptDetailPayload,
    promptWorkbenchSetupPayload,
} from "../routes/prompts.js";
import {
    listRunCellsPagePayload,
    runDetailPayload,
    runSummaryPayload,
} from "../routes/runs.js";
import { recoverableError, resourceJson } from "./responses.js";
import { canMcpProfileCallTool, mcpToolEffect } from "./effects.js";
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
import {
    boundedMcpPageSize,
    decodeMcpPageCursor,
    encodeMcpPageCursor,
} from "./pagination.js";

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
type McpHandlerKind = "tool" | "resource";

// The SDK returns handler error messages verbatim to MCP clients; ApiError
// messages are written for users, anything else may carry internals.
function withSanitizedHandlerErrors(
    server: McpServer,
    context: IMcpContext,
): McpServer {
    const wrapHandler =
        (
            handler: IAnyHandler,
            kind: McpHandlerKind,
            toolName?: string,
        ): IAnyHandler =>
        async (...handlerArgs: unknown[]) => {
            try {
                if (toolName) {
                    const effect = mcpToolEffect(toolName);
                    if (
                        !canMcpProfileCallTool(
                            context.principal.profile,
                            effect,
                        )
                    ) {
                        throw new ApiForbiddenError(
                            `The ${context.principal.profile} MCP profile cannot call ${toolName}; this tool requires the ${effect.minimumProfile} profile.`,
                        );
                    }
                }
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
                const requestId = randomUUID();
                if (kind === "resource") {
                    const protocolError = resourceProtocolError(err, requestId);
                    if (!(err instanceof ApiError)) {
                        logApiEvent("error", "mcp.resource.failed", {
                            teamId: context.principal.teamId,
                            userId: context.principal.userId,
                            requestId,
                            errorName:
                                err instanceof Error
                                    ? err.name
                                    : "UnknownError",
                        });
                    }
                    throw protocolError;
                }
                if (err instanceof ApiError) {
                    return recoverableError(
                        {
                            status: err.status,
                            code: err.code,
                            message: err.message,
                            ...(err instanceof ApiRateLimitedError
                                ? { retryAfterSeconds: err.retryAfterSeconds }
                                : {}),
                            ...(err instanceof ApiFieldValidationError
                                ? {
                                      field: err.path,
                                      remediation: err.remediation,
                                  }
                                : {}),
                        },
                        requestId,
                    );
                }
                logApiEvent("error", "mcp.handler.failed", {
                    teamId: context.principal.teamId,
                    userId: context.principal.userId,
                    requestId,
                    errorName: err instanceof Error ? err.name : "UnknownError",
                });
                return recoverableError(
                    {
                        status: 500,
                        code: "internal_error",
                        message:
                            "Internal server error. Check the request ID before retrying.",
                    },
                    requestId,
                );
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
                if (
                    prop === "registerTool" &&
                    typeof args[0] === "string" &&
                    args[1] !== null &&
                    typeof args[1] === "object"
                ) {
                    const effect = mcpToolEffect(args[0]);
                    const config = args[1] as {
                        annotations?: Record<string, unknown>;
                        _meta?: Record<string, unknown>;
                    };
                    args[1] = {
                        ...config,
                        annotations: {
                            ...config.annotations,
                            readOnlyHint: effect.readOnly,
                            destructiveHint: effect.destructive,
                            idempotentHint: effect.idempotent,
                            openWorldHint: effect.openWorld,
                        },
                        _meta: {
                            ...config._meta,
                            "com.oogway.flash-evals/effect": effect.kind,
                            "com.oogway.flash-evals/minimum-profile":
                                effect.minimumProfile,
                        },
                    };
                }
                const last = args.length - 1;
                if (typeof args[last] === "function") {
                    args[last] = wrapHandler(
                        args[last] as IAnyHandler,
                        prop === "registerResource" ? "resource" : "tool",
                        prop === "registerTool" && typeof args[0] === "string"
                            ? args[0]
                            : undefined,
                    );
                }
                const registered = bound(...args);
                if (
                    prop === "registerTool" &&
                    typeof args[0] === "string" &&
                    !canMcpProfileCallTool(
                        context.principal.profile,
                        mcpToolEffect(args[0]),
                    ) &&
                    registered !== null &&
                    typeof registered === "object" &&
                    "disable" in registered &&
                    typeof registered.disable === "function"
                ) {
                    registered.disable();
                }
                return registered;
            };
        },
    });
}

function resourceProtocolError(err: unknown, requestId: string): McpError {
    if (err instanceof ApiError) {
        const code =
            err.status === 400 || err.status === 404
                ? ErrorCode.InvalidParams
                : err.status === 403
                  ? -32003
                  : ErrorCode.InternalError;
        return new McpError(code, err.message, {
            code: err.code,
            status: err.status,
            retryable: err.status === 429 || err.status >= 500,
            ...(err instanceof ApiRateLimitedError
                ? { retryAfterSeconds: err.retryAfterSeconds }
                : {}),
            requestId,
        });
    }
    return new McpError(
        ErrorCode.InternalError,
        "Internal server error. Check the request ID before retrying.",
        {
            code: "internal_error",
            status: 500,
            retryable: true,
            requestId,
        },
    );
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
                "Legacy full dataset response from an explicit project. For bounded context use mosaic-dataset-summary and mosaic-dataset-items.",
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
                "Legacy full run matrix from an explicit project. For bounded context use mosaic-run-summary and mosaic-run-cells.",
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

    server.registerResource(
        "mosaic-dataset-summary",
        new ResourceTemplate(
            "mosaic://projects/{projectId}/datasets/{id}/summary",
            { list: undefined },
        ),
        {
            title: "Flash Evals dataset summary",
            description:
                "Compact dataset metadata and counts with a discoverable link to bounded item pages.",
            mimeType: "application/json",
        },
        async (uri, variables) => {
            const projectId = await resolveProjectId(
                context,
                String(variables.projectId),
            );
            const datasetId = String(variables.id);
            const summary = await datasetSummaryPayload(
                runtime.db,
                principal.teamId,
                projectId,
                datasetId,
            );
            return resourceJson(uri.href, {
                ...summary,
                related: {
                    itemsUri: `mosaic://projects/${projectId}/datasets/${datasetId}/items/50/first`,
                    tool: {
                        name: "list_dataset_items",
                        arguments: { projectId, datasetId, limit: 50 },
                    },
                },
            });
        },
    );

    server.registerResource(
        "mosaic-dataset-items",
        new ResourceTemplate(
            "mosaic://projects/{projectId}/datasets/{id}/items/{limit}/{cursor}",
            { list: undefined },
        ),
        {
            title: "Flash Evals dataset item page",
            description:
                "Read a bounded dataset item page at /items/{limit}/{cursor}. Start with cursor 'first'; follow nextPageUri until complete. Use list_dataset_items for filters or opt-in details.",
            mimeType: "application/json",
        },
        async (uri, variables) => {
            const projectId = await resolveProjectId(
                context,
                String(variables.projectId),
            );
            const datasetId = String(variables.id);
            const limit = boundedMcpPageSize(
                resourcePageLimit(variables.limit),
            );
            const cursorValue = String(variables.cursor);
            const scope = JSON.stringify([datasetId, null, null]);
            const page = await listDatasetItemsPagePayload(runtime.db, {
                teamId: principal.teamId,
                projectId,
                datasetId,
                limit,
                cursor:
                    cursorValue === "first"
                        ? undefined
                        : decodeMcpPageCursor(cursorValue, scope),
            });
            const nextCursor = page.nextCursor
                ? encodeMcpPageCursor(scope, page.nextCursor)
                : undefined;
            const data = {
                items: page.items,
                complete: page.complete,
                ...(nextCursor
                    ? {
                          nextCursor,
                          nextPageUri: `mosaic://projects/${projectId}/datasets/${datasetId}/items/${limit}/${nextCursor}`,
                      }
                    : {}),
            };
            return resourceJson(uri.href, data);
        },
    );

    server.registerResource(
        "mosaic-run-summary",
        new ResourceTemplate(
            "mosaic://projects/{projectId}/runs/{id}/summary",
            { list: undefined },
        ),
        {
            title: "Flash Evals run summary",
            description:
                "Compact run status, progress, and model IDs with a discoverable link to bounded cell pages.",
            mimeType: "application/json",
        },
        async (uri, variables) => {
            const projectId = await resolveProjectId(
                context,
                String(variables.projectId),
            );
            const runId = String(variables.id);
            const summary = await runSummaryPayload(
                runtime.db,
                principal.teamId,
                projectId,
                runId,
            );
            return resourceJson(uri.href, {
                ...summary,
                related: {
                    cellsUri: `mosaic://projects/${projectId}/runs/${runId}/cells/50/first`,
                    tool: {
                        name: "list_run_cells",
                        arguments: { projectId, runId, limit: 50 },
                    },
                },
            });
        },
    );

    server.registerResource(
        "mosaic-run-cells",
        new ResourceTemplate(
            "mosaic://projects/{projectId}/runs/{id}/cells/{limit}/{cursor}",
            { list: undefined },
        ),
        {
            title: "Flash Evals run cell page",
            description:
                "Read a bounded run cell page at /cells/{limit}/{cursor}. Start with cursor 'first'; follow nextPageUri until complete. Use list_run_cells for filters or opt-in details.",
            mimeType: "application/json",
        },
        async (uri, variables) => {
            const projectId = await resolveProjectId(
                context,
                String(variables.projectId),
            );
            const runId = String(variables.id);
            const limit = boundedMcpPageSize(
                resourcePageLimit(variables.limit),
            );
            const cursorValue = String(variables.cursor);
            const scope = JSON.stringify([runId, null, null, null]);
            const page = await listRunCellsPagePayload(runtime.db, {
                teamId: principal.teamId,
                projectId,
                runId,
                limit,
                cursor:
                    cursorValue === "first"
                        ? undefined
                        : decodeMcpPageCursor(cursorValue, scope),
            });
            const nextCursor = page.nextCursor
                ? encodeMcpPageCursor(scope, page.nextCursor)
                : undefined;
            return resourceJson(uri.href, {
                cells: page.cells,
                complete: page.complete,
                ...(nextCursor
                    ? {
                          nextCursor,
                          nextPageUri: `mosaic://projects/${projectId}/runs/${runId}/cells/${limit}/${nextCursor}`,
                      }
                    : {}),
            });
        },
    );
}

function resourcePageLimit(value: unknown): number {
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
        throw new ApiBadRequestError("limit must be an integer from 1 to 100.");
    }
    return Number(value);
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
                        text: "Create a complete Flash Evals eval. First call get_current_user and list_eval_context. Create or select a dataset, then import text, image, audio, golden-answer, or paired items as appropriate. Generate or provide a prompt schema, then call create_runnable_prompt once with representative samples; check its outcome to distinguish a saved prompt from validation failure or provider error. Use test_prompt_draft or validate_runnable_prompt only for a separate exploratory check, since create_runnable_prompt validates again when saving. Create_eval_run, poll get_run_progress until the run is terminal, then inspect get_run and summarize review findings. Save a run note or cell annotations only when the user asks to persist those findings. For ordinary eval runs, an optional idempotencyKey makes retries safe; choose it before the first request and reuse it for the same intent. For workflow runs, pass the required idempotencyKey before the first request and reuse it on retry. For multi-step prompt graphs, use list_eval_context to choose explicit llmExecutionSelection values for every model-backed node. Poll get_workflow_run_progress until the workflow run is terminal. Destructive delete and archive tools require confirm: true; inspect the target before confirming.",
                    },
                },
            ],
        }),
    );
}
