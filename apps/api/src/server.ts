import {
    createServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import type {
    ICreateRunFromSelectionRequest,
    ICreateRunRequest,
    ICreateWorkflowRunRequest,
    IUpdateWorkflowRequest,
    WorkflowLlmTransport,
} from "@mosaic/api-contract";
import { getApiConfig, type IApiConfig } from "./config.js";
import { createDb, type IDb } from "./db.js";
import { ApiBadRequestError } from "./errors.js";
import { healthPayload, publicHealthPayload } from "./health.js";
import {
    assertInternalToken,
    hasValidInternalToken,
} from "./middleware/auth.js";
import { corsHeaders, preflightResponse } from "./middleware/cors.js";
import { errorPayload, errorResponse } from "./middleware/errors.js";
import { handleMcpRequest, isMcpPath } from "./mcp/http.js";
import {
    enforceRateLimit,
    rateLimitCategoryFor,
    rateLimitPrincipalFromRequest,
} from "./rateLimit.js";
import { logApiEvent } from "./observability/logger.js";
import { recordError, recordRequest } from "./observability/metrics.js";
import { requestIdFromHeaders } from "./observability/requestId.js";
import {
    captureApiException,
    notifyApiAlert,
} from "./observability/integrations.js";
import { enqueueRun } from "./runQueue.js";
import {
    publishWorkflowRunEnqueue,
    startWorkflowRunEnqueueReplay,
} from "./workflowRunEnqueue.js";
import { resolvePrincipalPayload } from "./routes/auth.js";
import { dashboardPayload } from "./routes/dashboard.js";
import {
    createDatasetItemPayload,
    createDatasetItemFromFormPayload,
    createDatasetPayload,
    datasetDetailPayload,
    deleteDatasetPayload,
    deleteDatasetItemPayload,
    deleteLabelPayload,
    importAudioAnswersPayload,
    duplicateDatasetPayload,
    importAudioPayload,
    importGoldenAnswersPayload,
    previewGoldenAnswersPayload,
    commitGoldenAnswersPayload,
    importImageAnswersPayload,
    importImagesPayload,
    importPairedItemsPayload,
    importTextItemsPayload,
    listDatasetsPayload,
    setDatasetArchivedPayload,
    signUploadPayload,
    writeLocalUpload,
    updateDatasetItemPayload,
    updateDatasetItemFromFormPayload,
    updateDatasetDescriptionPayload,
    updateDatasetNamePayload,
} from "./routes/datasets.js";
import { imageResponsePayload } from "./routes/images.js";
import {
    clearProviderKeyPayload,
    listProviderKeysPayload,
    setProviderKeyPayload,
} from "./routes/keys.js";
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
} from "./routes/llmRouting.js";
import {
    parseClearWorkflowLlmProjectDefaultRequest,
    parseCreateWorkflowLlmRouteForModelRequest,
    parseCreateWorkflowLlmRouteVersionRequest,
    parseDisableWorkflowLlmRouteRequest,
    parseRefreshWorkflowLlmCapabilitiesRequest,
    parseSetWorkflowLlmProjectDefaultRequest,
    WorkflowLlmTransport as WorkflowLlmTransportSchema,
} from "./routes/llmRoutingSchemas.js";
import {
    createJudgePromptPayload,
    deletePromptPayload,
    duplicatePromptVersionPayload,
    generatePromptSchemaPayload,
    listPromptsPayload,
    optimizePromptPayload,
    promptDetailPayload,
    promptWorkbenchSetupPayload,
    recordPromptValidationAttemptPayload,
    saveRunnablePromptPayload,
    testJudgeDraftPayload,
    testPromptDraftPayload,
    validateRunnablePromptPayload,
} from "./routes/prompts.js";
import {
    createProjectPayload,
    listProjectsPayload,
    updateProjectPayload,
} from "./routes/projects.js";
import {
    createWorkspacePayload,
    listWorkspacesPayload,
    updateWorkspacePayload,
} from "./routes/workspaces.js";
import {
    configWithTeamSttProbes,
    createSttRouteProbePayload,
    listSttRouteProbesPayload,
} from "./routes/sttProbes.js";
import {
    createRunPayload,
    createRunFromSelectionPayload,
    deleteRunPayload,
    generateJudgeForRunPayload,
    runDetailPayload,
    listRunsPayload,
    retryRunPayload,
    runProgressPayload,
    runSetupPayload,
    saveCellAnnotationPayload,
    saveRunNotePayload,
} from "./routes/runs.js";
import {
    createWorkflowPayload,
    deleteWorkflowPayload,
    listWorkflowsPayload,
    updateWorkflowPayload,
    workflowDetailPayload,
} from "./routes/workflows.js";
import {
    createWorkflowRunPayload,
    listWorkflowRunsPayload,
    workflowRunDetailPayload,
    workflowRunProgressPayload,
} from "./routes/workflowRuns.js";

