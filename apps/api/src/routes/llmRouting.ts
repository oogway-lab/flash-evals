import { createHash, randomUUID } from "node:crypto";
import type {
    IClearWorkflowLlmProjectDefaultRequest,
    ICreateWorkflowLlmRouteForModelRequest,
    ICreateWorkflowLlmRouteVersionRequest,
    IDisableWorkflowLlmRouteRequest,
    IRefreshWorkflowLlmCapabilitiesRequest,
    ISetWorkflowLlmProjectDefaultRequest,
    IWorkflowLlmCapability,
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmProjectDefaultMutation,
    IWorkflowLlmProjectDefaultResponse,
    IWorkflowLlmProjectDefaultState,
    IWorkflowLlmRoute,
    IWorkflowLlmRouteCandidatesResponse,
    IWorkflowLlmRouteHistoryResponse,
    IWorkflowLlmRouteConfig,
    IWorkflowLlmRouteVersion,
    IWorkflowLlmTransportCapability,
    IWorkflowNodeInput,
    WorkflowLlmGenerationControl,
    WorkflowLlmTransport,
} from "@mosaic/api-contract";
import {
    isWorkflowModelBackedNodeType,
    WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
} from "@mosaic/api-contract";
import {
    listAvailableModelMetadata,
    MODEL_REGISTRY,
    registryEntryFor,
    transportCapabilityForModel,
    type ApiKeys,
} from "@mosaic/llm-core";
import { decryptSecret } from "@mosaic/secrets";
import { ConfigError, type IApiConfig } from "../config.js";
import { type IDb, withTransaction } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiFieldValidationError,
    ApiNotFoundError,
} from "../errors.js";
import {
    assertStoredProviderBaseUrl,
    type ProviderHostResolver,
} from "../providerBaseUrl.js";
import { parseWorkflowLlmSelection } from "./llmRoutingSchemas.js";

interface ICapabilityRow {
    id: string;
    team_id: string;
    project_id: string;
    transport: WorkflowLlmTransport;
    capability_digest: string;
    capability_snapshot: IWorkflowLlmCapabilitySnapshot;
    captured_at: Date | string;
    expires_at: Date | string;
    credential_available: boolean;
}

interface IRouteRow {
    id: string;
    team_id: string;
    project_id: string;
    name: string;
    disabled_at: Date | string | null;
    created_by: string | null;
    created_at: Date | string;
    version_id: string | null;
    version: number | null;
    config: IWorkflowLlmRouteConfig | null;
    provider_key_id: string | null;
    provider_key_rotation_version: string | null;
    capability_version_id: string | null;
    version_created_by: string | null;
    version_created_at: Date | string | null;
}

interface IRouteHistoryRow {
    id: string;
    routeId: string;
    version: number;
    config: IWorkflowLlmRouteConfig;
    providerKeyId: string;
    providerKeyRotationVersion: string;
    capabilityVersionId: string;
    createdBy: string | null;
    createdAt: Date | string;
}

interface IDefaultRow {
    project_id: string;
    route_version_id: string;
    updated_by: string | null;
    updated_at: Date | string;
}

interface IStoredProviderKeyRow {
    id: string;
    provider: WorkflowLlmTransport;
    rotationVersion: string;
    ciphertext: string;
    iv: string;
    authTag: string;
    baseUrl: string | null;
}

export interface IWorkflowLlmCapabilityDiscoveryDeps {
    listModels?: typeof listAvailableModelMetadata;
    now?: () => Date;
    /** DNS resolver for re-validating the stored base URL; injectable for tests. */
    resolveHost?: ProviderHostResolver;
}

export interface IWorkflowLlmServiceContext {
    teamId: string;
    actorId: string;
}

interface IDiscoveredCapability {
    id: string;
    digest: string;
    snapshot: IWorkflowLlmCapabilitySnapshot;
}

interface ILiveProviderDiscovery {
    providerKeyId: string;
    providerKeyRotationVersion: string;
    transport: WorkflowLlmTransport;
    capturedAt: Date;
    expiresAt: Date;
    capabilities: IDiscoveredCapability[];
}

export function assertWorkflowLlmWritesEnabled(config: IApiConfig): void {
    if (config.workflowLlmWritesEnabled === false)
        throw new ApiConflictError(
            "Workflow LLM routing writes are disabled until the API and worker rollout is ready.",
        );
    if (
        config.nodeEnv === "production" &&
        config.workflowLlmWritesEnabled === true &&
        config.workflowLlmWorkerContractVersion !==
            WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION
    )
        throw new ApiConflictError(
            "Workflow LLM routing writes require a verified compatible worker contract.",
        );
}

