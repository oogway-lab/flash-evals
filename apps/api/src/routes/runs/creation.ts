import { createHash } from "node:crypto";
import { createRunWithIdempotency } from "../../runIdempotency.js";
import type {
    EvalProviderMode,
    ICreateRunRequest,
    ICreateRunResponse,
    ICreateRunFromSelectionRequest,
    IJsonSchemaObject,
    IPipelineFieldConfig,
    IReasoningConfig,
    IRunSetupResponse,
    ISttRunEvaluation,
    ISttRunConfig,
    ISttRunVariant,
    ISttTransliterationConfig,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { isRunTemperature } from "@flash-evals/api-contract";
import {
    DIRECT_MAKER_HOSTS,
    bifrostModelIdFor,
    bifrostModelListKeyFor,
    bifrostRoutesViaOpenRouter,
    bifrostUpstream,
    isDirectMakerTransport,
    makerOfModel,
    registryEntryForBifrostModel,
    rejectsSamplingSettings,
    thinkingPlanFor,
    transportModelIdFor,
} from "@flash-evals/llm-core";
import {
    MAX_RUN_COST_LIMIT_USD,
    MAX_STT_VARIANTS,
    sttMetricsModelId,
    sttModelIdentityForId,
} from "@flash-evals/api-contract";
import { normalizeProviderMode, type IApiConfig } from "../../config.js";
import { validateRunBenchmark } from "./benchmark.js";
import { filterItemsByLabel, resolveItemFilter } from "./itemFilter.js";
import { assertModelMapsToTransport } from "./modelTransport.js";
import { defaultProvider, savedKeyProviders } from "../modelProviders.js";
import {
    keyPhrase,
    TRANSPORT_LABELS_FOR_MESSAGES,
} from "../../transportLabels.js";
import type { IDb } from "../../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../../errors.js";
import {
    availableModelOptions,
    modelAllowedForProvider,
    registryEntryFor,
    registryModelFor,
} from "../../modelRegistry.js";
import {
    invalidSttConfigMessages,
    resolveSttModelDefinition,
    sttModelOptions,
    unsupportedSttConfigKeys,
} from "../../sttModels.js";
import { sttModelSupportsLanguage } from "@flash-evals/api-contract";
import {
    resolveApiKeys,
    teamBaseUrlListingGuard,
} from "../../secrets/resolveApiKeys.js";
import {
    assertRunCellLimit,
    assertTeamSpendUnderCap,
} from "../../runLimits.js";

interface IRunCreateDatasetRow {
    id: string;
    team_id: string;
    archived_at: Date | string | null;
    modality?: "audio" | "image" | "text";
}

interface ISelectionDatasetRow extends Required<IRunCreateDatasetRow> {
    purpose: "golden" | "evaluation";
}

interface IRunCreateSourceRunRow {
    id: string;
    dataset_id: string;
}

interface ICreateRunPipelineRow {
    id: string;
    team_id: string;
    output_schema: Record<string, unknown>;
    field_configs: IPipelineFieldConfig[];
}

interface ICreateRunPromptVersionRow {
    id: string;
    prompt_id: string;
    version: number | string;
    schema_version_id: string | null;
    status: "legacy" | "runnable";
    reasoning_config: IReasoningConfig | null;
}

interface ICreateRunPromptRow {
    id: string;
    team_id: string;
    name: string;
    kind: "eval" | "judge";
}

interface ICreateRunSchemaVersionRow {
    id: string;
    version: number | string;
    json_schema: Record<string, unknown>;
    field_configs: IPipelineFieldConfig[];
    schema_hash: string;
}

interface ICreateRunFitTagRow {
    tag: string;
}

interface IResolvedPromptRow {
    modelId: string;
    version: ICreateRunPromptVersionRow & { schema_version_id: string };
    prompt: ICreateRunPromptRow;
    schemaVersion: ICreateRunSchemaVersionRow;
    fitTags: string[];
    reasoningConfig?: IReasoningConfig;
}

interface IRunCreateItemRow {
    id: string;
    input_text: string | null;
    storage_key: string | null;
}

interface IDatasetOptionRow {
    id: string;
    name: string;
    purpose: "golden" | "evaluation";
    modality: "audio" | "image" | "text";
    item_count: number | string;
    labeled_item_count: number | string;
    avg_input_chars: number | string | null;
}

interface IBundleOptionRow {
    id: string;
    name: string;
    field_configs: IPipelineFieldConfig[];
}

interface IVersionOptionRow {
    id: string;
    prompt_name: string;
    version: number | string;
    json_schema: Record<string, unknown>;
    field_configs: IPipelineFieldConfig[];
    reasoning_config:
        IRunSetupResponse["versionOptions"][number]["reasoningConfig"] | null;
    prompt_chars: number | string | null;
}

interface IJudgePromptOptionRow {
    prompt_version_id: string;
    prompt_name: string;
    version: number | string;
    judge_spec: unknown;
}

export async function runSetupPayload(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
): Promise<IRunSetupResponse> {
    const keysPromise = resolveApiKeys(db, config, teamId);
    const preferredProvider = defaultProvider(config);
    const modelsPromise = keysPromise.then((resolved) =>
        availableModelOptions(resolved.apiKeys, {
            beforeListing: teamBaseUrlListingGuard(resolved),
            preferredProvider,
        }),
    );
    const [
        datasets,
        bundles,
        versionOptions,
        judgePrompts,
        models,
        resolvedKeys,
    ] = await Promise.all([
        listRunSetupDatasets(db, teamId, projectId),
        listRunSetupBundles(db, teamId, projectId),
        listRunSetupVersions(db, teamId, projectId),
        listRunSetupJudgePrompts(db, teamId, projectId),
        modelsPromise,
        keysPromise,
    ]);
    return {
        datasets,
        bundles,
        versionOptions,
        availableModels: models.models,
        modelsDegraded: models.degraded,
        ...(models.bifrostModelListError
            ? { bifrostModelListError: models.bifrostModelListError }
            : {}),
        hasPrompt: versionOptions.length > 0,
        judgePrompts,
        sttModels: sttModelOptions(
            configWithResolvedKeys(config, resolvedKeys),
            config.sttCapabilityProbes,
        ),
        savedKeyProviders: savedKeyProviders(resolvedKeys.apiKeys),
        ...(preferredProvider ? { preferredProvider } : {}),
    };
}

/**
 * How a run is created. A setup comparison's eval run may hold only the
 * reference model when the comparison's candidates are all pipelines.
 */
export interface IRunCreateOptions {
    allowReferenceOnly?: boolean;
}

export async function createRunPayload(
    db: IDb,
    input: ICreateRunRequest,
    config?: IApiConfig,
    options: IRunCreateOptions = {},
): Promise<ICreateRunResponse> {
    return createRunWithIdempotency(db, input, "models", async (tx) => {
        const preparedInput = judgesOnBifrostRun(
            inputWithSttVariantModels(input),
        );
        validateRunModelTransports(preparedInput);
        validateRunTemperatures(preparedInput.models);
        validateUniqueModelIds(
            preparedInput.models.map(({ modelId }) => modelId),
        );
        validateRunBenchmark(preparedInput, undefined, options);
        validateRunMaxCost(preparedInput);
        validateRunDataPolicy(preparedInput, config);
        await validateTransportKeysWithResolvedKeys(tx, preparedInput, config);
        await validateTransliterationKeysWithResolvedKeys(
            tx,
            preparedInput,
            config,
        );
        return createRunPayloadInTransaction(tx, preparedInput, config);
    });
}

/**
 * A run whose models all go through Bifrost sends its judges there too,
 * unless a judge's provider was chosen: a team on Bifrost may have no other
 * gateway key.
 */
export function judgesOnBifrostRun(
    input: ICreateRunRequest,
): ICreateRunRequest {
    const allBifrost =
        input.models.length > 0 &&
        input.models.every((model) => model.transport === "bifrost");
    if (!allBifrost) return input;
    return {
        ...input,
        ...(input.runJudge && !input.runJudge.transport
            ? { runJudge: { ...input.runJudge, transport: "bifrost" } }
            : {}),
        ...(input.benchmark?.judge && !input.benchmark.judge.transport
            ? {
                  benchmark: {
                      ...input.benchmark,
                      judge: { ...input.benchmark.judge, transport: "bifrost" },
                  },
              }
            : {}),
    };
}

function onBifrost(
    transport: ProviderTransport | undefined,
    config: Pick<IApiConfig, "flashEvalsLlmProvider"> | undefined,
): boolean {
    return (
        transport === "bifrost" ||
        (transport === undefined && config?.flashEvalsLlmProvider === "bifrost")
    );
}

/**
 * Bifrost passes OpenRouter's provider settings on for an openrouter/ id,
 * as pipeline steps do; other upstreams can't follow data rules.
 */
function assertBifrostCanFollowRules(call: {
    name: string;
    transportModelId?: string;
}): void {
    const bifrostId = call.transportModelId ?? bifrostModelIdFor(call.name);
    if (bifrostRoutesViaOpenRouter(bifrostId)) return;
    throw new ApiBadRequestError(
        `dataPolicy: Bifrost sends ${call.name} as "${bifrostId}" to ${bifrostUpstream(bifrostId) ?? "its default provider"}, not OpenRouter, so it can't follow the data rules. Choose a Bifrost model ID that starts with openrouter/.`,
    );
}

/** A spend limit must be a positive number of USD within the API's bound. */
export function validateRunMaxCost(input: { maxCostUsd?: number }): void {
    const value = input.maxCostUsd;
    if (value === undefined) return;
    if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        value <= 0 ||
        value > MAX_RUN_COST_LIMIT_USD
    )
        throw new ApiBadRequestError(
            `The spend limit must be more than $0 and at most $${MAX_RUN_COST_LIMIT_USD.toLocaleString("en-US")}.`,
        );
}

function inputWithSttVariantModels(
    input: ICreateRunRequest,
): ICreateRunRequest {
    if (input.audioRunMode !== "stt_metrics" || input.sttVariants === undefined)
        return input;
    const variants = normalizeSttVariants(input.sttVariants, input.sttConfig);
    return {
        ...input,
        models: variants.map((variant, index) => ({
            modelId: sttMetricsModelId(
                variant.config.modelId,
                variant.variantKey,
            ),
            promptVersionId: null,
            isReference: index === 0,
        })),
    };
}

async function validateTransportKeysWithResolvedKeys(
    db: IDb,
    input: ICreateRunRequest,
    config: IApiConfig | undefined,
): Promise<void> {
    const hasExplicitTransport =
        input.models.some((model) => model.transport) ||
        Boolean(input.runJudge?.transport) ||
        Boolean(input.benchmark?.judge?.transport);
    if (!hasExplicitTransport) return;
    const effectiveConfig = config
        ? configWithResolvedKeys(
              config,
              await resolveApiKeys(db, config, input.teamId),
          )
        : undefined;
    await validateTransportKeys(input, effectiveConfig);
}