export interface IApiRuntime {
    config: IApiConfig;
    db: IDb;
}

export function createApiServer(config: IApiConfig = getApiConfig()) {
    const runtime = { config, db: createDb(config) };
    const stopEnqueueReplay = startWorkflowRunEnqueueReplay(runtime.db, config);
    const server = createServer((req, res) => {
        void handleNodeRequest(req, res, runtime);
    });
    server.on("close", stopEnqueueReplay);
    return server;
}

async function handleNodeRequest(
    req: IncomingMessage,
    res: ServerResponse,
    runtime: IApiRuntime,
): Promise<void> {
    const request = nodeRequest(req);
    const response = await handleRequest(request, runtime);
    await writeNodeResponse(res, response);
}

export async function handleRequest(
    request: Request,
    runtime: IApiRuntime | IApiConfig = getApiConfig(),
): Promise<Response> {
    const resolvedRuntime =
        "db" in runtime ? runtime : { config: runtime, db: createDb(runtime) };
    const { config, db } = resolvedRuntime;
    const origin = request.headers.get("origin");
    const requestId = requestIdFromHeaders(request.headers);
    const headers = new Headers(corsHeaders(origin, config));
    headers.set("x-request-id", requestId);
    recordRequest();

    try {
        const url = new URL(request.url);

        if (isMcpPath(url.pathname)) {
            return handleMcpRequest(request, resolvedRuntime);
        }

        if (request.method === "OPTIONS") {
            const response = preflightResponse(request, config);
            response.headers.set("x-request-id", requestId);
            return response;
        }

        const rateLimitCategory = rateLimitCategoryFor(
            request.method,
            url.pathname,
        );
        if (rateLimitCategory) {
            assertInternalToken(request, config);
            const principal = await rateLimitPrincipalFromRequest(request);
            if (principal)
                await enforceRateLimit(
                    db,
                    config,
                    rateLimitCategory,
                    principal,
                );
        }

        if (request.method === "GET" && isHealthPath(url.pathname)) {
            // Public callers get liveness only; the detailed payload (env,
            // storage adapter, feature flags, STT readiness, metrics) needs the
            // internal API token.
            const payload = hasValidInternalToken(request, config)
                ? await healthPayload(config, db)
                : await publicHealthPayload(config, db);
            return Response.json(payload, {
                status: payload.status === "ok" ? 200 : 503,
                headers,
            });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/auth/principal"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await resolvePrincipalPayload(db, config, await request.json()),
                { headers },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/dashboard") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await dashboardPayload(db, teamId, projectId),
                { headers },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/provider-keys") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            return Response.json(await listProviderKeysPayload(db, teamId), {
                headers,
            });
        }

        if (
            request.method === "GET" &&
            url.pathname === "/api/llm-routing/capabilities"
        ) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listWorkflowLlmCapabilitiesPayload(db, teamId, projectId),
                { headers },
            );
        }

        if (
            request.method === "GET" &&
            url.pathname === "/api/llm-routing/route-candidates"
        ) {
            assertInternalToken(request, config);
            const context = trustedWorkflowLlmContext(request);
            const projectId = url.searchParams.get("projectId")?.trim();
            const transport = workflowLlmTransport(
                url.searchParams.get("transport"),
            );
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listWorkflowLlmRouteCandidatesPayload(
                    db,
                    config,
                    projectId,
                    transport,
                    context,
                ),
                { headers },
            );
        }

        if (
            request.method === "GET" &&
            url.pathname === "/api/llm-routing/routes"
        ) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listWorkflowLlmRoutesPayload(db, teamId, projectId),
                { headers },
            );
        }

        const routeHistoryMatch = url.pathname.match(
            /^\/api\/llm-routing\/routes\/([^/]+)\/history$/,
        );
        if (request.method === "GET" && routeHistoryMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            const beforeRaw = url.searchParams.get("before");
            const limitRaw = url.searchParams.get("limit");
            const before = beforeRaw ? Number(beforeRaw) : undefined;
            const limit = limitRaw ? Number(limitRaw) : undefined;
            if (beforeRaw && (!Number.isInteger(before) || before! <= 1))
                throw new ApiBadRequestError(
                    "before must be an integer greater than 1.",
                );
            if (
                limitRaw &&
                (!Number.isInteger(limit) || limit! < 1 || limit! > 100)
            )
                throw new ApiBadRequestError(
                    "limit must be an integer between 1 and 100.",
                );
            return Response.json(
                await listWorkflowLlmRouteHistoryPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(routeHistoryMatch[1]!),
                    before,
                    limit,
                ),
                { headers },
            );
        }

        if (
            request.method === "GET" &&
            url.pathname === "/api/llm-routing/default"
        ) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await getWorkflowLlmProjectDefaultPayload(
                    db,
                    teamId,
                    projectId,
                ),
                { headers },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/stt/probes") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listSttRouteProbesPayload(db, config, teamId, projectId),
                { headers },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/projects") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const workspaceId = url.searchParams.get("workspaceId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            return Response.json(
                await listProjectsPayload(db, teamId, workspaceId),
                {
                    headers,
                },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/workspaces") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            return Response.json(await listWorkspacesPayload(db, teamId), {
                headers,
            });
        }

        if (request.method === "POST" && url.pathname === "/api/workspaces") {
            assertInternalToken(request, config);
            return Response.json(
                await createWorkspacePayload(db, await request.json()),
                { status: 201, headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/workspaces/update"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await updateWorkspacePayload(db, await request.json()),
                { headers },
            );
        }

        if (request.method === "POST" && url.pathname === "/api/projects") {
            assertInternalToken(request, config);
            return Response.json(
                await createProjectPayload(db, await request.json()),
                { status: 201, headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/projects/update"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await updateProjectPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/provider-keys"
        ) {
            assertInternalToken(request, config);
            await setProviderKeyPayload(
                db,
                config.mosaicSecretsEncKey,
                await request.json(),
            );
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/provider-keys/clear"
        ) {
            assertInternalToken(request, config);
            await clearProviderKeyPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/llm-routing/routes"
        ) {
            assertInternalToken(request, config);
            assertWorkflowLlmWritesEnabled(config);
            const context = trustedWorkflowLlmContext(request);
            const input = parseCreateWorkflowLlmRouteVersionRequest(
                await request.json(),
            );
            return Response.json(
                await createWorkflowLlmRouteVersionPayload(
                    db,
                    config,
                    input,
                    context,
                ),
                { status: 201, headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/llm-routing/routes/from-provider"
        ) {
            assertInternalToken(request, config);
            assertWorkflowLlmWritesEnabled(config);
            const context = trustedWorkflowLlmContext(request);
            const input = parseCreateWorkflowLlmRouteForModelRequest(
                await request.json(),
            );
            return Response.json(
                await createWorkflowLlmRouteForModelPayload(
                    db,
                    config,
                    input,
                    context,
                ),
                { status: 201, headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/llm-routing/capabilities/refresh"
        ) {
            assertInternalToken(request, config);
            assertWorkflowLlmWritesEnabled(config);
            const input = parseRefreshWorkflowLlmCapabilitiesRequest(
                await request.json(),
            );
            return Response.json(
                await refreshWorkflowLlmCapabilitiesPayload(db, config, input),
                { headers },
            );
        }

        const disableLlmRouteMatch =
            /^\/api\/llm-routing\/routes\/([^/]+)\/disable$/.exec(url.pathname);
        if (request.method === "POST" && disableLlmRouteMatch) {
            assertInternalToken(request, config);
            assertWorkflowLlmWritesEnabled(config);
            const routeId = decodeURIComponent(disableLlmRouteMatch[1]!);
            const input = parseDisableWorkflowLlmRouteRequest(
                await request.json(),
            );
            if (input.routeId !== routeId) {
                throw new ApiBadRequestError(
                    "LLM route ID in the request body must match the route.",
                );
            }
            return Response.json(
                await disableWorkflowLlmRoutePayload(db, input),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/llm-routing/default"
        ) {
            assertInternalToken(request, config);
            assertWorkflowLlmWritesEnabled(config);
            const input = parseSetWorkflowLlmProjectDefaultRequest(
                await request.json(),
            );
            return Response.json(
                await setWorkflowLlmProjectDefaultPayload(db, input),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/llm-routing/default/clear"
        ) {
            assertInternalToken(request, config);
            assertWorkflowLlmWritesEnabled(config);
            const input = parseClearWorkflowLlmProjectDefaultRequest(
                await request.json(),
            );
            return Response.json(
                await clearWorkflowLlmProjectDefaultPayload(db, input),
                { headers },
            );
        }

        if (request.method === "POST" && url.pathname === "/api/stt/probes") {
            assertInternalToken(request, config);
            return Response.json(
                await createSttRouteProbePayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/datasets") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listDatasetsPayload(db, teamId, projectId, {
                    includeArchived:
                        url.searchParams.get("includeArchived") === "true",
                    archivedOnly:
                        url.searchParams.get("archivedOnly") === "true",
                }),
                { headers },
            );
        }

        if (request.method === "POST" && url.pathname === "/api/datasets") {
            assertInternalToken(request, config);
            return Response.json(
                await createDatasetPayload(db, await request.json()),
                {
                    headers,
                },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/upload/sign"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await signUploadPayload(db, config, await request.json()),
                { headers },
            );
        }

        const localUploadMatch = /^\/api\/datasets\/upload\/local\/(.+)$/.exec(
            url.pathname,
        );
        if (request.method === "PUT" && localUploadMatch) {
            // U8: the browser PUTs bytes here directly, exactly like a signed
            // URL — no internal token. `writeLocalUpload` validates the storage
            // key shape, confines writes to the local media root, caps the body
            // size, and refuses unless the local storage adapter is active.
            const storageKey = decodeURIComponent(localUploadMatch[1]!);
            await writeLocalUpload(config, storageKey, request);
            return new Response(null, { status: 200, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/item"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await createDatasetItemPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/item/from-form"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await createDatasetItemFromFormPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/item/update"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await updateDatasetItemPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/item/update-from-form"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await updateDatasetItemFromFormPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/images"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importImagesPayload(db, config, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/audio"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importAudioPayload(db, config, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/image-answers"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importImageAnswersPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/audio-answers"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importAudioAnswersPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/text"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importTextItemsPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/golden-answers/preview"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await previewGoldenAnswersPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/golden-answers/commit"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await commitGoldenAnswersPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/golden-answers"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importGoldenAnswersPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/import/paired"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await importPairedItemsPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/name"
        ) {
            assertInternalToken(request, config);
            await updateDatasetNamePayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/description"
        ) {
            assertInternalToken(request, config);
            await updateDatasetDescriptionPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/archive"
        ) {
            assertInternalToken(request, config);
            await setDatasetArchivedPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/duplicate"
        ) {
            assertInternalToken(request, config);
            await duplicateDatasetPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/delete"
        ) {
            assertInternalToken(request, config);
            await deleteDatasetPayload(db, config, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/label/delete"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await deleteLabelPayload(db, await request.json()),
                {
                    headers,
                },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/datasets/item/delete"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await deleteDatasetItemPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        const datasetDetailMatch = /^\/api\/datasets\/([^/]+)$/.exec(
            url.pathname,
        );
        if (request.method === "GET" && datasetDetailMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await datasetDetailPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(datasetDetailMatch[1]!),
                ),
                { headers },
            );
        }

        const imageMatch = /^\/api\/images\/([^/]+)$/.exec(url.pathname);
        if (request.method === "GET" && imageMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            const imageResponse = await imageResponsePayload(
                db,
                config,
                teamId,
                projectId,
                decodeURIComponent(imageMatch[1]!),
            );
            new Headers(headers).forEach((value, key) => {
                imageResponse.headers.set(key, value);
            });
            return imageResponse;
        }

        if (request.method === "GET" && url.pathname === "/api/prompts") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listPromptsPayload(db, teamId, projectId),
                {
                    headers,
                },
            );
        }

        if (
            request.method === "GET" &&
            url.pathname === "/api/prompts/workbench"
        ) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await promptWorkbenchSetupPayload(
                    db,
                    config,
                    teamId,
                    projectId,
                ),
                {
                    headers,
                },
            );
        }

        const promptWorkbenchMatch =
            /^\/api\/prompts\/([^/]+)\/workbench$/.exec(url.pathname);
        if (request.method === "GET" && promptWorkbenchMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await promptWorkbenchSetupPayload(
                    db,
                    config,
                    teamId,
                    projectId,
                    decodeURIComponent(promptWorkbenchMatch[1]!),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/delete"
        ) {
            assertInternalToken(request, config);
            await deletePromptPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/duplicate-version"
        ) {
            assertInternalToken(request, config);
            await duplicatePromptVersionPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/judge"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await createJudgePromptPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/validation-attempt"
        ) {
            assertInternalToken(request, config);
            await recordPromptValidationAttemptPayload(
                db,
                await request.json(),
            );
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/runnable"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await saveRunnablePromptPayload(db, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/optimize"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await optimizePromptPayload(db, config, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/generate-schema"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await generatePromptSchemaPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/test-judge"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await testJudgeDraftPayload(db, config, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/test-draft"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await testPromptDraftPayload(db, config, await request.json()),
                { headers },
            );
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/prompts/validate-runnable"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await validateRunnablePromptPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        const promptDetailMatch = /^\/api\/prompts\/([^/]+)$/.exec(
            url.pathname,
        );
        if (request.method === "GET" && promptDetailMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await promptDetailPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(promptDetailMatch[1]!),
                ),
                { headers },
            );
        }

        if (url.pathname === "/api/workflows" && request.method === "GET") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            const kind = url.searchParams.get("kind")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listWorkflowsPayload(
                    db,
                    teamId,
                    projectId,
                    kind === "prompt" || kind === "stt" || kind === "multi"
                        ? kind
                        : undefined,
                ),
                { headers },
            );
        }
        if (url.pathname === "/api/workflows" && request.method === "POST") {
            assertInternalToken(request, config);
            return Response.json(
                await createWorkflowPayload(db, await request.json()),
                { headers },
            );
        }
        if (
            url.pathname === "/api/workflows/delete" &&
            request.method === "POST"
        ) {
            assertInternalToken(request, config);
            await deleteWorkflowPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }
        const workflowRunProgressMatch =
            /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)\/progress$/.exec(
                url.pathname,
            );
        if (workflowRunProgressMatch && request.method === "GET") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await workflowRunProgressPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(workflowRunProgressMatch[1]!),
                    decodeURIComponent(workflowRunProgressMatch[2]!),
                ),
                { headers },
            );
        }
        const workflowRunDetailMatch =
            /^\/api\/workflows\/([^/]+)\/runs\/([^/]+)$/.exec(url.pathname);
        if (workflowRunDetailMatch && request.method === "GET") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await workflowRunDetailPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(workflowRunDetailMatch[1]!),
                    decodeURIComponent(workflowRunDetailMatch[2]!),
                ),
                { headers },
            );
        }
        const workflowRunsMatch = /^\/api\/workflows\/([^/]+)\/runs$/.exec(
            url.pathname,
        );
        if (workflowRunsMatch && request.method === "GET") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await listWorkflowRunsPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(workflowRunsMatch[1]!),
                ),
                { headers },
            );
        }
        if (workflowRunsMatch && request.method === "POST") {
            assertInternalToken(request, config);
            const workflowId = decodeURIComponent(workflowRunsMatch[1]!);
            const body = (await request.json()) as ICreateWorkflowRunRequest;
            if (body.workflowId !== workflowId)
                throw new ApiBadRequestError(
                    "Workflow ID in the request body must match the route.",
                );
            const result = await createWorkflowRunPayload(
                db,
                body,
                await configWithTeamSttProbes(
                    db,
                    config,
                    body.teamId,
                    body.projectId,
                ),
            );
            return Response.json(
                await publishWorkflowRunEnqueue(
                    db,
                    config,
                    result.workflowRunId,
                ),
                { headers },
            );
        }
        const workflowDetailMatch = /^\/api\/workflows\/([^/]+)$/.exec(
            url.pathname,
        );
        if (workflowDetailMatch && request.method === "GET") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await workflowDetailPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(workflowDetailMatch[1]!),
                ),
                { headers },
            );
        }
        if (
            workflowDetailMatch &&
            (request.method === "POST" || request.method === "PUT")
        ) {
            assertInternalToken(request, config);
            const workflowId = decodeURIComponent(workflowDetailMatch[1]!);
            const body = (await request.json()) as IUpdateWorkflowRequest;
            if (body.workflowId !== workflowId)
                throw new ApiBadRequestError(
                    "Workflow ID in the request body must match the route.",
                );
            return Response.json(await updateWorkflowPayload(db, body), {
                headers,
            });
        }

        if (request.method === "GET" && url.pathname === "/api/runs/setup") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await runSetupPayload(
                    db,
                    await configWithTeamSttProbes(
                        db,
                        config,
                        teamId,
                        projectId,
                    ),
                    teamId,
                    projectId,
                ),
                {
                    headers,
                },
            );
        }

        if (request.method === "GET" && url.pathname === "/api/runs") {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) return missingQueryParameter("teamId", headers);
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(await listRunsPayload(db, teamId, projectId), {
                headers,
            });
        }

        if (request.method === "POST" && url.pathname === "/api/runs") {
            assertInternalToken(request, config);
            const body = (await request.json()) as ICreateRunRequest;
            const result = await createRunPayload(
                db,
                body,
                await configWithTeamSttProbes(
                    db,
                    config,
                    body.teamId,
                    body.projectId,
                ),
            );
            await enqueueRun(config, result.runId);
            return Response.json(result, { headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/runs/from-selection"
        ) {
            assertInternalToken(request, config);
            const body =
                (await request.json()) as ICreateRunFromSelectionRequest;
            const result = await createRunFromSelectionPayload(
                db,
                body,
                await configWithTeamSttProbes(
                    db,
                    config,
                    body.teamId,
                    body.projectId,
                ),
            );
            await enqueueRun(config, result.runId);
            return Response.json(result, { headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/runs/generate-judge"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await generateJudgeForRunPayload(
                    db,
                    config,
                    await request.json(),
                ),
                { headers },
            );
        }

        if (request.method === "POST" && url.pathname === "/api/runs/note") {
            assertInternalToken(request, config);
            await saveRunNotePayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (
            request.method === "POST" &&
            url.pathname === "/api/runs/cell-annotation"
        ) {
            assertInternalToken(request, config);
            return Response.json(
                await saveCellAnnotationPayload(db, await request.json()),
                { headers },
            );
        }

        if (request.method === "POST" && url.pathname === "/api/runs/delete") {
            assertInternalToken(request, config);
            await deleteRunPayload(db, await request.json());
            return new Response(null, { status: 204, headers });
        }

        if (request.method === "POST" && url.pathname === "/api/runs/retry") {
            assertInternalToken(request, config);
            const input = await request.json();
            await retryRunPayload(db, input);
            await enqueueRun(config, input.runId);
            return new Response(null, { status: 204, headers });
        }

        const runProgressMatch = /^\/api\/runs\/([^/]+)\/progress$/.exec(
            url.pathname,
        );
        if (request.method === "GET" && runProgressMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) {
                return Response.json(
                    {
                        error: "bad_request",
                        message: "Missing required query parameter: teamId",
                    },
                    { status: 400, headers },
                );
            }
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await runProgressPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(runProgressMatch[1]!),
                ),
                { headers },
            );
        }

        const runDetailMatch = /^\/api\/runs\/([^/]+)$/.exec(url.pathname);
        if (request.method === "GET" && runDetailMatch) {
            assertInternalToken(request, config);
            const teamId = url.searchParams.get("teamId")?.trim();
            const projectId = url.searchParams.get("projectId")?.trim();
            if (!teamId) {
                return Response.json(
                    {
                        error: "bad_request",
                        message: "Missing required query parameter: teamId",
                    },
                    { status: 400, headers },
                );
            }
            if (!projectId) return missingQueryParameter("projectId", headers);
            return Response.json(
                await runDetailPayload(
                    db,
                    teamId,
                    projectId,
                    decodeURIComponent(runDetailMatch[1]!),
                    url.searchParams.get("compareWith")?.trim() || undefined,
                ),
                { headers },
            );
        }

        return Response.json(
            { error: "not_found", message: "Route not found" },
            { status: 404, headers },
        );
    } catch (err) {
        const url = new URL(request.url);
        const serverFault = isServerFault(err);
        if (serverFault) recordError();
        logApiEvent(serverFault ? "error" : "warn", "request.failed", {
            requestId,
            method: request.method,
            route: url.pathname,
            errorName: err instanceof Error ? err.name : "UnknownError",
            status: errorPayload(err).status,
            // Server faults return a generic message, so the detail has to
            // be recoverable from the log.
            errorMessage:
                serverFault && err instanceof Error ? err.message : undefined,
        });
        if (serverFault) {
            captureApiException(config, err, {
                requestId,
                method: request.method,
                route: url.pathname,
            });
            notifyApiAlert(config, "Flash Evals API request failed", {
                requestId,
                route: url.pathname,
            });
        }
        return errorResponse(err, headers);
    }
}

