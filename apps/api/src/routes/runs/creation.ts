import { createHash } from "node:crypto";
import type {
    ICreateRunRequest,
    ICreateRunResponse,
    ICreateRunFromSelectionRequest,
    IPipelineFieldConfig,
    IReasoningConfig,
    IRunSetupResponse,
    ISttRunEvaluation,
    ISttRunConfig,
    ISttRunVariant,
} from "@mosaic/api-contract";
import {
    MAX_STT_VARIANTS,
    sttMetricsModelId,
    sttModelIdentityForId,
} from "@mosaic/api-contract";
import type { IApiConfig } from "../../config.js";
import { type IDb, withTransaction } from "../../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../../errors.js";
import {
    availableModelOptions,
    modelAllowedForProvider,
    registryEntryFor,
} from "../../modelRegistry.js";
import {
    invalidSttConfigMessages,
    resolveSttModelDefinition,
    sttModelOptions,
    unsupportedSttConfigKeys,
} from "../../sttModels.js";
import { sttModelSupportsLanguage } from "@mosaic/api-contract";
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
    const modelsPromise = keysPromise.then((resolved) =>
        availableModelOptions(resolved.apiKeys, {
            beforeListing: teamBaseUrlListingGuard(resolved),
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
        hasPrompt: versionOptions.length > 0,
        judgePrompts,
        sttModels: sttModelOptions(
            configWithResolvedKeys(config, resolvedKeys),
            config.sttCapabilityProbes,
        ),
    };
}

export async function createRunPayload(
    db: IDb,
    input: ICreateRunRequest,
    config?: IApiConfig,
): Promise<ICreateRunResponse> {
    const preparedInput = inputWithSttVariantModels(input);
    validateRunModelTransports(preparedInput.models);
    validateUniqueModelIds(preparedInput.models.map(({ modelId }) => modelId));
    await validateTransportKeysWithResolvedKeys(db, preparedInput, config);
    return withTransaction(db, (tx) =>
        createRunPayloadInTransaction(tx, preparedInput, config),
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
        Boolean(input.runJudge?.transport);
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
        geminiApiKey: resolved.sttProviderKeys.gemini,
        openrouterApiKey: resolved.apiKeys.openrouter,
        openrouterBaseUrl: resolved.apiKeys.openrouterBaseUrl,
        bifrostApiKey: resolved.apiKeys.bifrost,
        bifrostBaseUrl: resolved.apiKeys.bifrostBaseUrl,
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
        ]),
    ];
    if (transports.length === 0) return;
    if (!config) {
        throw new ApiBadRequestError(
            "Provider configuration is required for explicit transport selections.",
        );
    }
    const apiKeys = {
        openai: config.openaiApiKey,
        gateway: config.aiGatewayApiKey,
        openrouter: config.openrouterApiKey,
        bifrost: config.bifrostApiKey,
    };
    for (const transport of transports) {
        if (!apiKeys[transport]) {
            throw new ApiBadRequestError(
                `transportAssignments: Add a ${transportLabel(transport)} API key before selecting the "${transport}" transport.`,
            );
        }
    }
}