function configWithResolvedKeys(
    config: IApiConfig,
    resolved: Awaited<ReturnType<typeof resolveApiKeys>>,
): IApiConfig {
    return {
        ...config,
        openaiApiKey: resolved.apiKeys.openai,
        aiGatewayApiKey: resolved.apiKeys.gateway,
        sonioxApiKey: resolved.sttProviderKeys.soniox,
        elevenlabsApiKey: resolved.sttProviderKeys.elevenlabs,
        geminiApiKey: resolved.sttProviderKeys.gemini,
        openrouterApiKey: resolved.apiKeys.openrouter,
        openrouterBaseUrl: resolved.apiKeys.openrouterBaseUrl,
        bifrostApiKey: resolved.apiKeys.bifrost,
        bifrostBaseUrl: resolved.apiKeys.bifrostBaseUrl,
        anthropicApiKey: resolved.apiKeys.anthropic,
        googleApiKey: resolved.apiKeys.google,
    };
}

async function validateTransportKeys(
    input: ICreateRunRequest,
    config: IApiConfig | undefined,
): Promise<void> {
    const transports = [
        ...new Set([
            ...input.models.flatMap((model) =>
                model.transport ? [model.transport] : [],
            ),
            ...(input.runJudge?.transport ? [input.runJudge.transport] : []),
            ...(input.benchmark?.judge?.transport
                ? [input.benchmark.judge.transport]
                : []),
        ]),
    ];
    if (transports.length === 0) return;
    if (!config) {
        throw new ApiBadRequestError(
            "Provider configuration is required for explicit transport selections.",
        );
    }
    for (const transport of transports) {
        if (!transportApiKey(config, transport)) {
            throw new ApiBadRequestError(
                `transportAssignments: Add ${keyPhrase(transport)} in Settings before running models through ${TRANSPORT_LABELS_FOR_MESSAGES[transport]}.`,
            );
        }
    }
}

function transportApiKey(
    config: IApiConfig,
    transport: ProviderTransport,
): string | undefined {
    const apiKeys: Record<ProviderTransport, string | undefined> = {
        openai: config.openaiApiKey,
        gateway: config.aiGatewayApiKey,
        openrouter: config.openrouterApiKey,
        bifrost: config.bifrostApiKey,
        anthropic: config.anthropicApiKey,
        google: config.googleApiKey,
    };
    return apiKeys[transport];
}

/** Checks transliteration providers against the team's saved keys too. */
async function validateTransliterationKeysWithResolvedKeys(
    db: IDb,
    input: ICreateRunRequest,
    config: IApiConfig | undefined,
): Promise<void> {
    const sttConfigs = [
        input.sttConfig,
        ...(input.sttVariants ?? []).map((variant) => variant?.config),
        ...(input.sttEvaluation?.transliteration
            ? [{ transliteration: input.sttEvaluation.transliteration }]
            : []),
    ] as (ISttRunConfig | undefined)[];
    const asksForProvider = sttConfigs.some(
        (sttConfig) =>
            sttConfig?.transliteration?.enabled &&
            requestedTransliterationProviderMode(sttConfig.transliteration) !==
                undefined,
    );
    if (!asksForProvider) return;
    const effectiveConfig = config
        ? configWithResolvedKeys(
              config,
              await resolveApiKeys(db, config, input.teamId),
          )
        : undefined;
    validateTransliterationProviderKeys(sttConfigs, effectiveConfig);
}

// Gateway host names, e.g. "vertex", "vertexAnthropic", "google-vertex".
const HOST_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

/** Checks a data policy's allowed-host list and returns it (empty when unset). */
export function validateDataPolicyHosts(
    policy: NonNullable<ICreateRunRequest["dataPolicy"]>,
): string[] {
    const hosts = policy.onlyHosts ?? [];
    if (!Array.isArray(hosts) || hosts.length > 30)
        throw new ApiBadRequestError(
            "dataPolicy: onlyHosts must be a list of at most 30 host names.",
        );
    for (const host of hosts)
        if (typeof host !== "string" || !HOST_NAME.test(host))
            throw new ApiBadRequestError(
                `dataPolicy: "${String(host)}" is not a host name (letters, digits, ".", "_" or "-").`,
            );
    return hosts;
}

/**
 * Data rules need a gateway that routes between hosting companies: every
 * model and judge must run through Vercel AI Gateway or OpenRouter. A direct
 * Anthropic or Google call is served by the maker itself, so it may run when
 * the only rule is an allowed-host list that names the maker.
 */
export function validateRunDataPolicy(
    input: Pick<
        ICreateRunRequest,
        "dataPolicy" | "models" | "runJudge" | "benchmark"
    > &
        Partial<
            Pick<
                ICreateRunRequest,
                "sttConfig" | "sttVariants" | "sttEvaluation"
            >
        >,
    config?: Pick<IApiConfig, "flashEvalsLlmProvider">,
): void {
    const policy = input.dataPolicy;
    if (!policy) return;
    const hosts = validateDataPolicyHosts(policy);
    const routes = (transport: string | undefined) =>
        transport === "gateway" ||
        transport === "openrouter" ||
        (transport === undefined &&
            (config?.flashEvalsLlmProvider === "gateway" ||
                config?.flashEvalsLlmProvider === "vercel-ai" ||
                config?.flashEvalsLlmProvider === "openrouter"));
    const calls = [
        ...input.models.map((model) => ({
            name: model.modelId,
            transport: model.transport,
            transportModelId: model.transportModelId,
        })),
        ...(input.runJudge
            ? [
                  {
                      name: input.runJudge.modelId,
                      transport: input.runJudge.transport,
                  },
              ]
            : []),
        ...(input.benchmark?.judge
            ? [
                  {
                      name: input.benchmark.judge.modelId,
                      transport: input.benchmark.judge.transport,
                  },
              ]
            : []),
        ...sttCallsUnderDataPolicy(input, config),
    ];
    for (const call of calls) {
        if (routes(call.transport)) continue;
        if (onBifrost(call.transport, config)) {
            assertBifrostCanFollowRules(call);
            continue;
        }
        if (isDirectMakerTransport(call.transport)) {
            const makerHosts = DIRECT_MAKER_HOSTS[call.transport];
            if (
                !policy.zeroDataRetention &&
                !policy.disallowPromptTraining &&
                hosts.some((host) => makerHosts.includes(host))
            )
                continue;
            throw new ApiBadRequestError(
                `dataPolicy: ${call.name} runs on ${TRANSPORT_LABELS_FOR_MESSAGES[call.transport]} directly, which can only follow an allowed-host list that includes "${makerHosts[0]}". Run it through Vercel AI Gateway or OpenRouter to use the other rules.`,
            );
        }
        throw new ApiBadRequestError(
            `dataPolicy: ${call.name} must run through Vercel AI Gateway, OpenRouter, or Bifrost with an openrouter/ model ID to follow the data rules.`,
        );
    }
}

/**
 * Transliteration and the custom transcript judge call a model too, so they
 * follow the run's data rules. The judge uses the .env default provider.
 * Transliteration is checked on the provider the run records (an unset one
 * becomes the .env default, else "auto"); "auto" picks its provider by key
 * at run time, so it can't promise to follow the rules.
 */
function sttCallsUnderDataPolicy(
    input: Partial<
        Pick<ICreateRunRequest, "sttConfig" | "sttVariants" | "sttEvaluation">
    >,
    config: Pick<IApiConfig, "flashEvalsLlmProvider"> | undefined,
): Array<{
    name: string;
    transport?: ProviderTransport;
    transportModelId: string;
}> {
    const configs = [
        input.sttConfig,
        ...(input.sttVariants ?? []).map((variant) => variant?.config),
        input.sttEvaluation,
    ];
    const calls: ReturnType<typeof sttCallsUnderDataPolicy> = [];
    for (const sttConfig of configs) {
        const transliteration = sttConfig?.transliteration;
        if (transliteration?.enabled) {
            // The provider the snapshot records and the worker then uses.
            const mode = snapshotTransliterationProviderMode(
                transliteration,
                config,
            );
            const transport = TRANSLITERATION_MODE_TRANSPORTS[mode];
            if (!transport)
                throw new ApiBadRequestError(
                    `dataPolicy: transliteration with ${transliteration.modelId} picks its provider automatically, so it can't follow the data rules. Choose Vercel AI Gateway or OpenRouter for transliteration.`,
                );
            calls.push({
                name: `transliteration model ${transliteration.modelId}`,
                transportModelId: bifrostModelIdFor(transliteration.modelId),
                transport,
            });
        }
        if (sttConfig?.evaluator?.enabled)
            calls.push({
                name: `transcript judge ${sttConfig.evaluator.modelId}`,
                transportModelId: bifrostModelIdFor(
                    sttConfig.evaluator.modelId,
                ),
            });
    }
    return calls;
}

function validateUniqueModelIds(modelIds: string[]): void {
    const seen = new Set<string>();
    for (const modelId of modelIds) {
        if (seen.has(modelId)) {
            throw new ApiBadRequestError(
                `models: Duplicate model "${modelId}" is not allowed.`,
            );
        }
        seen.add(modelId);
    }
}

function validateRunModelTransports(
    input: Pick<ICreateRunRequest, "models" | "runJudge">,
): void {
    for (const model of input.models) {
        if (model.transport)
            assertModelMapsToTransport(model.modelId, model.transport, {
                allowUnlistedGateway: true,
                ...(model.transportModelId
                    ? { transportModelId: model.transportModelId }
                    : {}),
            });
        if (model.transportModelId !== undefined) assertBifrostIdIsModel(model);
    }
    if (input.runJudge?.transport)
        assertModelMapsToTransport(
            input.runJudge.modelId,
            input.runJudge.transport,
            { prefix: "runJudge: " },
        );
}

/**
 * A Bifrost id picked from Bifrost's list must be the run model's: the
 * registry model behind it is that model.
 */
export function assertBifrostIdIsModel(
    model: Pick<
        ICreateRunRequest["models"][number],
        "modelId" | "transport" | "transportModelId"
    >,
    prefix = "models: ",
): void {
    const id = model.transportModelId;
    if (model.transport !== "bifrost" || typeof id !== "string" || !id)
        throw new ApiBadRequestError(
            `${prefix}${model.modelId} can only name its own provider id on Bifrost.`,
        );
    const behind = registryEntryForBifrostModel(id)?.id;
    const own = registryModelFor(model.modelId)?.id ?? model.modelId;
    if (behind !== own)
        throw new ApiBadRequestError(
            `${prefix}Bifrost id "${id}" is not ${model.modelId}. Choose the model again from Bifrost's list.`,
        );
}

export async function createRunFromSelectionPayload(
    db: IDb,
    input: ICreateRunFromSelectionRequest,
    config?: IApiConfig,
): Promise<ICreateRunResponse> {
    return createRunWithIdempotency(db, input, "selection", (tx) =>
        createRunFromSelectionInTransaction(tx, input, config),
    );
}