function isServerFault(error: unknown): boolean {
    return errorPayload(error).status >= 500;
}

function trustedWorkflowLlmContext(request: Request): {
    teamId: string;
    actorId: string;
} {
    const teamId = request.headers.get("x-mosaic-team-id")?.trim();
    const actorId = request.headers.get("x-mosaic-actor-id")?.trim();
    if (!isUuid(teamId) || !isUuid(actorId)) {
        throw new ApiBadRequestError(
            "Missing or invalid trusted routing context.",
        );
    }
    return { teamId, actorId };
}

function workflowLlmTransport(value: string | null): WorkflowLlmTransport {
    const parsed = WorkflowLlmTransportSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    throw new ApiBadRequestError("Missing or invalid workflow LLM transport.");
}

function isUuid(value: string | undefined): value is string {
    return Boolean(
        value &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value,
        ),
    );
}

function missingQueryParameter(name: string, headers: HeadersInit): Response {
    return Response.json(
        {
            error: "bad_request",
            message: `Missing required query parameter: ${name}`,
        },
        { status: 400, headers },
    );
}

function isHealthPath(pathname: string): boolean {
    return pathname === "/health" || pathname === "/api/health";
}

function nodeRequest(req: IncomingMessage): Request {
    const host = req.headers.host ?? "localhost";
    const protocol = process.env.NODE_ENV === "production" ? "https" : "http";
    const url = new URL(req.url ?? "/", `${protocol}://${host}`);
    return new Request(url, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req,
        duplex: "half",
    } as RequestInit & { duplex: "half" });
}

async function writeNodeResponse(
    res: ServerResponse,
    response: Response,
): Promise<void> {
    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
        res.setHeader(key, value);
    });
    if (!response.body) {
        res.end();
        return;
    }
    await new Promise<void>((resolve, reject) => {
        Readable.fromWeb(
            response.body as Parameters<typeof Readable.fromWeb>[0],
        )
            .on("error", reject)
            .pipe(res)
            .on("error", reject)
            .on("finish", resolve);
    });
}

const isEntrypoint =
    process.argv[1] !== undefined &&
    import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
    const config = getApiConfig();
    if (config.storageAdapter === "local") {
        console.warn(
            "mosaic-api: local storage adapter active; uploads are unauthenticated. Do not expose this API publicly.",
        );
    }
    const server = createApiServer(config);
    server.listen(config.port, () => {});
}