function transportLabel(
    transport: "openai" | "gateway" | "openrouter" | "bifrost",
): string {
    if (transport === "gateway") return "Vercel AI Gateway";
    if (transport === "openrouter") return "OpenRouter";
    if (transport === "bifrost") return "Bifrost";
    return "OpenAI";
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

function validateRunModelTransports(models: ICreateRunRequest["models"]): void {
    for (const model of models) {
        if (
            model.transport &&
            !registryEntryFor(model.modelId)?.transports[model.transport] &&
            model.transport !== "gateway"
        ) {
            throw new ApiBadRequestError(
                `Model "${model.modelId}" does not support the "${model.transport}" transport.`,
            );
        }
    }
}

export async function createRunFromSelectionPayload(
    db: IDb,
    input: ICreateRunFromSelectionRequest,
    config?: IApiConfig,
): Promise<ICreateRunResponse> {
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

    const providerMode = config?.mosaicLlmProvider ?? "openai";
    validateTransportAssignments(input);
    validateUniqueModelIds(input.modelIds);
    validateCandidateModels(
        input.modelIds,
        datasetModality,
        providerMode,
        new Set(input.transportAssignments?.map(({ modelId }) => modelId)),
    );
    const pipeline = input.pipelineId
        ? await getCreateRunPipeline(
              db,
              input.teamId,
              input.projectId,
              input.pipelineId,
          )
        : undefined;
    const promptRows = await resolvePromptRows(db, input);
    const fieldConfigs = resolveAndValidateFieldConfigs({
        input,
        dataset,
        pipeline,
        promptRows,
        providerMode,
    });

    return createRunPayload(
        db,
        buildCreateRunRequest(
            input,
            promptRows,
            fieldConfigs,
            sttConfig,
            audioRunMode,
        ),
        selectionConfig,
    );
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
    providerMode: IApiConfig["mosaicLlmProvider"],
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

function resolveAndValidateFieldConfigs(input: {
    input: ICreateRunFromSelectionRequest;
    dataset: ISelectionDatasetRow;
    pipeline?: ICreateRunPipelineRow;
    promptRows: IResolvedPromptRow[];
    providerMode: IApiConfig["mosaicLlmProvider"];
}): IPipelineFieldConfig[] {
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

    validateScoringConfiguration(input, merged.fieldConfigs);
    return input.pipeline?.field_configs ?? merged.fieldConfigs;
}

function validateScoringConfiguration(
    input: {
        input: ICreateRunFromSelectionRequest;
        dataset: ISelectionDatasetRow;
        pipeline?: ICreateRunPipelineRow;
        promptRows: IResolvedPromptRow[];
        providerMode: IApiConfig["mosaicLlmProvider"];
    },
    fieldConfigs: IPipelineFieldConfig[],
): void {
    const outputSchema =
        input.pipeline?.output_schema ??
        input.promptRows[0]?.schemaVersion.json_schema;
    if (!outputSchema)
        throw new ApiBadRequestError("Choose a runnable prompt version.");
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
        ),
        maxTokens: input.maxTokens,
        fieldConfigs,
        createdBy: input.createdBy,
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
    };
}