/**
 * Creates an eval run from a selection inside the caller's transaction; a
 * setup comparison creates its eval run this way.
 */
export async function createRunFromSelectionInTransaction(
    db: IDb,
    input: ICreateRunFromSelectionRequest,
    config?: IApiConfig,
    options: IRunCreateOptions = {},
): Promise<ICreateRunResponse> {
    validateRunMaxCost(input);
    const dataset = await getSelectionDataset(
        db,
        input.teamId,
        input.projectId,
        input.datasetId,
    );
    const datasetModality = dataset.modality ?? "text";
    const audioRunMode =
        datasetModality === "audio"
            ? (input.audioRunMode ?? "prompt_eval")
            : undefined;
    const rawVariants = normalizeSttVariants(
        input.sttVariants,
        input.sttConfig,
    );

    if (audioRunMode === "stt_metrics") {
        const selectionConfig = await configForSttVariantsValidation(
            db,
            input.teamId,
            datasetModality,
            rawVariants,
            config,
        );
        await validateSelectionSourceRun(db, input);
        return createSttMetricsRunFromSelection(
            db,
            input,
            rawVariants,
            selectionConfig,
        );
    }

    const sttConfig = sttConfigForSnapshot(input.sttConfig, config);

    const selectionConfig = await configForSttValidation(
        db,
        input.teamId,
        datasetModality,
        sttConfig,
        config,
    );
    validateSttConfigForRun({
        datasetModality,
        sttConfig,
        config: selectionConfig,
    });
    await validateSelectionSourceRun(db, input);

    const providerMode = config?.flashEvalsLlmProvider ?? "openai";
    validateTransportAssignments(input);
    validateUniqueModelIds(input.modelIds);
    validateCandidateModels(
        input.modelIds,
        datasetModality,
        providerMode,
        new Set(input.transportAssignments?.map(({ modelId }) => modelId)),
    );
    validateTemperatureAssignments(input);
    const pipeline = input.pipelineId
        ? await getCreateRunPipeline(
              db,
              input.teamId,
              input.projectId,
              input.pipelineId,
          )
        : undefined;
    const promptRows = await resolvePromptRows(db, input);
    validateRequestedThinking(input, {
        bifrostModelList: await bifrostModelListForThinking(db, input, config),
    });
    const fieldConfigs = resolveAndValidateFieldConfigs(
        {
            input,
            dataset,
            pipeline,
            promptRows,
            providerMode,
        },
        options,
    );

    const request = buildCreateRunRequest(
        input,
        promptRows,
        fieldConfigs,
        sttConfig,
        audioRunMode,
    );
    // Checked after the thinking level is settled: a Claude model's default
    // level turns thinking on.
    validateRunTemperatures(request.models, "temperatureAssignments");
    return createRunPayload(db, request, selectionConfig, options);
}

async function getSelectionDataset(
    db: IDb,
    teamId: string,
    projectId: string,
    datasetId: string,
): Promise<ISelectionDatasetRow> {
    const result = await db.query<ISelectionDatasetRow>(
        `select id, team_id, archived_at, purpose, modality
        from datasets
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [datasetId, teamId, projectId],
    );
    const dataset = result.rows[0];
    if (!dataset) throw new ApiNotFoundError("Dataset not found");
    if (dataset.archived_at != null) {
        throw new ApiConflictError(
            "This dataset is archived. Restore it before running.",
        );
    }
    return dataset;
}

async function validateSelectionSourceRun(
    db: IDb,
    input: ICreateRunFromSelectionRequest,
): Promise<void> {
    if (!input.sourceRunId) return;
    const result = await db.query<IRunCreateSourceRunRow>(
        `select id, dataset_id
        from runs
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.sourceRunId, input.teamId, input.projectId],
    );
    if (result.rows[0]?.dataset_id !== input.datasetId) {
        throw new ApiNotFoundError("Source run not found.");
    }
}

function validateCandidateModels(
    modelIds: string[],
    datasetModality: "audio" | "image" | "text",
    providerMode: IApiConfig["flashEvalsLlmProvider"],
    explicitlyRoutedModelIds: ReadonlySet<string>,
): void {
    validateModelIdsForProvider(
        modelIds,
        providerMode,
        explicitlyRoutedModelIds,
    );
    validateKnownModelCapabilities({ modelIds, datasetModality });
    validateStructuredOutputModels(modelIds);
}

async function resolvePromptRows(
    db: IDb,
    input: ICreateRunFromSelectionRequest,
): Promise<IResolvedPromptRow[]> {
    if (!input.promptVersionId) {
        throw new ApiBadRequestError("Choose a runnable prompt version.");
    }
    const promptByModel = new Map(
        input.promptAssignments.map((assignment) => [
            assignment.modelId,
            assignment.promptVersionId,
        ]),
    );
    const reasoningByModel = new Map(
        input.reasoningConfigs.map((assignment) => [
            assignment.modelId,
            assignment.reasoningConfig,
        ]),
    );
    return Promise.all(
        input.modelIds.map((modelId) =>
            resolvePromptRow(
                db,
                input.teamId,
                input.projectId,
                modelId,
                promptByModel.get(modelId) ?? input.promptVersionId!,
                reasoningByModel.get(modelId),
            ),
        ),
    );
}

async function resolvePromptRow(
    db: IDb,
    teamId: string,
    projectId: string,
    modelId: string,
    promptVersionId: string,
    requestedReasoning: IReasoningConfig | undefined,
): Promise<IResolvedPromptRow> {
    const version = await getCreateRunPromptVersion(
        db,
        promptVersionId,
        modelId,
    );
    const [prompt, schemaVersion, fitTags] = await Promise.all([
        getCreateRunPrompt(db, teamId, projectId, version.prompt_id),
        getCreateRunSchemaVersion(db, version.schema_version_id),
        listPromptVersionFitTags(db, version.id),
    ]);
    const effort = resolveReasoningEffort(
        modelId,
        (requestedReasoning ?? version.reasoning_config ?? undefined)?.effort,
    );
    return {
        modelId,
        version,
        prompt,
        schemaVersion,
        fitTags,
        ...(effort ? { reasoningConfig: { effort } } : {}),
    };
}

function resolveAndValidateFieldConfigs(
    input: {
        input: ICreateRunFromSelectionRequest;
        dataset: ISelectionDatasetRow;
        pipeline?: ICreateRunPipelineRow;
        promptRows: IResolvedPromptRow[];
        providerMode: IApiConfig["flashEvalsLlmProvider"];
    },
    options: IRunCreateOptions = {},
): IPipelineFieldConfig[] {
    const canonicalConfigs =
        input.pipeline?.field_configs ??
        input.promptRows[0]?.schemaVersion.field_configs ??
        [];
    const merged = input.pipeline
        ? mergeRunFieldConfigs(
              input.pipeline.field_configs,
              input.input.fieldConfigs,
          )
        : {
              ok: true as const,
              fieldConfigs:
                  input.input.fieldConfigs.length > 0
                      ? input.input.fieldConfigs
                      : canonicalConfigs,
          };
    if (!merged.ok) throw new ApiBadRequestError(merged.error);

    validateScoringConfiguration(input, merged.fieldConfigs, options);
    return input.pipeline?.field_configs ?? merged.fieldConfigs;
}

function validateScoringConfiguration(
    input: {
        input: ICreateRunFromSelectionRequest;
        dataset: ISelectionDatasetRow;
        pipeline?: ICreateRunPipelineRow;
        promptRows: IResolvedPromptRow[];
        providerMode: IApiConfig["flashEvalsLlmProvider"];
    },
    fieldConfigs: IPipelineFieldConfig[],
    options: IRunCreateOptions = {},
): void {
    const outputSchema =
        input.pipeline?.output_schema ??
        input.promptRows[0]?.schemaVersion.json_schema;
    if (!outputSchema)
        throw new ApiBadRequestError("Choose a runnable prompt version.");
    if (
        input.input.benchmark &&
        input.input.benchmark.source !== "labels" &&
        !input.input.referenceModel
    )
        throw new ApiBadRequestError(
            "benchmark: Choose a reference model to act as the benchmark.",
        );
    if (
        input.input.benchmark?.source === "labels" &&
        input.dataset.purpose !== "golden"
    )
        throw new ApiBadRequestError(
            "benchmark: Using stored answers as the benchmark needs a dataset with answers.",
        );
    if (input.input.benchmark)
        validateRunBenchmark(
            {
                models: input.input.modelIds.map((modelId) => ({
                    modelId,
                    promptVersionId: null,
                    isReference: modelId === input.input.referenceModel,
                })),
                benchmark: input.input.benchmark,
            },
            outputSchema as IJsonSchemaObject,
            options,
        );
    const validation = validatePipelineFields(outputSchema, fieldConfigs);
    if (!validation.ok) throw new ApiBadRequestError(validation.error);

    const hasRunJudge =
        Boolean(input.input.judgePromptVersionId) ||
        Boolean(input.input.judgeRubric?.trim());
    if (
        hasRunJudge &&
        fieldConfigs.some((config) => config.kind === "generative")
    ) {
        throw new ApiBadRequestError(
            "A judge cannot be combined with generative-field scoring; remove one.",
        );
    }
    validateJudgeModels({
        judgeModelId: hasRunJudge ? input.input.judgeModelId : undefined,
        judgeTransport: hasRunJudge ? input.input.judgeTransport : undefined,
        fieldConfigs,
        providerMode: input.providerMode,
    });
    validatePromptCompatibility(
        input.promptRows,
        fieldConfigsRequiringPromptFields(
            fieldConfigs,
            input.dataset.purpose === "golden",
        ),
    );
}

function validatePromptCompatibility(
    promptRows: IResolvedPromptRow[],
    fieldConfigs: IPipelineFieldConfig[],
): void {
    for (const row of promptRows) {
        const compatibility = validatePromptDatasetCompatibility({
            promptSchema: row.schemaVersion.json_schema,
            fieldConfigs,
        });
        if (!compatibility.ok) {
            throw new ApiBadRequestError(
                compatibility.issues[0]?.message ??
                    "Prompt schema does not match the selected scoring fields.",
            );
        }
    }
}