export async function validateWorkflowLlmSelections(
    db: IDb,
    teamId: string,
    projectId: string,
    nodes: IWorkflowNodeInput[],
): Promise<void> {
    const pinnedIds: string[] = [];
    for (const [index, node] of nodes.entries()) {
        const nodeType = node.nodeType ?? "prompt";
        const selection = node.llmExecutionSelection;
        if (!selection) continue;
        if (!isWorkflowModelBackedNodeType(nodeType)) {
            throw new ApiFieldValidationError(
                `Invalid LLM routing field nodes.${index}.llmExecutionSelection: ${nodeType} nodes do not use LLM routing.`,
                `nodes.${index}.llmExecutionSelection`,
                "Remove LLM routing from non-model-backed workflow nodes.",
            );
        }
        try {
            const parsed = parseWorkflowLlmSelection(selection);
            if (parsed.mode === "pinned_route") {
                pinnedIds.push(parsed.routeVersionId);
            }
        } catch (error) {
            throw new ApiFieldValidationError(
                `Invalid LLM routing field nodes.${index}.llmExecutionSelection: ${error instanceof Error ? error.message : "invalid value"}`,
                `nodes.${index}.llmExecutionSelection`,
                "Use project_default or a pinned_route with a scoped routeVersionId.",
            );
        }
    }
    const uniqueIds = [...new Set(pinnedIds)];
    if (!uniqueIds.length) return;
    const result = await db.query<{ id: string }>(
        `select v.id
        from llm_route_versions v
        join llm_routes r on r.id = v.route_id
        where v.id = any($1::uuid[])
          and v.team_id = $2 and v.project_id = $3
          and r.team_id = $2 and r.project_id = $3
          and r.disabled_at is null`,
        [uniqueIds, teamId, projectId],
    );
    if (result.rows.length !== uniqueIds.length) throw routingNotFound();
}