function buildRunModels(
    promptRows: IResolvedPromptRow[],
    referenceModel: string | undefined,
    transportAssignments: NonNullable<
        ICreateRunFromSelectionRequest["transportAssignments"]
    >,
): ICreateRunRequest["models"] {
    const transportByModel = new Map(
        transportAssignments.map(({ modelId, transport }) => [
            modelId,
            transport,
        ]),
    );
    return promptRows.map((row) => ({
        modelId: row.modelId,
        ...(transportByModel.has(row.modelId)
            ? { transport: transportByModel.get(row.modelId) }
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
            ...(input.sourceRunId ? { sourceRunId: input.sourceRunId } : {}),
            ...(legacyConfig ? { sttConfig: legacyConfig } : {}),
            ...(explicitVariants ? { sttVariants: variants } : {}),
            ...(input.sttEvaluation
                ? { sttEvaluation: input.sttEvaluation }
                : {}),
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

export function resolveReasoningEffort(
    modelId: string,
    requested?: IReasoningConfig["effort"],
): IReasoningConfig["effort"] | undefined {
    const capability = registryEntryFor(modelId)?.reasoningEffort;
    if (!capability) return undefined;
    if (requested && capability.supportedLevels.includes(requested))
        return requested;
    return capability.defaultLevel;
}

function validateModelIdsForProvider(
    modelIds: string[],
    providerMode: IApiConfig["mosaicLlmProvider"],
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
        if (
            !registryEntryFor(assignment.modelId)?.transports[
                assignment.transport
            ] &&
            assignment.transport !== "gateway"
        ) {
            throw new ApiBadRequestError(
                `Model "${assignment.modelId}" does not support the "${assignment.transport}" transport.`,
            );
        }
    }
}

function validateKnownModelCapabilities(input: {
    modelIds: string[];
    datasetModality: "audio" | "image" | "text";
}): void {
    if (input.datasetModality !== "image") return;
    for (const modelId of input.modelIds) {
        if (!registryEntryFor(modelId)?.vision) {
            throw new ApiBadRequestError(
                `${modelId} cannot run on image datasets because vision support is not available.`,
            );
        }
    }
}

function validateStructuredOutputModels(modelIds: string[]): void {
    for (const modelId of modelIds) {
        const entry = registryEntryFor(modelId);
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
    providerMode: IApiConfig["mosaicLlmProvider"];
}): void {
    const modelIds = [
        ...(input.judgeModelId ? [input.judgeModelId] : []),
        ...input.fieldConfigs.flatMap((config) =>
            config.kind === "generative" ? [config.modelId] : [],
        ),
    ];
    for (const modelId of modelIds) {
        if (modelId === input.judgeModelId && input.judgeTransport) {
            if (!registryEntryFor(modelId)?.transports[input.judgeTransport]) {
                throw new ApiBadRequestError(
                    `Model "${modelId}" does not support the "${input.judgeTransport}" transport.`,
                );
            }
            continue;
        }
        validateJudgeModel(modelId, input.providerMode);
    }
}

function validateJudgeModel(
    modelId: string,
    providerMode: IApiConfig["mosaicLlmProvider"],
): void {
    const entry = registryEntryFor(modelId);
    if (entry && !modelAllowedForProvider(entry, providerMode)) {
        throw new ApiBadRequestError(
            `${entry.label} is not available for the configured provider mode.`,
        );
    }
    if (entry && (!entry.judgeSuitable || !entry.structuredOutput)) {
        throw new ApiBadRequestError(
            `${entry.label} cannot be used as a judge model.`,
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
    const sttVariants = input.sttVariants
        ? normalizedSnapshotVariants(
              rawVariants,
              input.sttEvaluation,
              effectiveConfig,
          )
        : undefined;
    const sttConfig = input.sttVariants
        ? undefined
        : sttConfigForSnapshot(input.sttConfig, effectiveConfig);
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
    const items = await listRunCreateItems(db, input.datasetId);
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
        input,
        sttConfig,
        sttVariants,
        judgeConfigId,
    );
    const runModelIds = await insertRunModels(db, runId, input.models);
    await insertRunCells(db, runId, runModelIds, items);
    return { runId };
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

async function listRunCreateItems(
    db: IDb,
    datasetId: string,
): Promise<IRunCreateItemRow[]> {
    const result = await db.query<IRunCreateItemRow>(
        `select id, input_text, storage_key
        from dataset_items
        where dataset_id = $1`,
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
                prompt_snapshot, reasoning_config, is_reference
            )
            values ($1, $2, $3, $4, $5, $6, $7)
            returning id`,
            [
                runId,
                model.modelId,
                model.promptVersionId ?? null,
                model.schemaVersionId ?? null,
                model.promptSnapshot ?? null,
                model.reasoningConfig ?? null,
                model.isReference,
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
    const providerBaseUrl =
        config?.mosaicLlmProvider === "openrouter"
            ? config.openrouterBaseUrl
            : config?.mosaicLlmProvider === "bifrost"
              ? config.bifrostBaseUrl
              : undefined;
    return {
        ...baseConfig,
        transliteration: {
            ...sttConfig.transliteration,
            providerMode: config?.mosaicLlmProvider ?? "auto",
            ...(providerBaseUrl ? { providerBaseUrl } : {}),
        },
    };
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
            count(l.id)::int as labeled_item_count
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
            psv.field_configs, pv.reasoning_config
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