function buildCreateRunRequest(
    input: ICreateRunFromSelectionRequest,
    promptRows: IResolvedPromptRow[],
    fieldConfigs: IPipelineFieldConfig[],
    sttConfig: ISttRunConfig | undefined,
    audioRunMode: "prompt_eval" | undefined,
): ICreateRunRequest {
    const judgeRubric = input.judgeRubric?.trim() ?? "";
    const judgeEffort = resolveReasoningEffort(
        input.judgeModelId,
        input.judgeReasoningEffort,
    );
    return {
        teamId: input.teamId,
        projectId: input.projectId,
        datasetId: input.datasetId,
        models: buildRunModels(
            promptRows,
            input.referenceModel,
            input.transportAssignments ?? [],
            input.temperatureAssignments ?? [],
        ),
        maxTokens: input.maxTokens,
        fieldConfigs,
        createdBy: input.createdBy,
        ...(input.maxCostUsd !== undefined
            ? { maxCostUsd: input.maxCostUsd }
            : {}),
        ...(input.pipelineId ? { pipelineId: input.pipelineId } : {}),
        ...(input.judgeConfigId ? { judgeConfigId: input.judgeConfigId } : {}),
        ...(judgeRubric
            ? {
                  runJudge: {
                      modelId: input.judgeModelId,
                      ...(input.judgeTransport
                          ? { transport: input.judgeTransport }
                          : {}),
                      rubricPrompt: judgeRubric,
                      ...(judgeEffort
                          ? { reasoningConfig: { effort: judgeEffort } }
                          : {}),
                  },
              }
            : {}),
        ...(input.judgePromptVersionId
            ? { judgePromptVersionId: input.judgePromptVersionId }
            : {}),
        ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
        ...(sttConfig ? { sttConfig } : {}),
        ...(audioRunMode ? { audioRunMode } : {}),
        ...(input.benchmark ? { benchmark: input.benchmark } : {}),
        ...(input.dataPolicy ? { dataPolicy: input.dataPolicy } : {}),
        ...itemSelection(input),
    };
}

/** The pilot size and label filter a run request carries, when set. */
function itemSelection(
    input: Pick<ICreateRunFromSelectionRequest, "itemLimit" | "itemFilter">,
): Pick<ICreateRunRequest, "itemLimit" | "itemFilter"> {
    return {
        ...(input.itemLimit !== undefined
            ? { itemLimit: input.itemLimit }
            : {}),
        ...(input.itemFilter ? { itemFilter: input.itemFilter } : {}),
    };
}

function buildRunModels(
    promptRows: IResolvedPromptRow[],
    referenceModel: string | undefined,
    transportAssignments: NonNullable<
        ICreateRunFromSelectionRequest["transportAssignments"]
    >,
    temperatureAssignments: NonNullable<
        ICreateRunFromSelectionRequest["temperatureAssignments"]
    >,
): ICreateRunRequest["models"] {
    const assignmentByModel = new Map(
        transportAssignments.map((assignment) => [
            assignment.modelId,
            assignment,
        ]),
    );
    const temperatureByModel = new Map(
        temperatureAssignments.map(({ modelId, temperature }) => [
            modelId,
            temperature,
        ]),
    );
    return promptRows.map((row) => ({
        modelId: row.modelId,
        ...(assignmentByModel.has(row.modelId)
            ? { transport: assignmentByModel.get(row.modelId)!.transport }
            : {}),
        ...(assignmentByModel.get(row.modelId)?.transportModelId
            ? {
                  transportModelId: assignmentByModel.get(row.modelId)!
                      .transportModelId,
              }
            : {}),
        promptVersionId: row.version.id,
        schemaVersionId: row.schemaVersion.id,
        promptSnapshot: {
            promptId: row.prompt.id,
            promptName: row.prompt.name,
            promptVersionId: row.version.id,
            promptVersion: Number(row.version.version),
            schemaVersionId: row.schemaVersion.id,
            schemaVersion: Number(row.schemaVersion.version),
            schemaHash: row.schemaVersion.schema_hash,
            fitTags: row.fitTags,
        },
        ...(row.reasoningConfig
            ? { reasoningConfig: row.reasoningConfig }
            : {}),
        ...(temperatureByModel.has(row.modelId)
            ? { temperature: temperatureByModel.get(row.modelId)! }
            : {}),
        isReference: row.modelId === referenceModel,
    }));
}

function createSttMetricsRunFromSelection(
    db: IDb,
    input: ICreateRunFromSelectionRequest,
    variants: ISttRunVariant[],
    config: IApiConfig | undefined,
): Promise<ICreateRunResponse> {
    const explicitVariants = input.sttVariants !== undefined;
    const legacyConfig = explicitVariants ? undefined : variants[0]?.config;
    return createRunPayload(
        db,
        {
            teamId: input.teamId,
            projectId: input.projectId,
            datasetId: input.datasetId,
            models: variants.map((variant, index) => ({
                modelId: sttMetricsModelId(
                    variant.config.modelId,
                    explicitVariants ? variant.variantKey : undefined,
                ),
                promptVersionId: null,
                isReference: index === 0,
            })),
            maxTokens: input.maxTokens,
            fieldConfigs: [],
            createdBy: input.createdBy,
            ...(input.maxCostUsd !== undefined
                ? { maxCostUsd: input.maxCostUsd }
                : {}),
            ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
            ...(legacyConfig ? { sttConfig: legacyConfig } : {}),
            ...(explicitVariants ? { sttVariants: variants } : {}),
            ...(input.sttEvaluation
                ? { sttEvaluation: input.sttEvaluation }
                : {}),
            ...itemSelection(input),
            audioRunMode: "stt_metrics",
        },
        config,
    );
}

async function getCreateRunPipeline(
    db: IDb,
    teamId: string,
    projectId: string,
    pipelineId: string,
): Promise<ICreateRunPipelineRow> {
    const result = await db.query<ICreateRunPipelineRow>(
        `select id, team_id, output_schema, field_configs
        from pipelines
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [pipelineId, teamId, projectId],
    );
    const pipeline = result.rows[0];
    if (!pipeline) throw new ApiNotFoundError("Prompt bundle not found.");
    return pipeline;
}

async function getCreateRunPromptVersion(
    db: IDb,
    promptVersionId: string,
    modelId: string,
): Promise<ICreateRunPromptVersionRow & { schema_version_id: string }> {
    const result = await db.query<ICreateRunPromptVersionRow>(
        `select id, prompt_id, version, schema_version_id, status, reasoning_config
        from prompt_versions
        where id = $1
        limit 1`,
        [promptVersionId],
    );
    const version = result.rows[0];
    if (!version || version.status !== "runnable") {
        throw new ApiBadRequestError(
            `Choose a runnable prompt version for ${modelId}.`,
        );
    }
    if (!version.schema_version_id) {
        throw new ApiBadRequestError(
            `Prompt version for ${modelId} is missing a schema version.`,
        );
    }
    return version as ICreateRunPromptVersionRow & {
        schema_version_id: string;
    };
}

async function getCreateRunPrompt(
    db: IDb,
    teamId: string,
    projectId: string,
    promptId: string,
): Promise<ICreateRunPromptRow> {
    const result = await db.query<ICreateRunPromptRow>(
        `select id, team_id, name, kind
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [promptId, teamId, projectId],
    );
    const prompt = result.rows[0];
    if (!prompt) throw new ApiNotFoundError("Prompt not found.");
    return prompt;
}

async function getCreateRunSchemaVersion(
    db: IDb,
    schemaVersionId: string,
): Promise<ICreateRunSchemaVersionRow> {
    const result = await db.query<ICreateRunSchemaVersionRow>(
        `select id, version, json_schema, field_configs, schema_hash
        from prompt_schema_versions
        where id = $1
        limit 1`,
        [schemaVersionId],
    );
    const schemaVersion = result.rows[0];
    if (!schemaVersion)
        throw new ApiNotFoundError("Prompt schema version not found.");
    return schemaVersion;
}

async function listPromptVersionFitTags(
    db: IDb,
    promptVersionId: string,
): Promise<string[]> {
    const result = await db.query<ICreateRunFitTagRow>(
        `select tag
        from prompt_version_fit_tags
        where prompt_version_id = $1
        order by tag`,
        [promptVersionId],
    );
    return result.rows.map((row) => row.tag);
}

function mergeRunFieldConfigs(
    pipelineConfigs: IPipelineFieldConfig[],
    submittedConfigs: IPipelineFieldConfig[],
):
    | { ok: true; fieldConfigs: IPipelineFieldConfig[] }
    | { ok: false; error: string } {
    if (submittedConfigs.length !== pipelineConfigs.length) {
        return {
            ok: false,
            error: "Field configs must match the prompt bundle.",
        };
    }
    const submittedByField = new Map(
        submittedConfigs.map((config) => [config.field, config]),
    );
    const fieldConfigs: IPipelineFieldConfig[] = [];
    for (const base of pipelineConfigs) {
        const merged = mergeRunFieldConfig(
            base,
            submittedByField.get(base.field),
        );
        if (!merged.ok) return merged;
        fieldConfigs.push(merged.fieldConfig);
    }
    return { ok: true, fieldConfigs };
}

function mergeRunFieldConfig(
    base: IPipelineFieldConfig,
    submitted: IPipelineFieldConfig | undefined,
):
    | { ok: true; fieldConfig: IPipelineFieldConfig }
    | { ok: false; error: string } {
    if (!submitted) {
        return { ok: false, error: `Unknown field config "${base.field}".` };
    }
    if (submitted.kind !== base.kind) {
        return {
            ok: false,
            error: `Field "${base.field}" kind cannot be changed at run time.`,
        };
    }
    if (base.kind === "factual") {
        if (
            submitted.kind !== "factual" ||
            !isValidMatcherSpec(submitted.spec)
        ) {
            return {
                ok: false,
                error: `Field "${base.field}" has an invalid matcher.`,
            };
        }
        return {
            ok: true,
            fieldConfig: {
                field: base.field,
                kind: "factual",
                ...(submitted.spec ? { spec: submitted.spec } : {}),
            },
        };
    }
    if (!isValidGenerativeFieldConfig(submitted)) {
        return {
            ok: false,
            error: `Field "${base.field}" has an invalid judge rubric or model.`,
        };
    }
    return {
        ok: true,
        fieldConfig: {
            field: base.field,
            kind: "generative",
            rubric: submitted.rubric,
            modelId: submitted.modelId,
        },
    };
}

function isValidGenerativeFieldConfig(
    config: IPipelineFieldConfig,
): config is Extract<IPipelineFieldConfig, { kind: "generative" }> {
    return (
        config.kind === "generative" &&
        typeof config.rubric === "string" &&
        config.rubric.length <= 4000 &&
        typeof config.modelId === "string" &&
        config.modelId.trim().length > 0 &&
        config.modelId.length <= 100
    );
}

function isValidMatcherSpec(spec: unknown): boolean {
    if (spec === undefined) return true;
    if (!isRecord(spec)) return false;
    if (spec.matcher === "exact" || spec.matcher === "set_overlap") return true;
    return (
        spec.matcher === "numeric_tolerance" &&
        typeof spec.tolerance === "number" &&
        Number.isFinite(spec.tolerance) &&
        (spec.relative === undefined || typeof spec.relative === "boolean")
    );
}

function validatePipelineFields(
    jsonSchema: Record<string, unknown>,
    fieldConfigs: IPipelineFieldConfig[],
): { ok: true } | { ok: false; error: string } {
    const paths = new Set<string>();
    for (const descriptor of extractSchemaPaths(jsonSchema)) {
        paths.add(descriptor.path);
        paths.add(descriptor.path.replace(/^\$\./, ""));
    }
    for (const config of fieldConfigs) {
        if (!config.field) {
            return { ok: false, error: "Each field config must name a field." };
        }
        if (!paths.has(config.field)) {
            return {
                ok: false,
                error: `Field config "${config.field}" is not defined in the output structure.`,
            };
        }
    }
    return { ok: true };
}