export async function listWorkflowLlmCapabilitiesPayload(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IWorkflowLlmCapability[]> {
    await assertProject(db, teamId, projectId);
    const result = await db.query<ICapabilityRow>(
        `select distinct on (
            c.transport,
            c.capability_snapshot->'transport'->>'transportModelId'
        )
            c.id, c.team_id, c.project_id, c.transport,
            c.capability_digest, c.capability_snapshot,
            c.captured_at, c.expires_at,
            exists (
                select 1 from provider_keys pk
                where pk.team_id = c.team_id and pk.provider = c.transport
            ) as credential_available
        from llm_capability_versions c
        where c.team_id = $1 and c.project_id = $2
        order by c.transport,
            c.capability_snapshot->'transport'->>'transportModelId',
            c.captured_at desc, c.id desc`,
        [teamId, projectId],
    );
    return result.rows.map(capabilityFromRow);
}

export async function listWorkflowLlmRouteCandidatesPayload(
    db: IDb,
    config: IApiConfig,
    projectId: string,
    transport: WorkflowLlmTransport,
    context: IWorkflowLlmServiceContext,
    deps: IWorkflowLlmCapabilityDiscoveryDeps = {},
): Promise<IWorkflowLlmRouteCandidatesResponse> {
    const discovery = await discoverLiveProviderCapabilities(
        db,
        config,
        projectId,
        transport,
        context,
        deps,
    );
    return {
        transport,
        coverage: "provider_model_listing",
        candidates: discovery.capabilities.flatMap((capability) => {
            const modelId = capability.snapshot.transport.modelId;
            if (!modelId) return [];
            const entry = registryEntryFor(modelId);
            return [
                {
                    transport,
                    modelId,
                    label: entry?.label ?? labelForListedModel(modelId),
                    modelProvider:
                        entry?.provider ?? providerForListedModel(modelId),
                    modelProviderLabel:
                        entry?.providerLabel ??
                        providerLabelForListedModel(modelId),
                    source: "provider_model_listing" as const,
                    availability: "provider_listed_candidate" as const,
                    requiresMutationDiscovery: true as const,
                    support: {
                        upstreamRoutingModes: [
                            ...capability.snapshot.transport
                                .upstreamRoutingModes,
                        ],
                        supportedGenerationControls: [
                            ...capability.snapshot.transport
                                .supportedGenerationControls,
                        ],
                        supportsStructuredOutput:
                            capability.snapshot.transport
                                .supportsStructuredOutput,
                    },
                },
            ];
        }),
    };
}

export async function refreshWorkflowLlmCapabilitiesPayload(
    db: IDb,
    config: IApiConfig,
    input: IRefreshWorkflowLlmCapabilitiesRequest,
    deps: IWorkflowLlmCapabilityDiscoveryDeps = {},
): Promise<IWorkflowLlmCapability[]> {
    const discovery = await discoverLiveProviderCapabilities(
        db,
        config,
        input.projectId,
        input.transport,
        { teamId: input.teamId, actorId: input.refreshedBy },
        deps,
        input.providerKeyId,
    );
    for (const capability of discovery.capabilities) {
        await db.query(
            `insert into llm_capability_versions (
                id, team_id, project_id, transport, capability_digest,
                capability_snapshot, captured_at, expires_at
            ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
            on conflict (project_id, capability_digest) do nothing`,
            [
                capability.id,
                input.teamId,
                input.projectId,
                input.transport,
                capability.digest,
                JSON.stringify(capability.snapshot),
                discovery.capturedAt,
                discovery.expiresAt,
            ],
        );
    }
    return listWorkflowLlmCapabilitiesPayload(
        db,
        input.teamId,
        input.projectId,
    );
}

export async function listWorkflowLlmRoutesPayload(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IWorkflowLlmRoute[]> {
    await assertProject(db, teamId, projectId);
    const result = await db.query<IRouteRow>(
        `${routeListSql()} order by r.created_at, r.id`,
        [teamId, projectId],
    );
    return result.rows.map(routeFromRow);
}

export async function listWorkflowLlmRouteHistoryPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    routeId: string,
    beforeVersion?: number,
    limit = 50,
): Promise<IWorkflowLlmRouteHistoryResponse> {
    await assertProject(db, teamId, projectId);
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
    const result = await db.query<IRouteHistoryRow>(
        `select id, route_id as "routeId", version, config,
                provider_key_id as "providerKeyId",
                provider_key_rotation_version as "providerKeyRotationVersion",
                capability_version_id as "capabilityVersionId",
                created_by as "createdBy", created_at as "createdAt"
         from llm_route_versions
         where team_id = $1 and project_id = $2 and route_id = $3
           and ($4::int is null or version < $4)
         order by version desc
         limit $5`,
        [teamId, projectId, routeId, beforeVersion ?? null, boundedLimit + 1],
    );
    if (!result.rows.length) {
        const route = await db.query<{ id: string }>(
            `select id from llm_routes where id = $1 and team_id = $2 and project_id = $3`,
            [routeId, teamId, projectId],
        );
        if (!route.rows[0]) throw routingNotFound();
    }
    const hasNext = result.rows.length > boundedLimit;
    const versions = result.rows.slice(0, boundedLimit).map((row) => ({
        id: row.id,
        routeId: row.routeId,
        version: row.version,
        config: row.config,
        providerKeyId: row.providerKeyId,
        providerKeyRotationVersion: row.providerKeyRotationVersion,
        capabilityVersionId: row.capabilityVersionId,
        ...(row.createdBy ? { createdBy: row.createdBy } : {}),
        createdAt: iso(row.createdAt),
    }));
    return {
        routeId,
        versions,
        ...(hasNext ? { nextCursor: String(versions.at(-1)!.version) } : {}),
    };
}

export async function createWorkflowLlmRouteVersionPayload(
    db: IDb,
    config: IApiConfig,
    input: ICreateWorkflowLlmRouteVersionRequest,
    context: IWorkflowLlmServiceContext,
    deps: IWorkflowLlmCapabilityDiscoveryDeps = {},
): Promise<IWorkflowLlmRoute> {
    assertWorkflowLlmWritesEnabled(config);
    const transport = input.config.transportConfig.transport;
    const discovery = await discoverLiveProviderCapabilities(
        db,
        config,
        input.projectId,
        transport,
        context,
        deps,
    );
    const capability = discovery.capabilities.find(
        (candidate) =>
            candidate.snapshot.transport.modelId === input.config.modelId,
    );
    if (!capability) throw invalidRoute("config.modelId");
    validateWorkflowLlmRouteConfig(input.config, capability.snapshot);

    return withTransaction(db, async (tx) => {
        await assertProjectAndActor(
            tx,
            context.teamId,
            input.projectId,
            context.actorId,
        );
        const currentCredential = await tx.query<{
            id: string;
            rotationVersion: string;
        }>(
            `select id, rotation_version as "rotationVersion"
            from provider_keys
            where id = $1 and team_id = $2 and provider = $3
            for update`,
            [discovery.providerKeyId, context.teamId, discovery.transport],
        );
        const credential = currentCredential.rows[0];
        if (
            !credential ||
            credential.id !== discovery.providerKeyId ||
            credential.rotationVersion !== discovery.providerKeyRotationVersion
        ) {
            throw new ApiConflictError(
                "The provider credential changed during model discovery. Try again.",
            );
        }
        const capabilityResult = await tx.query<{ id: string }>(
            `insert into llm_capability_versions (
                id, team_id, project_id, transport, capability_digest,
                capability_snapshot, captured_at, expires_at
            ) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
            on conflict (project_id, capability_digest) do nothing
            returning id`,
            [
                capability.id,
                context.teamId,
                input.projectId,
                discovery.transport,
                capability.digest,
                JSON.stringify(capability.snapshot),
                discovery.capturedAt,
                discovery.expiresAt,
            ],
        );
        const existingCapability = capabilityResult.rows[0]
            ? undefined
            : await tx.query<{ id: string }>(
                  `select id from llm_capability_versions
                  where project_id = $1 and capability_digest = $2`,
                  [input.projectId, capability.digest],
              );
        const capabilityVersionId =
            capabilityResult.rows[0]?.id ?? existingCapability?.rows[0]?.id;
        if (!capabilityVersionId)
            throw new Error("Failed to capture LLM capability evidence.");

        let routeId = input.routeId;
        if (routeId) {
            const existing = await tx.query<{
                id: string;
                disabled_at: unknown;
            }>(
                `select id, disabled_at from llm_routes
                where id = $1 and team_id = $2 and project_id = $3
                for update`,
                [routeId, context.teamId, input.projectId],
            );
            if (!existing.rows[0]) throw routingNotFound();
            if (existing.rows[0].disabled_at) {
                throw new ApiConflictError(
                    "Disabled LLM routes cannot receive new versions.",
                );
            }
        } else {
            const created = await tx.query<{ id: string }>(
                `insert into llm_routes (
                    team_id, project_id, name, created_by
                ) values ($1, $2, $3, $4)
                returning id`,
                [
                    context.teamId,
                    input.projectId,
                    input.name.trim(),
                    context.actorId,
                ],
            );
            routeId = created.rows[0]?.id;
            if (!routeId) throw new Error("Failed to create LLM route.");
        }

        const versionResult = await tx.query<{ next_version: number }>(
            `select coalesce(max(version), 0) + 1 as next_version
            from llm_route_versions
            where route_id = $1`,
            [routeId],
        );
        const version = Number(versionResult.rows[0]?.next_version ?? 1);
        await tx.query(
            `insert into llm_route_versions (
                team_id, project_id, route_id, version, config,
                provider_key_id, provider_key_rotation_version,
                capability_version_id, created_by
            ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`,
            [
                context.teamId,
                input.projectId,
                routeId,
                version,
                JSON.stringify(input.config),
                discovery.providerKeyId,
                discovery.providerKeyRotationVersion,
                capabilityVersionId,
                context.actorId,
            ],
        );
        return requireRoute(tx, context.teamId, input.projectId, routeId);
    });
}

/**
 * Compatibility alias for callers that still use the old operation name.
 * Both simple and advanced route authoring now use the same semantic contract.
 */
export async function createWorkflowLlmRouteForModelPayload(
    db: IDb,
    config: IApiConfig,
    input: ICreateWorkflowLlmRouteForModelRequest,
    context: IWorkflowLlmServiceContext,
    deps: IWorkflowLlmCapabilityDiscoveryDeps = {},
): Promise<IWorkflowLlmRoute> {
    return createWorkflowLlmRouteVersionPayload(
        db,
        config,
        input,
        context,
        deps,
    );
}

export async function disableWorkflowLlmRoutePayload(
    db: IDb,
    input: IDisableWorkflowLlmRouteRequest,
): Promise<IWorkflowLlmRoute> {
    return withTransaction(db, async (tx) => {
        await assertProjectAndActor(
            tx,
            input.teamId,
            input.projectId,
            input.disabledBy,
        );
        const result = await tx.query<{ id: string }>(
            `update llm_routes
            set disabled_at = coalesce(disabled_at, now())
            where id = $1 and team_id = $2 and project_id = $3
            returning id`,
            [input.routeId, input.teamId, input.projectId],
        );
        if (!result.rows[0]) throw routingNotFound();
        await tx.query(
            `delete from project_llm_defaults d
            using llm_route_versions v
            where d.team_id = $1 and d.project_id = $2
              and d.route_version_id = v.id and v.route_id = $3`,
            [input.teamId, input.projectId, input.routeId],
        );
        return requireRoute(tx, input.teamId, input.projectId, input.routeId);
    });
}

export async function getWorkflowLlmProjectDefaultPayload(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IWorkflowLlmProjectDefaultResponse> {
    await assertProject(db, teamId, projectId);
    const current = await readDefault(db, teamId, projectId);
    return current ? { default: current } : {};
}

export async function setWorkflowLlmProjectDefaultPayload(
    db: IDb,
    input: ISetWorkflowLlmProjectDefaultRequest,
): Promise<IWorkflowLlmProjectDefaultMutation> {
    return withTransaction(db, async (tx) => {
        await assertProjectAndActor(
            tx,
            input.teamId,
            input.projectId,
            input.updatedBy,
        );
        const oldDefault = await readDefault(tx, input.teamId, input.projectId);
        const route = await tx.query<{ id: string }>(
            `select v.id
            from llm_route_versions v
            join llm_routes r on r.id = v.route_id
            where v.id = $1 and v.team_id = $2 and v.project_id = $3
              and r.team_id = $2 and r.project_id = $3
              and r.disabled_at is null`,
            [input.routeVersionId, input.teamId, input.projectId],
        );
        if (!route.rows[0]) throw routingNotFound();
        await tx.query(
            `insert into project_llm_defaults (
                project_id, team_id, route_version_id, updated_by, updated_at
            ) values ($1, $2, $3, $4, now())
            on conflict (project_id) do update set
                team_id = excluded.team_id,
                route_version_id = excluded.route_version_id,
                updated_by = excluded.updated_by,
                updated_at = excluded.updated_at`,
            [
                input.projectId,
                input.teamId,
                input.routeVersionId,
                input.updatedBy,
            ],
        );
        const newDefault = await readDefault(tx, input.teamId, input.projectId);
        return {
            ...(oldDefault ? { oldDefault } : {}),
            ...(newDefault ? { newDefault } : {}),
            updatedBy: input.updatedBy,
        };
    });
}

export async function clearWorkflowLlmProjectDefaultPayload(
    db: IDb,
    input: IClearWorkflowLlmProjectDefaultRequest,
): Promise<IWorkflowLlmProjectDefaultMutation> {
    return withTransaction(db, async (tx) => {
        await assertProjectAndActor(
            tx,
            input.teamId,
            input.projectId,
            input.updatedBy,
        );
        const oldDefault = await readDefault(tx, input.teamId, input.projectId);
        await tx.query(
            `delete from project_llm_defaults
            where team_id = $1 and project_id = $2`,
            [input.teamId, input.projectId],
        );
        return {
            ...(oldDefault ? { oldDefault } : {}),
            updatedBy: input.updatedBy,
        };
    });
}

export function validateWorkflowLlmRouteConfig(
    config: IWorkflowLlmRouteConfig,
    snapshot: IWorkflowLlmCapabilitySnapshot,
): void {
    validatePinnedWorkflowLlmRouteConfig(config, snapshot);
}

export function validatePinnedWorkflowLlmRouteConfig(
    config: IWorkflowLlmRouteConfig,
    snapshot: IWorkflowLlmCapabilitySnapshot,
): void {
    const transport = config.transportConfig.transport;
    if (snapshot.transport.transport !== transport) {
        throw invalidRoute("config.transportConfig.transport");
    }
    if (
        snapshot.transport.modelId !== undefined &&
        snapshot.transport.modelId !== config.modelId
    ) {
        throw invalidRoute("config.modelId");
    }
    const requestedControls = generationControls(config);
    for (const control of requestedControls) {
        if (!snapshot.transport.supportedGenerationControls.includes(control)) {
            throw invalidRoute(`config.generation.${control}`);
        }
    }
    if (
        config.structuredOutput.mode === "json_schema" &&
        !snapshot.transport.supportsStructuredOutput
    ) {
        throw invalidRoute("config.structuredOutput");
    }
    if (transport === "openrouter") {
        const mode = config.transportConfig.upstreamPolicy.mode;
        if (!snapshot.transport.upstreamRoutingModes.includes(mode)) {
            throw invalidRoute("config.transportConfig.upstreamPolicy.mode");
        }
        const available = new Set(snapshot.supportedUpstreamProviders ?? []);
        const selected =
            mode === "preference"
                ? config.transportConfig.upstreamPolicy.order
                : mode === "exact"
                  ? config.transportConfig.upstreamPolicy.only
                  : [];
        if (selected.some((provider) => !available.has(provider))) {
            throw invalidRoute("config.transportConfig.upstreamPolicy");
        }
    }
}

function generationControls(
    config: IWorkflowLlmRouteConfig,
): WorkflowLlmGenerationControl[] {
    const controls: WorkflowLlmGenerationControl[] = ["maxOutputTokens"];
    if (config.generation.temperature !== undefined)
        controls.push("temperature");
    if (config.generation.topP !== undefined) controls.push("topP");
    if (config.generation.seed !== undefined) controls.push("seed");
    if (config.generation.reasoningEffort !== undefined)
        controls.push("reasoningEffort");
    return controls;
}

async function discoverLiveProviderCapabilities(
    db: IDb,
    config: IApiConfig,
    projectId: string,
    transport: WorkflowLlmTransport,
    context: IWorkflowLlmServiceContext,
    deps: IWorkflowLlmCapabilityDiscoveryDeps,
    providerKeyId?: string,
): Promise<ILiveProviderDiscovery> {
    await assertProjectAndActor(db, context.teamId, projectId, context.actorId);
    const keyResult = await db.query<IStoredProviderKeyRow>(
        `select id, provider,
            rotation_version as "rotationVersion",
            ciphertext, iv, auth_tag as "authTag",
            base_url as "baseUrl"
        from provider_keys
        where team_id = $1 and provider = $2
          and ($3::uuid is null or id = $3)
        limit 1`,
        [context.teamId, transport, providerKeyId ?? null],
    );
    const keyRow = keyResult.rows[0];
    if (!keyRow) throw routingNotFound();
    if (transport === "bifrost" && !keyRow.baseUrl) {
        throw new ApiBadRequestError(
            "Bifrost needs a base URL. Save the public HTTPS URL of your Bifrost OpenAI-compatible endpoint in Settings, then try again.",
        );
    }
    if (!config.mosaicSecretsEncKey) {
        throw new ConfigError(
            "Missing required API env: MOSAIC_SECRETS_ENC_KEY",
        );
    }
    const key = decryptSecret(
        keyRow,
        { teamId: context.teamId, provider: transport },
        config.mosaicSecretsEncKey,
    );
    const baseUrl = keyRow.baseUrl
        ? await assertStoredProviderBaseUrl(keyRow.baseUrl, deps.resolveHost)
        : null;
    const apiKeys = apiKeysForStoredCredential(transport, key, baseUrl);
    let liveModels: Awaited<ReturnType<typeof listAvailableModelMetadata>>;
    try {
        liveModels = await (deps.listModels ?? listAvailableModelMetadata)(
            apiKeys,
            { provider: transport },
        );
    } catch {
        throw new ApiConflictError(
            "The provider model list is temporarily unavailable. Try again.",
        );
    }
    const liveModelIds = liveModels.map((model) => model.id);
    const capturedAt = (deps.now ?? (() => new Date()))();
    const expiresAt = new Date(capturedAt.getTime() + 60 * 60 * 1_000);
    const capabilities: IDiscoveredCapability[] = [];
    const discoveredModelIds = new Set<string>();

    for (const liveModel of liveModels) {
        const discovered = capabilityForListedModel(
            transport,
            liveModel.id,
            liveModelIds,
        );
        const { modelId, baseCapability, transportModelId } = discovered;
        if (discoveredModelIds.has(modelId)) continue;
        discoveredModelIds.add(modelId);
        if (!transportModelId) continue;
        const capabilityVersionId = randomUUID();
        const transportCapability: IWorkflowLlmTransportCapability = {
            ...baseCapability,
            // Bifrost can expose an upstream prefix (for example
            // `openrouter/google/gemma-…`). Persist the provider-advertised
            // identifier so the execution request uses exactly the model that
            // was discovered, while modelId stays Flash Evals's canonical ID.
            transportModelId,
            modelId,
            // A model-list response proves only that the model identifier is
            // currently listed. It does not prove endpoint/provider slugs.
            upstreamRoutingModes:
                transport === "openrouter"
                    ? ["auto"]
                    : [...baseCapability.upstreamRoutingModes],
            supportedGenerationControls: [
                ...baseCapability.supportedGenerationControls,
            ],
        };
        const facts = {
            capturedAt: capturedAt.toISOString(),
            transport: transportCapability,
            supportedUpstreamProviders:
                transport === "openrouter" ? [] : undefined,
        };
        const digest = createHash("sha256")
            .update(JSON.stringify(facts))
            .digest("hex");
        capabilities.push({
            id: capabilityVersionId,
            digest,
            snapshot: {
                capabilityVersionId,
                capabilityDigest: digest,
                capturedAt: capturedAt.toISOString(),
                stale: false,
                transport: transportCapability,
                ...(transport === "openrouter"
                    ? { supportedUpstreamProviders: [] }
                    : {}),
            },
        });
    }
    return {
        providerKeyId: keyRow.id,
        providerKeyRotationVersion: keyRow.rotationVersion,
        transport,
        capturedAt,
        expiresAt,
        capabilities,
    };
}

function capabilityForListedModel(
    transport: WorkflowLlmTransport,
    listedModelId: string,
    liveModelIds: readonly string[],
): {
    modelId: string;
    baseCapability: IWorkflowLlmTransportCapability;
    transportModelId?: string;
} {
    const registered = registeredEntryForListedModel(transport, listedModelId);
    const modelId = registered?.id ?? listedModelId;
    const staticCapability = transportCapabilityForModel(modelId, transport);
    return {
        modelId,
        baseCapability: staticCapability
            ? {
                  ...staticCapability,
                  upstreamRoutingModes: [
                      ...staticCapability.upstreamRoutingModes,
                  ],
                  supportedGenerationControls: [
                      ...staticCapability.supportedGenerationControls,
                  ],
              }
            : defaultCapabilityForListedModel(transport),
        transportModelId: staticCapability
            ? liveTransportModelId(
                  transport,
                  staticCapability.transportModelId,
                  liveModelIds,
              )
            : listedModelId,
    };
}

function registeredEntryForListedModel(
    transport: WorkflowLlmTransport,
    listedModelId: string,
) {
    const direct = registryEntryFor(listedModelId);
    if (direct) return direct;
    if (transport !== "bifrost") return undefined;
    return MODEL_REGISTRY.find((entry) =>
        bifrostModelIdMatches(
            listedModelId,
            transportCapabilityForModel(entry.id, transport)?.transportModelId,
        ),
    );
}

function defaultCapabilityForListedModel(
    transport: WorkflowLlmTransport,
): IWorkflowLlmTransportCapability {
    return {
        transport,
        transportModelId: "",
        upstreamRoutingModes:
            transport === "openrouter"
                ? ["auto"]
                : transport === "gateway" || transport === "bifrost"
                  ? ["auto"]
                  : ["none"],
        supportedGenerationControls: ["maxOutputTokens"],
        supportsStructuredOutput: false,
        requiresCurrentDiscovery: transport !== "openai",
    };
}

function providerForListedModel(modelId: string): string {
    return modelId.includes("/")
        ? (modelId.split("/", 1)[0] ?? "model")
        : "openai";
}

function providerLabelForListedModel(modelId: string): string {
    const provider = providerForListedModel(modelId);
    return provider[0]?.toUpperCase() + provider.slice(1);
}

function labelForListedModel(modelId: string): string {
    const name = modelId.includes("/")
        ? (modelId.split("/", 2)[1] ?? modelId)
        : modelId;
    return name
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part[0]?.toUpperCase() + part.slice(1))
        .join(" ");
}

function liveTransportModelId(
    transport: WorkflowLlmTransport,
    expectedModelId: string | undefined,
    liveModelIds: readonly string[],
): string | undefined {
    if (!expectedModelId) return undefined;
    if (transport !== "bifrost") {
        return liveModelIds.includes(expectedModelId)
            ? expectedModelId
            : undefined;
    }
    return liveModelIds
        .filter((modelId) => bifrostModelIdMatches(modelId, expectedModelId))
        .sort((left, right) =>
            compareBifrostTransportModelIds(left, right, expectedModelId),
        )[0];
}

function compareBifrostTransportModelIds(
    left: string,
    right: string,
    expectedModelId: string,
): number {
    // Prefer Bifrost's un-namespaced canonical ID when it is available. Other
    // upstream-qualified IDs are sorted so a provider's response order never
    // changes the immutable route binding that Flash Evals creates.
    const leftExact = Number(left === expectedModelId);
    const rightExact = Number(right === expectedModelId);
    return rightExact - leftExact || left.localeCompare(right);
}

/**
 * Bifrost's `/models` list can namespace a provider model with the upstream
 * route (`openrouter/`, `bedrock/`, `gemini/`, etc.). Flash Evals keeps canonical
 * model IDs in the registry, so match a listed model only when its normalized
 * terminal identifier is the known registered model. This is deliberately a
 * suffix match: it supports new Bifrost upstreams without treating unrelated
 * model IDs as supported.
 */
function bifrostModelIdMatches(
    listedModelId: string,
    expectedModelId: string | undefined,
): boolean {
    if (!expectedModelId) return false;
    const listed = normalizeBifrostModelId(listedModelId);
    const expected = normalizeBifrostModelId(expectedModelId);
    return listed === expected || listed.endsWith(`/${expected}`);
}

function normalizeBifrostModelId(modelId: string): string {
    const withoutVariant = modelId.replace(/:[^/]+$/, "");
    return withoutVariant
        .toLowerCase()
        .replaceAll(".", "/")
        .replace(/^gemini\//, "google/")
        .replace(/\/{2,}/g, "/");
}

function apiKeysForStoredCredential(
    transport: WorkflowLlmTransport,
    key: string,
    baseUrl: string | null,
): ApiKeys {
    if (transport === "openai") return { openai: key };
    if (transport === "gateway") return { gateway: key };
    if (transport === "openrouter") {
        return {
            openrouter: key,
            ...(baseUrl ? { openrouterBaseUrl: baseUrl } : {}),
        };
    }
    return {
        bifrost: key,
        ...(baseUrl ? { bifrostBaseUrl: baseUrl } : {}),
    };
}

async function assertProject(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<void> {
    const result = await db.query(
        `select 1 from projects where id = $2 and team_id = $1`,
        [teamId, projectId],
    );
    if (!result.rows[0]) throw routingNotFound();
}

async function assertProjectAndActor(
    db: IDb,
    teamId: string,
    projectId: string,
    actorId: string,
): Promise<void> {
    const result = await db.query(
        `select 1
        from projects p
        join users u on u.id = $3 and u.team_id = p.team_id
        where p.team_id = $1 and p.id = $2`,
        [teamId, projectId, actorId],
    );
    if (!result.rows[0]) throw routingNotFound();
}

async function requireRoute(
    db: IDb,
    teamId: string,
    projectId: string,
    routeId: string,
): Promise<IWorkflowLlmRoute> {
    const result = await db.query<IRouteRow>(
        `${routeListSql()} and r.id = $3`,
        [teamId, projectId, routeId],
    );
    const row = result.rows[0];
    if (!row) throw routingNotFound();
    return routeFromRow(row);
}

function routeListSql(): string {
    return `select r.id, r.team_id, r.project_id, r.name, r.disabled_at,
        r.created_by, r.created_at,
        v.id as version_id, v.version, v.config, v.provider_key_id,
        v.provider_key_rotation_version, v.capability_version_id,
        v.created_by as version_created_by,
        v.created_at as version_created_at

    from llm_routes r
    left join lateral (
        select * from llm_route_versions candidate
        where candidate.route_id = r.id
        order by candidate.version desc
        limit 1
    ) v on true
    where r.team_id = $1 and r.project_id = $2`;
}

async function readDefault(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IWorkflowLlmProjectDefaultState | undefined> {
    const result = await db.query<IDefaultRow>(
        `select project_id, route_version_id, updated_by, updated_at
        from project_llm_defaults
        where team_id = $1 and project_id = $2`,
        [teamId, projectId],
    );
    const row = result.rows[0];
    return row
        ? {
              projectId: row.project_id,
              routeVersionId: row.route_version_id,
              ...(row.updated_by ? { updatedBy: row.updated_by } : {}),
              updatedAt: iso(row.updated_at),
          }
        : undefined;
}

function capabilityFromRow(row: ICapabilityRow): IWorkflowLlmCapability {
    const expiresAt = iso(row.expires_at);
    return {
        id: row.id,
        teamId: row.team_id,
        projectId: row.project_id,
        transport: row.transport,
        capabilityDigest: row.capability_digest,
        snapshot: {
            ...row.capability_snapshot,
            stale: new Date(expiresAt).getTime() <= Date.now(),
        },
        capturedAt: iso(row.captured_at),
        expiresAt,
        credentialAvailable: row.credential_available,
    };
}

function routeFromRow(row: IRouteRow): IWorkflowLlmRoute {
    const latestVersion: IWorkflowLlmRouteVersion | undefined =
        row.version_id &&
        row.version !== null &&
        row.config &&
        row.provider_key_id &&
        row.provider_key_rotation_version &&
        row.capability_version_id &&
        row.version_created_at
            ? {
                  id: row.version_id,
                  routeId: row.id,
                  version: row.version,
                  config: row.config,
                  providerKeyId: row.provider_key_id,
                  providerKeyRotationVersion: row.provider_key_rotation_version,
                  capabilityVersionId: row.capability_version_id,
                  ...(row.version_created_by
                      ? { createdBy: row.version_created_by }
                      : {}),
                  createdAt: iso(row.version_created_at),
              }
            : undefined;
    return {
        id: row.id,
        teamId: row.team_id,
        projectId: row.project_id,
        name: row.name,
        ...(row.disabled_at ? { disabledAt: iso(row.disabled_at) } : {}),
        ...(latestVersion ? { latestVersion } : {}),
        ...(latestVersion ? { versions: [latestVersion] } : {}),
        ...(row.created_by ? { createdBy: row.created_by } : {}),
        createdAt: iso(row.created_at),
    };
}

function invalidRoute(path: string): ApiFieldValidationError {
    return new ApiFieldValidationError(
        `Invalid LLM routing field ${path}. Choose a value supported by the provider's current model listing.`,
        path,
        "Choose a listed model and only the controls currently shown for that provider.",
    );
}

function routingNotFound(): ApiNotFoundError {
    return new ApiNotFoundError(
        "LLM routing resource was not found or is unavailable.",
    );
}

function iso(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}