function fieldConfigsRequiringPromptFields(
    fieldConfigs: IPipelineFieldConfig[],
    hasGoldenLabels: boolean,
): IPipelineFieldConfig[] {
    return fieldConfigs.filter(
        (config) =>
            config.kind === "generative" ||
            (hasGoldenLabels &&
                config.kind === "factual" &&
                Boolean(config.spec)),
    );
}

function validatePromptDatasetCompatibility(input: {
    promptSchema: Record<string, unknown>;
    fieldConfigs: IPipelineFieldConfig[];
}): { ok: boolean; issues: Array<{ path: string; message: string }> } {
    const promptPaths = new Map(
        extractSchemaPaths(input.promptSchema).map((path) => [path.path, path]),
    );
    const issues = input.fieldConfigs.flatMap((fieldConfig) => {
        const path = normalizeFieldPath(fieldConfig.field);
        const descriptor = promptPaths.get(path);
        if (!descriptor) {
            return [
                {
                    path,
                    message: `Prompt schema does not define the scorable field "${fieldConfig.field}".`,
                },
            ];
        }
        return isScorableSchemaType(descriptor.type)
            ? []
            : [
                  {
                      path,
                      message: `Scorable field "${fieldConfig.field}" has unsupported schema type "${descriptor.type}".`,
                  },
              ];
    });
    return { ok: issues.length === 0, issues };
}

function normalizeFieldPath(field: string): string {
    const trimmed = field.trim();
    if (!trimmed) return "$";
    return trimmed.startsWith("$.") ? trimmed : `$.${trimmed}`;
}

function isScorableSchemaType(type: string): boolean {
    return new Set([
        "string",
        "number",
        "integer",
        "boolean",
        "array",
        "object",
        "string|null",
        "number|null",
        "integer|null",
        "boolean|null",
    ]).has(type);
}

/**
 * A thinking level chosen for this run must reach the model. A level the
 * model doesn't take, or a non-default level its chosen provider has no way
 * to send, refuses the run in plain words instead of being dropped. Other
 * calls (the model's default level, or a provider picked automatically) are
 * checked per call: a level that can't be sent is recorded with the answer
 * and shown on the run page.
 */
export function validateRequestedThinking(
    input: Pick<
        ICreateRunFromSelectionRequest,
        "reasoningConfigs" | "transportAssignments"
    >,
    options: {
        /** The team's Bifrost list (`bifrostModelListKeyFor`), if any. */
        bifrostModelList?: string;
    } = {},
): void {
    const assignments = new Map(
        (input.transportAssignments ?? []).map((assignment) => [
            assignment.modelId,
            assignment,
        ]),
    );
    for (const { modelId, reasoningConfig } of input.reasoningConfigs) {
        const effort = reasoningConfig?.effort;
        if (!effort) continue;
        const capability = registryModelFor(modelId)?.reasoningEffort;
        const levels = capability?.supportedLevels;
        if (levels && !levels.includes(effort))
            throw new ApiBadRequestError(
                `reasoningConfigs: ${modelId} takes thinking levels ${levels.join(", ")}, not "${effort}".`,
            );
        const transport = assignments.get(modelId)?.transport;
        // The form fills in each model's default level; a default the route
        // can't send is recorded per call and shown on the run page instead.
        if (!transport || !levels || effort === capability.defaultLevel)
            continue;
        const plan = thinkingPlanFor(
            providerModelId(
                modelId,
                transport,
                assignments.get(modelId)?.transportModelId,
            ),
            transport,
            effort,
            transport === "bifrost" && options.bifrostModelList
                ? { bifrostModelList: options.bifrostModelList }
                : {},
        );
        if (plan && !plan.outcome.sent)
            throw new ApiBadRequestError(
                `reasoningConfigs: "${effort}" thinking for ${modelId} can't be sent through ${TRANSPORT_LABELS_FOR_MESSAGES[transport]}. ${plan.outcome.reason ?? ""} Choose another provider, or leave thinking at the model's default.`.trim(),
            );
    }
}

/**
 * The team's Bifrost list key, so a chosen Bifrost thinking level is checked
 * against what that Bifrost's model list says. Keys are resolved only when a
 * model runs on Bifrost.
 */
async function bifrostModelListForThinking(
    db: IDb,
    input: Pick<
        ICreateRunFromSelectionRequest,
        "teamId" | "transportAssignments"
    >,
    config: IApiConfig | undefined,
): Promise<string | undefined> {
    if (
        !config ||
        !input.transportAssignments?.some(
            (assignment) => assignment.transport === "bifrost",
        )
    )
        return undefined;
    const { apiKeys } = await resolveApiKeys(db, config, input.teamId);
    return bifrostModelListKeyFor(apiKeys);
}

/**
 * Each temperature names a selected model once, as a number from 0 to 2.
 * Whether the model can take it is checked once its thinking is settled.
 */
function validateTemperatureAssignments(
    input: Pick<
        ICreateRunFromSelectionRequest,
        "modelIds" | "temperatureAssignments"
    >,
): void {
    const selected = new Set(input.modelIds);
    const seen = new Set<string>();
    for (const { modelId, temperature } of input.temperatureAssignments ?? []) {
        if (!selected.has(modelId))
            throw new ApiBadRequestError(
                `temperatureAssignments: ${modelId} is not one of the run's models.`,
            );
        if (seen.has(modelId))
            throw new ApiBadRequestError(
                `temperatureAssignments: ${modelId} is listed twice.`,
            );
        seen.add(modelId);
        if (!isRunTemperature(temperature))
            throw new ApiBadRequestError(
                `temperatureAssignments: the temperature for ${modelId} must be a number from 0 to 2.`,
            );
    }
}

/**
 * A temperature chosen for a model must reach it. Providers send no
 * temperature to a model that refuses one, so a run that asks for one there
 * is refused in plain words, naming the model and why, instead of running
 * at a temperature it didn't get.
 */
export function validateRunTemperatures(
    models: ReadonlyArray<
        Pick<
            ICreateRunRequest["models"][number],
            | "modelId"
            | "transport"
            | "transportModelId"
            | "reasoningConfig"
            | "temperature"
        >
    >,
    field = "models",
): void {
    for (const model of models) {
        if (model.temperature === undefined) continue;
        if (!isRunTemperature(model.temperature))
            throw new ApiBadRequestError(
                `${field}: the temperature for ${model.modelId} must be a number from 0 to 2.`,
            );
        const refusal = temperatureRefusal(model);
        if (refusal) throw new ApiBadRequestError(`${field}: ${refusal}`);
    }
}

/** Why `model` can't take its temperature, in plain words; undefined when it can. */
export function temperatureRefusal(
    model: Pick<
        ICreateRunRequest["models"][number],
        | "modelId"
        | "transport"
        | "transportModelId"
        | "reasoningConfig"
        | "temperature"
    >,
): string | undefined {
    const { modelId, temperature } = model;
    if (temperature === undefined) return undefined;
    const sentAs = model.transport
        ? providerModelId(modelId, model.transport, model.transportModelId)
        : modelId;
    if (rejectsSamplingSettings(modelId) || rejectsSamplingSettings(sentAs))
        return isClaudeModel(modelId)
            ? `${modelId} takes no temperature (Claude 5 models and Opus 4.7 and later refuse it). Remove the temperature for ${modelId}.`
            : `${modelId} is an OpenAI reasoning model, which takes no temperature. Remove the temperature for ${modelId}.`;
    const effort = model.reasoningConfig?.effort;
    if (
        isClaudeModel(modelId) &&
        effort !== undefined &&
        effort !== "none" &&
        temperature !== 1
    )
        return `${modelId} runs with thinking on ("${effort}"), and Claude takes only temperature 1 while thinking. Remove the temperature for ${modelId}, set it to 1, or turn thinking off.`;
    return undefined;
}

function isClaudeModel(modelId: string): boolean {
    const entry = registryModelFor(modelId);
    if (entry) return entry.provider === "anthropic";
    return (
        makerOfModel(modelId) === "anthropic" ||
        /(^|\/)anthropic\//.test(modelId)
    );
}

/** The id `transport` is sent for `modelId`. */
function providerModelId(
    modelId: string,
    transport: ProviderTransport,
    transportModelId: string | undefined,
): string {
    if (transport === "bifrost")
        return transportModelId ?? bifrostModelIdFor(modelId);
    return transportModelIdFor(modelId, transport) ?? modelId;
}

export function resolveReasoningEffort(
    modelId: string,
    requested?: IReasoningConfig["effort"],
): IReasoningConfig["effort"] | undefined {
    const capability = registryModelFor(modelId)?.reasoningEffort;
    if (!capability) return undefined;
    if (requested && capability.supportedLevels.includes(requested))
        return requested;
    return capability.defaultLevel;
}

function validateModelIdsForProvider(
    modelIds: string[],
    providerMode: IApiConfig["flashEvalsLlmProvider"],
    explicitlyRoutedModelIds: ReadonlySet<string>,
): void {
    for (const modelId of modelIds) {
        if (explicitlyRoutedModelIds.has(modelId)) continue;
        const entry = registryEntryFor(modelId);
        if (entry && !modelAllowedForProvider(entry, providerMode)) {
            throw new ApiBadRequestError(
                `${entry.label} is not available for the configured provider mode.`,
            );
        }
        if (!entry && providerMode !== "gateway" && modelId.includes("/")) {
            throw new ApiBadRequestError(
                `${modelId} requires Gateway provider mode.`,
            );
        }
    }
}

function validateTransportAssignments(
    input: ICreateRunFromSelectionRequest,
): void {
    const selected = new Set(input.modelIds);
    for (const assignment of input.transportAssignments ?? []) {
        if (!selected.has(assignment.modelId)) {
            throw new ApiBadRequestError(
                `Transport selection references unselected model "${assignment.modelId}".`,
            );
        }
        assertModelMapsToTransport(assignment.modelId, assignment.transport, {
            allowUnlistedGateway: true,
            ...(assignment.transportModelId
                ? { transportModelId: assignment.transportModelId }
                : {}),
        });
        // A registry id with the Bifrost id picked from Bifrost's list: the
        // pair must name the same model, as on the /api/runs path.
        if (assignment.transportModelId !== undefined)
            assertBifrostIdIsModel(assignment, "transportAssignments: ");
    }
}

function validateKnownModelCapabilities(input: {
    modelIds: string[];
    datasetModality: "audio" | "image" | "text";
}): void {
    if (input.datasetModality !== "image") return;
    for (const modelId of input.modelIds) {
        if (!registryModelFor(modelId)?.vision) {
            throw new ApiBadRequestError(
                `${modelId} cannot run on image datasets because vision support is not available.`,
            );
        }
    }
}

function validateStructuredOutputModels(modelIds: string[]): void {
    for (const modelId of modelIds) {
        const entry = registryModelFor(modelId);
        if (entry && !entry.structuredOutput) {
            throw new ApiBadRequestError(
                `${entry.label} does not support structured-output evals.`,
            );
        }
    }
}

function validateJudgeModels(input: {
    judgeModelId?: string;
    judgeTransport?: ICreateRunFromSelectionRequest["judgeTransport"];
    fieldConfigs: IPipelineFieldConfig[];
    providerMode: IApiConfig["flashEvalsLlmProvider"];
}): void {
    const modelIds = [
        ...(input.judgeModelId ? [input.judgeModelId] : []),
        ...input.fieldConfigs.flatMap((config) =>
            config.kind === "generative" ? [config.modelId] : [],
        ),
    ];
    for (const modelId of modelIds) {
        if (modelId === input.judgeModelId && input.judgeTransport) {
            assertModelMapsToTransport(modelId, input.judgeTransport);
            continue;
        }
        validateJudgeModel(modelId, input.providerMode);
    }
}

function validateJudgeModel(
    modelId: string,
    providerMode: IApiConfig["flashEvalsLlmProvider"],
): void {
    const entry = registryEntryFor(modelId);
    if (entry && !modelAllowedForProvider(entry, providerMode)) {
        throw new ApiBadRequestError(
            `${entry.label} is not available for the configured provider mode.`,
        );
    }
    const model = registryModelFor(modelId);
    if (model && (!model.judgeSuitable || !model.structuredOutput)) {
        throw new ApiBadRequestError(
            `${model.label} cannot be used as a judge model.`,
        );
    }
    if (!entry && providerMode !== "gateway" && modelId.includes("/")) {
        throw new ApiBadRequestError(
            `${modelId} requires Gateway provider mode.`,
        );
    }
}

async function createRunPayloadInTransaction(
    db: IDb,
    input: ICreateRunRequest,
    config?: IApiConfig,
): Promise<ICreateRunResponse> {
    const dataset = await getRunCreateDataset(db, input);
    const rawVariants = normalizeSttVariants(
        input.sttVariants,
        input.sttConfig,
    );
    const effectiveConfig = await configForSttVariantsValidation(
        db,
        input.teamId,
        dataset.modality ?? "text",
        rawVariants,
        config,
    );
    if (input.models.length === 0) {
        throw new ApiBadRequestError(
            "Cannot start a run with no candidate models.",
        );
    }
    const snapshotConfig = await configForTransliterationSnapshot(
        db,
        input,
        effectiveConfig,
    );
    const sttVariants = input.sttVariants
        ? normalizedSnapshotVariants(
              rawVariants,
              input.sttEvaluation,
              snapshotConfig,
          )
        : undefined;
    const sttConfig = input.sttVariants
        ? undefined
        : sttConfigForSnapshot(input.sttConfig, snapshotConfig);
    if (sttVariants) {
        for (const variant of Object.values(sttVariants)) {
            validateVariantForRun(
                variant,
                dataset.modality ?? "text",
                effectiveConfig,
            );
        }
    } else {
        validateSttConfigForRun({
            datasetModality: dataset.modality ?? "text",
            sttConfig,
            config: effectiveConfig,
        });
    }
    // The label filter applies before the pilot limit: the first N items
    // with that label.
    const itemFilter = resolveItemFilter(input);
    const items = pilotItems(
        await filterItemsByLabel(
            db,
            await listRunCreateItems(db, input.datasetId),
            itemFilter,
        ),
        input.itemLimit,
    );
    assertRunCellLimit({
        itemCount: items.length,
        perItemCount: input.models.length,
        perItemLabel: "models",
        maxRunCells: config?.maxRunCells,
    });
    await assertTeamSpendUnderCap(
        db,
        input.teamId,
        config?.teamDailySpendCapUsd,
    );
    await validateRunCreateReferences(db, input);
    const judgeConfigId = await resolveJudgeConfigId(db, input);
    const runId = await insertRun(
        db,
        itemFilter ? { ...input, itemFilter } : input,
        sttConfig,
        sttVariants,
        judgeConfigId,
    );
    const runModelIds = await insertRunModels(db, runId, input.models);
    await insertRunCells(db, runId, runModelIds, items);
    await db.query(`insert into run_enqueue_outbox (run_id) values ($1)`, [
        runId,
    ]);
    return { runId, enqueueStatus: "pending_enqueue" };
}

async function configForSttValidation(
    db: IDb,
    teamId: string,
    datasetModality: "audio" | "image" | "text",
    sttConfig: ISttRunConfig | undefined,
    config: IApiConfig | undefined,
): Promise<IApiConfig | undefined> {
    if (!config || datasetModality !== "audio") return config;
    const selectedModel = sttModelOptions(
        config,
        config.sttCapabilityProbes,
    ).find((model) => model.id === sttConfig?.modelId);
    if (selectedModel?.availabilityStatus !== "missing_key") return config;
    return configWithResolvedKeys(
        config,
        await resolveApiKeys(db, config, teamId),
    );
}

/**
 * The config a run's transliteration is recorded with. An OpenRouter or
 * Bifrost transliteration records the base URL that goes with the key the
 * worker will use (a team's saved one, else .env), so a Settings key is
 * never sent to the .env address.
 */
async function configForTransliterationSnapshot(
    db: IDb,
    input: Pick<
        ICreateRunRequest,
        "teamId" | "sttConfig" | "sttVariants" | "sttEvaluation"
    >,
    config: IApiConfig | undefined,
): Promise<IApiConfig | undefined> {
    if (!config) return config;
    const usesBaseUrl = [
        input.sttConfig,
        ...(input.sttVariants ?? []).map((variant) => variant?.config),
        input.sttEvaluation,
    ].some((sttConfig) => {
        const transliteration = sttConfig?.transliteration;
        if (!transliteration?.enabled) return false;
        const mode = snapshotTransliterationProviderMode(
            transliteration,
            config,
        );
        return mode === "openrouter" || mode === "bifrost";
    });
    if (!usesBaseUrl) return config;
    return configWithResolvedKeys(
        config,
        await resolveApiKeys(db, config, input.teamId),
    );
}

async function configForSttVariantsValidation(
    db: IDb,
    teamId: string,
    datasetModality: "audio" | "image" | "text",
    variants: ISttRunVariant[],
    config: IApiConfig | undefined,
): Promise<IApiConfig | undefined> {
    if (variants.length <= 1) {
        return configForSttValidation(
            db,
            teamId,
            datasetModality,
            variants[0]?.config,
            config,
        );
    }
    if (!config || datasetModality !== "audio") return config;
    const options = sttModelOptions(config, config.sttCapabilityProbes);
    const needsStoredKey = variants.some(
        (variant) =>
            options.find((model) => model.id === variant.config.modelId)
                ?.availabilityStatus === "missing_key",
    );
    if (!needsStoredKey) return config;
    return configWithResolvedKeys(
        config,
        await resolveApiKeys(db, config, teamId),
    );
}

async function getRunCreateDataset(
    db: IDb,
    input: ICreateRunRequest,
): Promise<IRunCreateDatasetRow> {
    const result = await db.query<IRunCreateDatasetRow>(
        `select id, team_id, archived_at, modality
        from datasets
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.datasetId, input.teamId, input.projectId],
    );
    const dataset = result.rows[0];
    if (!dataset) throw new ApiNotFoundError("Dataset not found");
    if (dataset.archived_at != null) {
        throw new ApiConflictError(
            "This dataset is archived. Restore it before running.",
        );
    }
    return dataset;
}

/**
 * A pilot runs on the dataset's first N items, in the order they were added,
 * so a later full run starts from the same items.
 */
export function pilotItems<T>(items: T[], itemLimit: number | undefined): T[] {
    if (itemLimit === undefined) return items;
    if (!Number.isInteger(itemLimit) || itemLimit < 1)
        throw new ApiBadRequestError(
            "itemLimit must be a whole number of at least 1.",
        );
    return items.slice(0, itemLimit);
}

async function listRunCreateItems(
    db: IDb,
    datasetId: string,
): Promise<IRunCreateItemRow[]> {
    const result = await db.query<IRunCreateItemRow>(
        `select id, input_text, storage_key
        from dataset_items
        where dataset_id = $1
        order by created_at, id`,
        [datasetId],
    );
    if (result.rows.length === 0) {
        throw new ApiBadRequestError(
            "Cannot start a run on a dataset with no items.",
        );
    }
    return result.rows;
}

async function validateRunCreateReferences(
    db: IDb,
    input: ICreateRunRequest,
): Promise<void> {
    await validatePipelineReference(db, input);
    await validateRunSourceReference(db, input);
    await validateJudgePromptReference(db, input);
    await validateJudgeConfigReference(db, input);
}

async function validateJudgeConfigReference(
    db: IDb,
    input: ICreateRunRequest,
): Promise<void> {
    if (!input.judgeConfigId || input.runJudge) return;
    const result = await db.query<{ id: string }>(
        `select id
        from judge_configs
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.judgeConfigId, input.teamId, input.projectId],
    );
    if (!result.rows[0]) throw new ApiNotFoundError("Judge config not found.");
}

async function validateRunSourceReference(
    db: IDb,
    input: ICreateRunRequest,
): Promise<void> {
    if (!input.sourceRunId) return;
    const result = await db.query<IRunCreateSourceRunRow>(
        `select id, dataset_id
        from runs
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.sourceRunId, input.teamId, input.projectId],
    );
    if (result.rows[0]?.dataset_id !== input.datasetId) {
        throw new ApiNotFoundError("Source run not found.");
    }
}

async function validatePipelineReference(
    db: IDb,
    input: ICreateRunRequest,
): Promise<void> {
    if (!input.pipelineId) return;
    const result = await db.query<{ id: string }>(
        `select id
        from pipelines
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.pipelineId, input.teamId, input.projectId],
    );
    if (!result.rows[0]) throw new ApiNotFoundError("Prompt bundle not found.");
}

async function validateJudgePromptReference(
    db: IDb,
    input: ICreateRunRequest,
): Promise<void> {
    if (!input.judgePromptVersionId) return;
    const result = await db.query<{
        prompt_id: string;
        judge_spec: unknown;
        kind: "eval" | "judge";
        team_id: string;
    }>(
        `select pv.prompt_id, pv.judge_spec, p.kind, p.team_id
        from prompt_versions pv
        inner join prompts p on p.id = pv.prompt_id
        where pv.id = $1 and p.team_id = $2 and p.project_id = $3
        limit 1`,
        [input.judgePromptVersionId, input.teamId, input.projectId],
    );
    const judge = result.rows[0];
    if (!judge || judge.kind !== "judge" || !judge.judge_spec) {
        throw new ApiBadRequestError("Choose a saved judge prompt.");
    }
}

async function resolveJudgeConfigId(
    db: IDb,
    input: ICreateRunRequest,
): Promise<string | undefined> {
    if (!input.runJudge) {
        if (!input.judgeConfigId) return undefined;
        const owned = await db.query<{ id: string }>(
            `select id
            from judge_configs
            where id = $1 and team_id = $2 and project_id = $3
            limit 1`,
            [input.judgeConfigId, input.teamId, input.projectId],
        );
        if (!owned.rows[0])
            throw new ApiNotFoundError("Judge config not found.");
        return input.judgeConfigId;
    }
    const result = await db.query<{ id: string }>(
        `insert into judge_configs (team_id, project_id, name, model_id, rubric_prompt, reasoning_config)
        values ($1, $2, 'Run judge', $3, $4, $5)
        returning id`,
        [
            input.teamId,
            input.projectId,
            input.runJudge.modelId,
            input.runJudge.rubricPrompt,
            input.runJudge.reasoningConfig ?? null,
        ],
    );
    return result.rows[0]!.id;
}

async function insertRun(
    db: IDb,
    input: ICreateRunRequest,
    sttConfig: ISttRunConfig | undefined,
    sttVariants: Record<string, ISttRunVariant> | undefined,
    judgeConfigId: string | undefined,
): Promise<string> {
    const result = await db.query<{ id: string }>(
        `insert into runs (
            team_id, project_id, dataset_id, judge_config_id, judge_prompt_version_id,
            pipeline_id, status, config_snapshot, created_by
        )
        values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)
        returning id`,
        [
            input.teamId,
            input.projectId,
            input.datasetId,
            judgeConfigId ?? null,
            input.judgePromptVersionId ?? null,
            input.pipelineId ?? null,
            {
                datasetId: input.datasetId,
                models: input.models,
                judgeConfigId,
                judgePromptVersionId: input.judgePromptVersionId,
                judgeTransport: input.runJudge?.transport,
                maxTokens: input.maxTokens,
                pipelineId: input.pipelineId,
                fieldConfigs: input.fieldConfigs,
                sourceRunId: input.sourceRunId,
                sttConfig,
                sttVariants,
                audioRunMode: input.audioRunMode,
                benchmark: input.benchmark,
                dataPolicy: input.dataPolicy,
                itemLimit: input.itemLimit,
                ...(input.itemFilter ? { itemFilter: input.itemFilter } : {}),
                ...(input.maxCostUsd !== undefined
                    ? { maxCostUsd: input.maxCostUsd }
                    : {}),
            },
            input.createdBy,
        ],
    );
    return result.rows[0]!.id;
}

async function insertRunModels(
    db: IDb,
    runId: string,
    models: ICreateRunRequest["models"],
): Promise<string[]> {
    const runModelIds: string[] = [];
    for (const model of models) {
        const result = await db.query<{ id: string }>(
            `insert into run_models (
                run_id, model_id, prompt_version_id, schema_version_id,
                prompt_snapshot, reasoning_config, is_reference, temperature
            )
            values ($1, $2, $3, $4, $5, $6, $7, $8)
            returning id`,
            [
                runId,
                model.modelId,
                model.promptVersionId ?? null,
                model.schemaVersionId ?? null,
                model.promptSnapshot ?? null,
                model.reasoningConfig ?? null,
                model.isReference,
                model.temperature ?? null,
            ],
        );
        runModelIds.push(result.rows[0]!.id);
    }
    return runModelIds;
}

export function sttConfigForSnapshot(
    sttConfig: ISttRunConfig | undefined,
    config: IApiConfig | undefined,
): ISttRunConfig | undefined {
    if (!sttConfig) return undefined;
    if (typeof sttConfig.modelId !== "string") return sttConfig;
    const identity = sttModelIdentityForId(sttConfig.modelId);
    const baseConfig: ISttRunConfig = {
        ...sttConfig,
        providerId:
            identity.providerId === "unknown"
                ? sttConfig.providerId
                : identity.providerId,
        routeId: identity.routeId,
        canonicalModelId: identity.canonicalModelId,
    };
    if (!sttConfig.transliteration?.enabled) return baseConfig;
    // The provider the run asks for wins; the server default fills in only
    // when none was given. The base URL always comes from the server: the
    // one `config` pairs with the key used (see configWithResolvedKeys).
    const providerMode = snapshotTransliterationProviderMode(
        sttConfig.transliteration,
        config,
    );
    const providerBaseUrl =
        providerMode === "openrouter"
            ? config?.openrouterBaseUrl
            : providerMode === "bifrost"
              ? config?.bifrostBaseUrl
              : undefined;
    const { providerBaseUrl: _requestedBaseUrl, ...transliteration } =
        sttConfig.transliteration;
    return {
        ...baseConfig,
        transliteration: {
            ...transliteration,
            providerMode,
            ...(providerBaseUrl ? { providerBaseUrl } : {}),
        },
    };
}

/**
 * The transliteration provider a request names, with legacy spellings read
 * as FLASH_EVALS_LLM_PROVIDER reads them. Undefined when none was given.
 */
function requestedTransliterationProviderMode(
    transliteration: ISttTransliterationConfig,
): EvalProviderMode | undefined {
    const raw: unknown = transliteration.providerMode;
    if (raw === undefined || raw === null || raw === "") return undefined;
    const mode =
        typeof raw === "string" ? normalizeProviderMode(raw) : undefined;
    if (!mode) {
        throw new ApiBadRequestError(
            "transliteration: Choose a valid provider (auto, vercel-ai-gateway, openrouter, openai or bifrost).",
        );
    }
    return mode;
}

/**
 * The transliteration provider a run records: the requested one, else the
 * .env default, else "auto". The worker uses exactly this recorded value.
 */
function snapshotTransliterationProviderMode(
    transliteration: ISttTransliterationConfig,
    config: Pick<IApiConfig, "flashEvalsLlmProvider"> | undefined,
): EvalProviderMode {
    return (
        requestedTransliterationProviderMode(transliteration) ??
        config?.flashEvalsLlmProvider ??
        "auto"
    );
}

const TRANSLITERATION_MODE_TRANSPORTS: Partial<
    Record<EvalProviderMode, ProviderTransport>
> = {
    "vercel-ai": "openai",
    openai: "openai",
    gateway: "gateway",
    openrouter: "openrouter",
    bifrost: "bifrost",
};

/**
 * Rejects a run whose transliteration asks for a provider the team has no
 * key for. `config` must already hold the team's saved keys.
 */
export function validateTransliterationProviderKeys(
    sttConfigs: (ISttRunConfig | undefined)[],
    config: IApiConfig | undefined,
): void {
    for (const sttConfig of sttConfigs) {
        const transliteration = sttConfig?.transliteration;
        if (!transliteration?.enabled) continue;
        const mode = requestedTransliterationProviderMode(transliteration);
        const transport = mode && TRANSLITERATION_MODE_TRANSPORTS[mode];
        if (!transport) continue;
        const key = config && transportApiKey(config, transport);
        if (!key) {
            throw new ApiBadRequestError(
                `transliteration: Add ${keyPhrase(transport)} in Settings before running transliteration through ${TRANSPORT_LABELS_FOR_MESSAGES[transport]}.`,
            );
        }
        if (transport === "bifrost" && !config?.bifrostBaseUrl) {
            throw new ApiBadRequestError(
                "transliteration: Add a Bifrost base URL in Settings before running transliteration through Bifrost.",
            );
        }
    }
}

export function normalizeSttVariants(
    sttVariants: ISttRunVariant[] | undefined,
    sttConfig: ISttRunConfig | undefined,
): ISttRunVariant[] {
    if (sttVariants === undefined) {
        return sttConfig
            ? [
                  {
                      variantKey: "v1",
                      label: sttConfig.modelId || "STT model",
                      config: sttConfig,
                  },
              ]
            : [];
    }
    if (!Array.isArray(sttVariants)) {
        throw new ApiBadRequestError("Choose a valid STT variants list.");
    }
    if (sttVariants.length < 1 || sttVariants.length > MAX_STT_VARIANTS) {
        throw new ApiBadRequestError(
            `Choose between 1 and ${MAX_STT_VARIANTS} STT variants.`,
        );
    }
    const keys = new Set<string>();
    return sttVariants.map((variant, index) => {
        const fallbackName = `Variant ${index + 1}`;
        if (!variant || typeof variant !== "object" || Array.isArray(variant)) {
            throw new ApiBadRequestError(
                `${fallbackName}: Choose a valid variant.`,
            );
        }
        const label =
            typeof variant.label === "string" && variant.label.trim()
                ? variant.label.trim()
                : fallbackName;
        if (
            typeof variant.variantKey !== "string" ||
            !/^[a-z0-9-]+$/.test(variant.variantKey)
        ) {
            throw new ApiBadRequestError(
                `Variant '${label}': key must contain only lowercase letters, numbers, and hyphens.`,
            );
        }
        if (keys.has(variant.variantKey)) {
            throw new ApiBadRequestError(
                `Variant '${label}': key '${variant.variantKey}' is duplicated.`,
            );
        }
        keys.add(variant.variantKey);
        if (
            !variant.config ||
            typeof variant.config !== "object" ||
            Array.isArray(variant.config)
        ) {
            throw new ApiBadRequestError(
                `Variant '${label}': Choose a valid STT configuration.`,
            );
        }
        return { ...variant, label };
    });
}

function normalizedSnapshotVariants(
    variants: ISttRunVariant[],
    evaluation: ISttRunEvaluation | undefined,
    config: IApiConfig | undefined,
): Record<string, ISttRunVariant> {
    return Object.fromEntries(
        variants.map((variant) => {
            const mergedConfig: ISttRunConfig = {
                ...variant.config,
                ...(evaluation?.transcriptVariant !== undefined
                    ? { transcriptVariant: evaluation.transcriptVariant }
                    : {}),
                ...(evaluation?.transliteration !== undefined
                    ? { transliteration: evaluation.transliteration }
                    : {}),
                ...(evaluation?.evaluator !== undefined
                    ? { evaluator: evaluation.evaluator }
                    : {}),
            };
            return [
                variant.variantKey,
                {
                    ...variant,
                    config: sttConfigForSnapshot(mergedConfig, config)!,
                },
            ];
        }),
    );
}

function validateVariantForRun(
    variant: ISttRunVariant,
    datasetModality: "audio" | "image" | "text",
    config: IApiConfig | undefined,
): void {
    try {
        validateSttConfigForRun({
            datasetModality,
            sttConfig: variant.config,
            config,
        });
    } catch (error) {
        if (error instanceof ApiBadRequestError) {
            throw new ApiBadRequestError(
                `Variant '${variant.label}': ${error.message}`,
            );
        }
        throw error;
    }
}

export function validateSttConfigForRun(input: {
    datasetModality: "audio" | "image" | "text";
    sttConfig?: ISttRunConfig;
    config?: IApiConfig;
}): void {
    if (input.datasetModality !== "audio") return;
    if (!input.sttConfig?.modelId) {
        throw new ApiBadRequestError("Choose an STT model for audio datasets.");
    }
    validateSttConfigDefinition(input.sttConfig);
    const definition = resolveSttModelDefinition(input.sttConfig.modelId);
    if (!definition)
        throw new ApiBadRequestError("Choose a supported STT model.");
    if (!input.config) {
        throw new ApiBadRequestError(
            "Server configuration is required to validate STT model availability.",
        );
    }
    const config = input.config;
    const option = sttModelOptions(config, config.sttCapabilityProbes).find(
        (model) => model.id === definition.id,
    );
    if (!option?.available) {
        throw new ApiBadRequestError(
            option?.unavailableReason ?? "Choose an available STT model.",
        );
    }
}

export function validateSttConfigDefinition(value: ISttRunConfig): void {
    validateSttConfigShape(value);
    validateSttModelConfig(value);
    validateTransliterationConfig(value);
    validateTranscriptEvaluatorConfig(value);
}

function validateSttConfigShape(value: ISttRunConfig): void {
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new ApiBadRequestError("Choose a valid STT configuration.");
    if (typeof value.modelId !== "string" || !value.modelId.trim())
        throw new ApiBadRequestError("Choose an STT model.");
    if (
        value.transcriptVariant !== undefined &&
        value.transcriptVariant !== "raw" &&
        value.transcriptVariant !== "latin"
    )
        throw new ApiBadRequestError("Choose a supported transcript variant.");
    if (
        value.levelVolume !== undefined &&
        typeof value.levelVolume !== "boolean"
    )
        throw new ApiBadRequestError(
            "Level volume first must be true or false.",
        );
    for (const [field, nested] of [
        ["STT model config", value.config],
        ["transliteration config", value.transliteration],
        ["transcript judge config", value.evaluator],
    ] as const)
        if (
            nested !== undefined &&
            (typeof nested !== "object" ||
                nested === null ||
                Array.isArray(nested))
        )
            throw new ApiBadRequestError(`${field} must be an object.`);
}

function validateSttModelConfig(value: ISttRunConfig): void {
    const definition = resolveSttModelDefinition(value.modelId);
    if (!definition)
        throw new ApiBadRequestError("Choose a supported STT model.");
    if (value.language !== undefined && typeof value.language !== "string")
        throw new ApiBadRequestError("Audio language must be text.");
    if (value.language?.trim() && !sttModelSupportsLanguage(value.modelId))
        throw new ApiBadRequestError(
            `${definition.label} does not support an audio language override.`,
        );
    const unsupportedKeys = unsupportedSttConfigKeys(
        value.modelId,
        value.config,
    );
    if (unsupportedKeys.length > 0)
        throw new ApiBadRequestError(
            `Unsupported STT config for ${definition.label}: ${unsupportedKeys.join(", ")}.`,
        );
    const invalidMessages = invalidSttConfigMessages(
        value.modelId,
        value.config,
    );
    if (invalidMessages.length > 0)
        throw new ApiBadRequestError(
            `Invalid STT config for ${definition.label}: ${invalidMessages.join(" ")}`,
        );
}

async function insertRunCells(
    db: IDb,
    runId: string,
    runModelIds: string[],
    items: IRunCreateItemRow[],
): Promise<void> {
    const values: unknown[] = [];
    const placeholders: string[] = [];
    let index = 1;
    for (const runModelId of runModelIds) {
        for (const item of items) {
            placeholders.push(
                `($${index++}, $${index++}, $${index++}, 'pending', $${index++})`,
            );
            values.push(
                runId,
                item.id,
                runModelId,
                contentFingerprintForItem(item.input_text, item.storage_key),
            );
        }
    }
    if (placeholders.length === 0) return;
    await db.query(
        `insert into run_cells (run_id, dataset_item_id, run_model_id, status, content_fingerprint)
        values ${placeholders.join(", ")}`,
        values,
    );
}

async function listRunSetupDatasets(
    db: IDb,
    teamId: string,
    projectId: string,
) {
    const result = await db.query<IDatasetOptionRow>(
        `select d.id, d.name, d.modality, d.purpose,
            count(di.id)::int as item_count,
            avg(length(di.input_text))::int as avg_input_chars,
            count(l.id) filter (where l.label_json <> '{}'::jsonb)::int as labeled_item_count
        from datasets d
        left join dataset_items di on di.dataset_id = d.id
        left join labels l on l.dataset_item_id = di.id
        where d.team_id = $1 and d.project_id = $2 and d.archived_at is null
        group by d.id, d.name, d.purpose, d.modality
        order by d.created_at desc`,
        [teamId, projectId],
    );
    return result.rows
        .map((row) => ({
            id: row.id,
            name: row.name,
            itemCount: countValue(row.item_count),
            labeledItemCount: countValue(row.labeled_item_count),
            purpose: row.purpose,
            modality: row.modality,
            ...(row.avg_input_chars
                ? { avgInputChars: countValue(row.avg_input_chars) }
                : {}),
        }))
        .filter(
            (row) =>
                row.itemCount > 0 &&
                (row.purpose === "evaluation" || row.labeledItemCount > 0),
        );
}

async function listRunSetupBundles(db: IDb, teamId: string, projectId: string) {
    const result = await db.query<IBundleOptionRow>(
        `select id, name, field_configs from pipelines where team_id = $1 and project_id = $2 order by created_at desc`,
        [teamId, projectId],
    );
    return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        fieldConfigs: row.field_configs,
        fieldCount: row.field_configs.length,
    }));
}

async function listRunSetupVersions(
    db: IDb,
    teamId: string,
    projectId: string,
) {
    const result = await db.query<IVersionOptionRow>(
        `select pv.id, p.name as prompt_name, pv.version, psv.json_schema,
            psv.field_configs, pv.reasoning_config,
            length(pv.content)::int as prompt_chars
        from prompts p
        inner join prompt_versions pv on pv.prompt_id = p.id
        inner join prompt_schema_versions psv on psv.id = pv.schema_version_id
        where p.team_id = $1 and p.project_id = $2 and p.kind = 'eval' and pv.status = 'runnable'
        order by p.name asc, pv.version desc`,
        [teamId, projectId],
    );
    return result.rows.map((row) => ({
        id: row.id,
        label: `${row.prompt_name} v${countValue(row.version)}`,
        fieldConfigs:
            row.field_configs.length > 0
                ? row.field_configs
                : defaultFieldConfigsForSchema(row.json_schema),
        reasoningConfig: row.reasoning_config ?? undefined,
        outputSchema: row.json_schema as IJsonSchemaObject,
        ...(row.prompt_chars
            ? { promptChars: countValue(row.prompt_chars) }
            : {}),
    }));
}

function defaultFieldConfigsForSchema(
    schema: Record<string, unknown>,
): IPipelineFieldConfig[] {
    const paths = extractSchemaPaths(schema);
    return paths
        .filter(
            (candidate) =>
                !paths.some(
                    (other) =>
                        other.path !== candidate.path &&
                        other.path.startsWith(`${candidate.path}.`),
                ),
        )
        .map((path) => ({
            field: path.path,
            kind: "factual" as const,
            spec: { matcher: path.type === "array" ? "set_overlap" : "exact" },
        }));
}

function extractSchemaPaths(
    schema: unknown,
): Array<{ path: string; type: string }> {
    if (!isRecord(schema) || !isRecord(schema.properties)) return [];
    const paths: Array<{ path: string; type: string }> = [];
    collectSchemaPaths("$", schema, paths);
    return paths.filter((path) => path.path !== "$");
}

function collectSchemaPaths(
    path: string,
    schema: Record<string, unknown>,
    paths: Array<{ path: string; type: string }>,
): void {
    paths.push({ path, type: formatSchemaType(schema.type) });
    if (!isRecord(schema.properties)) return;
    for (const [field, child] of Object.entries(schema.properties)) {
        if (!isRecord(child)) continue;
        collectSchemaPaths(
            path === "$" ? `$.${field}` : `${path}.${field}`,
            child,
            paths,
        );
    }
}

function formatSchemaType(type: unknown): string {
    if (type === "array") return "array";
    if (Array.isArray(type)) return type.join("|");
    return typeof type === "string" ? type : "unknown";
}

async function listRunSetupJudgePrompts(
    db: IDb,
    teamId: string,
    projectId: string,
) {
    const result = await db.query<IJudgePromptOptionRow>(
        `select distinct on (p.id) pv.id as prompt_version_id, p.name as prompt_name,
            pv.version, pv.judge_spec
        from prompts p
        inner join prompt_versions pv on pv.prompt_id = p.id
        where p.team_id = $1 and p.project_id = $2 and p.kind = 'judge'
            and pv.status = 'runnable' and pv.judge_spec is not null
        order by p.id, pv.version desc`,
        [teamId, projectId],
    );
    return result.rows
        .filter((row) => Boolean(row.judge_spec))
        .map((row) => ({
            promptVersionId: row.prompt_version_id,
            label: `${row.prompt_name} v${countValue(row.version)}`,
        }));
}

function validateTransliterationConfig(sttConfig: ISttRunConfig): void {
    if (sttConfig.transcriptVariant !== "latin") return;
    const transliteration = sttConfig.transliteration;
    if (!transliteration?.enabled) {
        throw new ApiBadRequestError(
            "Latin transcript variant requires transliteration to be enabled.",
        );
    }
    if (transliteration.targetScript !== "latin") {
        throw new ApiBadRequestError(
            "Only Latin transliteration is supported right now.",
        );
    }
    if (!transliteration.modelId?.trim()) {
        throw new ApiBadRequestError("Choose a transliteration model.");
    }
    if (
        transliteration.temperature !== undefined &&
        !validTemperature(transliteration.temperature)
    ) {
        throw new ApiBadRequestError(
            "Transliteration temperature must be a number between 0 and 2.",
        );
    }
}

function validateTranscriptEvaluatorConfig(sttConfig: ISttRunConfig): void {
    const evaluator = sttConfig.evaluator;
    if (!evaluator?.enabled) return;
    if (!evaluator.modelId?.trim()) {
        throw new ApiBadRequestError("Choose a transcript judge model.");
    }
    if (!evaluator.rubricPrompt?.trim()) {
        throw new ApiBadRequestError("Add a transcript judge rubric.");
    }
    if (
        evaluator.reasoningEffort !== undefined &&
        !["none", "minimal", "low", "medium", "high", "xhigh"].includes(
            evaluator.reasoningEffort,
        )
    ) {
        throw new ApiBadRequestError(
            "Transcript judge reasoning effort is not supported.",
        );
    }
}

function validTemperature(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 2
    );
}

function contentFingerprintForItem(
    inputText: string | null | undefined,
    storageKey: string | null | undefined,
): string {
    return createHash("sha256")
        .update(inputText ?? "")
        .update("\0")
        .update(storageKey ?? "")
        .digest("hex");
}

function countValue(value: number | string): number {
    return typeof value === "number" ? value : Number(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
