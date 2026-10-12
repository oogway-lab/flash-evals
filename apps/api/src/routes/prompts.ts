import { createHash } from "node:crypto";
import Ajv2020Module from "ajv/dist/2020.js";
import type { ErrorObject, ValidateFunction } from "ajv";
import addFormatsModule from "ajv-formats";
import type {
    ICreateJudgePromptRequest,
    IDeletePromptRequest,
    IDuplicatePromptVersionRequest,
    IGeneratePromptSchemaRequest,
    IGeneratePromptSchemaResponse,
    IOptimizePromptRequest,
    IOptimizePromptResponse,
    IPromptDetailResponse,
    IPromptDetailVersion,
    IPromptListRow,
    IPromptSampleInput,
    IPromptTestRunResponse,
    IPromptValidationEvidence,
    IPromptWorkbenchSetupResponse,
    IRecordPromptValidationAttemptRequest,
    ISaveRunnablePromptRequest,
    ISaveRunnablePromptResponse,
    ISchemaCompatibilityIssue,
    ITestJudgeDraftRequest,
    ITestJudgeDraftResponse,
    ITestPromptDraftRequest,
    ITestPromptDraftResponse,
    IValidateRunnablePromptRequest,
    IValidateRunnablePromptResponse,
    IJsonSchemaObject,
    ProviderTransport,
    ReasoningEffort,
} from "@mosaic/api-contract";
import {
    computeCostFromUsageWithPricing,
    getBareModelName,
    getEvalProvider,
    guidanceForModel,
    listAvailableModelMetadata,
    registryEntryForLiveGatewayModel,
    type IEvalCompletionProvider,
    type IModelPricing,
    type UsageData,
} from "@mosaic/llm-core";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiNotFoundError,
} from "../errors.js";
import { availableModelOptions, registryEntryFor } from "../modelRegistry.js";
import {
    resolveApiKeys,
    teamBaseUrlListingGuard,
    teamBaseUrlProviderOptions,
} from "../secrets/resolveApiKeys.js";
import { assertProjectInTeam } from "./projectScope.js";

interface IPromptRow {
    id: string;
    name: string;
    description: string | null;
    kind: IPromptListRow["kind"];
    latest_version: number | string | null;
    latest_status: "legacy" | "runnable" | null;
    latest_created_at: Date | string | null;
    latest_optimizer_attempt_id: string | null;
}

interface IPromptDetailRow {
    id: string;
    name: string;
    description: string | null;
    kind: "eval" | "judge";
}

interface IPromptVersionRow {
    id: string;
    version: number | string;
    status: "legacy" | "runnable";
    content: string;
    created_at: Date | string;
    schema_version_id: string | null;
    optimizer_attempt_id: string | null;
}

interface ISchemaVersionRow {
    json_schema: unknown;
}

interface IFitTagRow {
    tag: string;
}

interface IIdRow {
    id: string;
}

interface IPromptWorkbenchPromptRow {
    id: string;
    name: string;
    description: string | null;
    kind: "eval" | "judge";
    target_model_id: string | null;
}

interface IPromptWorkbenchVersionRow {
    id: string;
    content: string;
    schema_version_id: string | null;
    reasoning_config: { effort?: ReasoningEffort } | null;
}

interface ISourcePromptVersionRow {
    id: string;
    prompt_id: string;
    content: string;
    schema_version_id: string | null;
    validation_attempt_id: string | null;
    reasoning_config: { effort?: ReasoningEffort } | null;
}

interface ISourcePromptRow {
    id: string;
    team_id: string;
    name: string;
    description: string | null;
    base_prompt_id: string | null;
    target_model_id: string | null;
}

interface ISourceSchemaVersionRow {
    json_schema: unknown;
    field_configs: unknown;
    schema_hash: string;
    openai_compatible: boolean;
    compatibility_errors: unknown;
}

interface ISourceValidationAttemptRow {
    target_model_id: string;
    status: string;
    evidence: unknown;
    raw_output: string | null;
    parsed_output: unknown;
    latency_ms: number | string | null;
}

interface ISchemaInsertRow {
    id: string;
    schema_hash: string;
}

interface IPromptOwnershipRow {
    id: string;
    team_id: string;
    kind: "eval" | "judge";
}

interface IVersionInsertRow {
    id: string;
    version: number | string;
}

interface IAjvValidator {
    compile: (schema: unknown) => ValidateFunction;
}

const Ajv2020 = Ajv2020Module as unknown as new (options: {
    allErrors: boolean;
    strict: boolean;
    validateSchema: boolean;
}) => IAjvValidator;
const addFormats = addFormatsModule as unknown as (
    validator: IAjvValidator,
) => void;

const ajv = new Ajv2020({
    allErrors: true,
    strict: false,
    validateSchema: true,
});
addFormats(ajv);

const OPENAI_UNSUPPORTED_KEYS = new Set([
    "$ref",
    "$defs",
    "definitions",
    "patternProperties",
    "dependencies",
    "dependentSchemas",
    "unevaluatedProperties",
    "unevaluatedItems",
    "contains",
    "minContains",
    "maxContains",
    "propertyNames",
    "if",
    "then",
    "else",
    "not",
]);

const PROTOTYPE_POLLUTION_KEYS = new Set([
    "__proto__",
    "prototype",
    "constructor",
]);

const DEFAULT_PROMPT_TEST_MAX_TOKENS = 1200;

export async function listPromptsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IPromptListRow[]> {
    const result = await db.query<IPromptRow>(
        `select
            p.id,
            p.name,
            p.description,
            p.kind,
            latest.version as latest_version,
            latest.status as latest_status,
            latest.created_at as latest_created_at,
            latest.optimizer_attempt_id as latest_optimizer_attempt_id
        from prompts p
        left join lateral (
            select version, status, created_at, optimizer_attempt_id
            from prompt_versions
            where prompt_id = p.id
            order by version desc
            limit 1
        ) latest on true
        where p.team_id = $1 and p.project_id = $2
        order by latest.created_at desc nulls last, p.created_at desc`,
        [teamId, projectId],
    );

    return result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        kind: row.kind,
        latest:
            row.latest_version && row.latest_status && row.latest_created_at
                ? {
                      version:
                          typeof row.latest_version === "number"
                              ? row.latest_version
                              : Number(row.latest_version),
                      status: row.latest_status,
                      createdAt:
                          row.latest_created_at instanceof Date
                              ? row.latest_created_at.toISOString()
                              : new Date(row.latest_created_at).toISOString(),
                      optimizedWithAi: Boolean(row.latest_optimizer_attempt_id),
                  }
                : undefined,
    }));
}

export async function promptDetailPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    promptId: string,
): Promise<IPromptDetailResponse> {
    const promptResult = await db.query<IPromptDetailRow>(
        `select id, name, description, kind
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [promptId, teamId, projectId],
    );
    const prompt = promptResult.rows[0];
    if (!prompt) throw new ApiNotFoundError();

    const versions = await listPromptDetailVersions(db, promptId);
    const latestVersion = versions[0];
    const schemaVersion = latestVersion?.schemaVersionId
        ? await getPromptDetailSchema(db, latestVersion.schemaVersionId)
        : undefined;

    return {
        prompt,
        latestVersion,
        schemaVersion,
        versions,
    };
}

export async function promptWorkbenchSetupPayload(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    projectId: string,
    promptId?: string,
): Promise<IPromptWorkbenchSetupResponse> {
    const modelsPromise = resolveApiKeys(db, config, teamId).then((resolved) =>
        availableModelOptions(resolved.apiKeys, {
            beforeListing: teamBaseUrlListingGuard(resolved),
        }),
    );
    const [tagSuggestions, initialPrompt, models] = await Promise.all([
        listTeamFitTagsPayload(db, teamId, projectId),
        promptId
            ? promptWorkbenchInitialPrompt(db, teamId, projectId, promptId)
            : undefined,
        modelsPromise,
    ]);

    return {
        tagSuggestions,
        availableModels: models.models,
        modelsDegraded: models.degraded,
        initialPrompt,
    };
}

export async function deletePromptPayload(
    db: IDb,
    input: IDeletePromptRequest,
): Promise<void> {
    const promptResult = await db.query<IIdRow>(
        `select id
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.promptId, input.teamId, input.projectId],
    );
    if (!promptResult.rows[0]) throw new ApiNotFoundError("Prompt not found.");

    const versionIds = (
        await db.query<IIdRow>(
            `select id
            from prompt_versions
            where prompt_id = $1`,
            [input.promptId],
        )
    ).rows.map((row) => row.id);

    if (versionIds.length > 0) {
        const [runModelUsage, judgeRunUsage] = await Promise.all([
            db.query<IIdRow>(
                `select id
                from run_models
                where prompt_version_id = any($1::uuid[])
                limit 1`,
                [versionIds],
            ),
            db.query<IIdRow>(
                `select id
                from runs
                where judge_prompt_version_id = any($1::uuid[])
                limit 1`,
                [versionIds],
            ),
        ]);
        if (runModelUsage.rows.length > 0 || judgeRunUsage.rows.length > 0) {
            throw new ApiConflictError(
                "Delete the runs that use this prompt before deleting the prompt.",
            );
        }
    }

    const schemaIds = (
        await db.query<IIdRow>(
            `select id
            from prompt_schema_versions
            where prompt_id = $1`,
            [input.promptId],
        )
    ).rows.map((row) => row.id);
    const draftIds = (
        await db.query<IIdRow>(
            `select id
            from prompt_drafts
            where prompt_id = $1`,
            [input.promptId],
        )
    ).rows.map((row) => row.id);
    const validationIds = new Set<string>();
    for (const row of (
        await db.query<IIdRow>(
            `select id
            from prompt_validation_attempts
            where prompt_id = $1`,
            [input.promptId],
        )
    ).rows) {
        validationIds.add(row.id);
    }
    if (draftIds.length > 0) {
        for (const row of (
            await db.query<IIdRow>(
                `select id
                from prompt_validation_attempts
                where draft_id = any($1::uuid[])`,
                [draftIds],
            )
        ).rows) {
            validationIds.add(row.id);
        }
    }
    if (versionIds.length > 0) {
        for (const row of (
            await db.query<IIdRow>(
                `select id
                from prompt_validation_attempts
                where prompt_version_id = any($1::uuid[])`,
                [versionIds],
            )
        ).rows) {
            validationIds.add(row.id);
        }
    }
    if (schemaIds.length > 0) {
        for (const row of (
            await db.query<IIdRow>(
                `select id
                from prompt_validation_attempts
                where schema_version_id = any($1::uuid[])`,
                [schemaIds],
            )
        ).rows) {
            validationIds.add(row.id);
        }
    }
    const validationAttemptIds = [...validationIds];

    if (versionIds.length > 0) {
        await db.query(
            `update prompt_versions
            set
                status = 'legacy',
                schema_version_id = null,
                validation_attempt_id = null,
                optimizer_attempt_id = null
            where prompt_id = $1`,
            [input.promptId],
        );
        await db.query(
            `update prompt_drafts
            set source_prompt_version_id = null
            where source_prompt_version_id = any($1::uuid[])`,
            [versionIds],
        );
        await db.query(
            `update prompt_validation_attempts
            set prompt_version_id = null
            where prompt_version_id = any($1::uuid[])`,
            [versionIds],
        );
        await db.query(
            `update prompt_optimization_attempts
            set source_prompt_version_id = null
            where source_prompt_version_id = any($1::uuid[])`,
            [versionIds],
        );
        await db.query(
            `delete from prompt_version_fit_tags
            where prompt_version_id = any($1::uuid[])`,
            [versionIds],
        );
    }

    if (schemaIds.length > 0) {
        await db.query(
            `update prompt_drafts
            set source_schema_version_id = null
            where source_schema_version_id = any($1::uuid[])`,
            [schemaIds],
        );
        await db.query(
            `update prompt_validation_attempts
            set schema_version_id = null
            where schema_version_id = any($1::uuid[])`,
            [schemaIds],
        );
    }

    if (validationAttemptIds.length > 0) {
        await db.query(
            `update prompt_optimization_attempts
            set validation_attempt_id = null
            where validation_attempt_id = any($1::uuid[])`,
            [validationAttemptIds],
        );
    }

    await db.query(
        `delete from prompt_optimization_attempts where prompt_id = $1`,
        [input.promptId],
    );
    if (draftIds.length > 0) {
        await db.query(
            `delete from prompt_optimization_attempts
            where draft_id = any($1::uuid[])`,
            [draftIds],
        );
    }
    if (validationAttemptIds.length > 0) {
        await db.query(
            `delete from prompt_validation_attempts
            where id = any($1::uuid[])`,
            [validationAttemptIds],
        );
    }
    await db.query(`delete from prompt_drafts where prompt_id = $1`, [
        input.promptId,
    ]);
    await db.query(
        `update pipelines set prompt_id = null where prompt_id = $1`,
        [input.promptId],
    );
    await db.query(`delete from prompt_versions where prompt_id = $1`, [
        input.promptId,
    ]);
    await db.query(`delete from prompt_schema_versions where prompt_id = $1`, [
        input.promptId,
    ]);
    await db.query(`delete from prompts where id = $1 and team_id = $2`, [
        input.promptId,
        input.teamId,
    ]);
}

export async function duplicatePromptVersionPayload(
    db: IDb,
    input: IDuplicatePromptVersionRequest,
): Promise<{
    sourcePromptVersionId: string;
    promptId: string;
    promptVersionId: string;
}> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    const sourceVersionResult = await db.query<ISourcePromptVersionRow>(
        `select
            id,
            prompt_id,
            content,
            schema_version_id,
            validation_attempt_id,
            reasoning_config
        from prompt_versions
        where id = $1
        limit 1`,
        [input.sourcePromptVersionId],
    );
    const sourceVersion = sourceVersionResult.rows[0];
    if (!sourceVersion)
        throw new ApiNotFoundError("Source prompt version not found.");

    const sourcePromptResult = await db.query<ISourcePromptRow>(
        `select
            id,
            team_id,
            name,
            description,
            base_prompt_id,
            target_model_id
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [sourceVersion.prompt_id, input.teamId, input.projectId],
    );
    const sourcePrompt = sourcePromptResult.rows[0];
    if (!sourcePrompt) throw new ApiNotFoundError("Source prompt not found.");

    if (!sourceVersion.schema_version_id) {
        throw new ApiBadRequestError(
            "Only structured prompt versions can be duplicated.",
        );
    }

    const sourceSchemaResult = await db.query<ISourceSchemaVersionRow>(
        `select
            json_schema,
            field_configs,
            schema_hash,
            openai_compatible,
            compatibility_errors
        from prompt_schema_versions
        where id = $1
        limit 1`,
        [sourceVersion.schema_version_id],
    );
    const sourceSchema = sourceSchemaResult.rows[0];
    if (!sourceSchema)
        throw new ApiNotFoundError("Source prompt schema not found.");

    if (!sourceVersion.validation_attempt_id) {
        throw new ApiBadRequestError(
            "Source prompt version is missing validation evidence.",
        );
    }

    const sourceAttemptResult = await db.query<ISourceValidationAttemptRow>(
        `select
            target_model_id,
            status,
            evidence,
            raw_output,
            parsed_output,
            latency_ms
        from prompt_validation_attempts
        where id = $1
        limit 1`,
        [sourceVersion.validation_attempt_id],
    );
    const sourceAttempt = sourceAttemptResult.rows[0];
    if (!sourceAttempt || sourceAttempt.status !== "passed") {
        throw new ApiBadRequestError(
            "Source prompt validation evidence was not found.",
        );
    }

    const promptResult = await db.query<IIdRow>(
        `insert into prompts (
            team_id,
            project_id,
            name,
            kind,
            base_prompt_id,
            target_model_id,
            description
        )
        values ($1, $2, $3, 'eval', $4, $5, $6)
        returning id`,
        [
            input.teamId,
            input.projectId,
            `${sourcePrompt.name} copy`,
            sourcePrompt.base_prompt_id ?? sourcePrompt.id,
            sourcePrompt.target_model_id,
            sourcePrompt.description,
        ],
    );
    const promptId = promptResult.rows[0]!.id;

    const schemaResult = await db.query<ISchemaInsertRow>(
        `insert into prompt_schema_versions (
            prompt_id,
            version,
            json_schema,
            field_configs,
            schema_hash,
            openai_compatible,
            compatibility_errors,
            created_by
        )
        values ($1, 1, $2, $3, $4, $5, $6, $7)
        returning id, schema_hash`,
        [
            promptId,
            sourceSchema.json_schema,
            JSON.stringify(sourceSchema.field_configs),
            sourceSchema.schema_hash,
            sourceSchema.openai_compatible,
            JSON.stringify(sourceSchema.compatibility_errors),
            input.createdBy,
        ],
    );
    const schemaVersion = schemaResult.rows[0]!;

    const attemptResult = await db.query<IIdRow>(
        `insert into prompt_validation_attempts (
            team_id,
            project_id,
            prompt_id,
            schema_version_id,
            target_model_id,
            status,
            schema_hash,
            evidence,
            raw_output,
            parsed_output,
            latency_ms,
            created_by
        )
        values ($1, $2, $3, $4, $5, 'passed', $6, $7, $8, $9, $10, $11)
        returning id`,
        [
            input.teamId,
            input.projectId,
            promptId,
            schemaVersion.id,
            sourceAttempt.target_model_id,
            schemaVersion.schema_hash,
            sourceAttempt.evidence,
            sourceAttempt.raw_output,
            sourceAttempt.parsed_output,
            sourceAttempt.latency_ms,
            input.createdBy,
        ],
    );
    const validationAttemptId = attemptResult.rows[0]!.id;

    const versionResult = await db.query<IIdRow>(
        `insert into prompt_versions (
            prompt_id,
            version,
            content,
            schema_version_id,
            status,
            validation_attempt_id,
            reasoning_config,
            created_by
        )
        values ($1, 1, $2, $3, 'runnable', $4, $5, $6)
        returning id`,
        [
            promptId,
            sourceVersion.content,
            schemaVersion.id,
            validationAttemptId,
            sourceVersion.reasoning_config,
            input.createdBy,
        ],
    );

    await db.query(
        `insert into prompt_version_fit_tags (prompt_version_id, tag)
        values ($1, 'duplicated')
        on conflict do nothing`,
        [versionResult.rows[0]!.id],
    );

    return {
        sourcePromptVersionId: input.sourcePromptVersionId,
        promptId: promptId,
        promptVersionId: versionResult.rows[0]!.id,
    };
}

export async function recordPromptValidationAttemptPayload(
    db: IDb,
    input: IRecordPromptValidationAttemptRequest,
): Promise<void> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    await db.query(
        `insert into prompt_validation_attempts (
            team_id,
            project_id,
            prompt_id,
            schema_version_id,
            target_model_id,
            status,
            schema_hash,
            evidence,
            raw_output,
            parsed_output,
            error,
            latency_ms,
            created_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
            input.teamId,
            input.projectId,
            input.promptId ?? null,
            input.schemaVersionId ?? null,
            input.targetModelId,
            input.status,
            input.schemaHash ?? null,
            input.evidence ?? null,
            input.rawOutput ?? null,
            input.parsedOutput ?? null,
            input.error ?? null,
            input.latencyMs ?? null,
            input.createdBy,
        ],
    );
}

export async function saveRunnablePromptPayload(
    db: IDb,
    input: ISaveRunnablePromptRequest,
): Promise<ISaveRunnablePromptResponse> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    const promptId = input.promptId
        ? await updateOwnedEvalPrompt(db, input)
        : await createEvalPrompt(db, input);
    const schemaHashValue = schemaHash(input.jsonSchema);
    const schemaVersionNumber = await nextPromptSchemaVersion(db, promptId);
    const schemaVersion = await db.query<ISchemaInsertRow>(
        `insert into prompt_schema_versions (
            prompt_id,
            version,
            json_schema,
            field_configs,
            schema_hash,
            openai_compatible,
            compatibility_errors,
            created_by
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8)
        returning id, schema_hash`,
        [
            promptId,
            schemaVersionNumber,
            input.jsonSchema,
            JSON.stringify(input.fieldConfigs),
            schemaHashValue,
            evidenceOpenAiCompatible(input.validationEvidence),
            JSON.stringify(
                evidenceCompatibilityErrors(input.validationEvidence),
            ),
            input.createdBy,
        ],
    );
    const schemaVersionId = schemaVersion.rows[0]!.id;
    const attempt = await db.query<IIdRow>(
        `insert into prompt_validation_attempts (
            team_id,
            project_id,
            prompt_id,
            schema_version_id,
            target_model_id,
            status,
            schema_hash,
            evidence,
            created_by
        )
        values ($1, $2, $3, $4, $5, 'passed', $6, $7, $8)
        returning id`,
        [
            input.teamId,
            input.projectId,
            promptId,
            schemaVersionId,
            input.targetModelId,
            schemaHashValue,
            input.validationEvidence,
            input.createdBy,
        ],
    );
    const validationAttemptId = attempt.rows[0]!.id;
    const promptVersionNumber = await nextPromptVersion(db, promptId);
    const version = await db.query<IVersionInsertRow>(
        `insert into prompt_versions (
            prompt_id,
            version,
            content,
            schema_version_id,
            status,
            validation_attempt_id,
            optimizer_attempt_id,
            reasoning_config,
            created_by
        )
        values ($1, $2, $3, $4, 'runnable', $5, $6, $7, $8)
        returning id, version`,
        [
            promptId,
            promptVersionNumber,
            input.content,
            schemaVersionId,
            validationAttemptId,
            input.optimizerAttemptId ?? null,
            input.reasoningConfig ?? null,
            input.createdBy,
        ],
    );
    const promptVersion = version.rows[0]!;

    const tags = [...new Set(input.fitTags)].filter(Boolean);
    for (const tag of tags) {
        await db.query(
            `insert into prompt_version_fit_tags (prompt_version_id, tag)
            values ($1, $2)
            on conflict do nothing`,
            [promptVersion.id, tag],
        );
    }

    if (input.optimizerAttemptId) {
        const linkedAttempt = await db.query(
            `update prompt_optimization_attempts
            set prompt_id = $1, validation_attempt_id = $2
            where id = $3 and team_id = $4 and project_id = $5`,
            [
                promptId,
                validationAttemptId,
                input.optimizerAttemptId,
                input.teamId,
                input.projectId,
            ],
        );
        if (linkedAttempt.rowCount === 0) {
            throw new ApiNotFoundError("Optimizer attempt not found.");
        }
    }

    return {
        promptId,
        promptVersionId: promptVersion.id,
        promptVersion:
            typeof promptVersion.version === "number"
                ? promptVersion.version
                : Number(promptVersion.version),
        schemaVersionId,
    };
}

export async function optimizePromptPayload(
    db: IDb,
    config: IApiConfig,
    input: IOptimizePromptRequest,
): Promise<IOptimizePromptResponse> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    try {
        const result = await runPromptOptimizer(db, config, input);
        const attempt = await db.query<IIdRow>(
            `insert into prompt_optimization_attempts (
                team_id,
                project_id,
                target_model_id,
                optimizer_model_id,
                status,
                guidance_source,
                original_prompt,
                proposed_prompt,
                rationale,
                created_by
            )
            values ($1, $2, $3, $4, 'proposed', $5, $6, $7, $8, $9)
            returning id`,
            [
                input.teamId,
                input.projectId,
                input.targetModelId,
                input.optimizerModelId,
                result.guidanceSource,
                input.content,
                result.proposedPrompt,
                result.rationale,
                input.createdBy,
            ],
        );
        return {
            originalPrompt: input.content,
            optimizedPrompt: result.proposedPrompt,
            optimizationRationale: result.rationale,
            optimizationGuidanceSource: result.guidanceSource,
            optimizerModelId: input.optimizerModelId,
            optimizationTargetModelId: input.targetModelId,
            structuredOutputNotes: result.structuredOutputNotes,
            fitTags: result.fitTags,
            validationSummary: `Optimized by ${input.optimizerModelId} for ${input.targetModelId}.`,
            optimizerAttemptId: attempt.rows[0]!.id,
        };
    } catch (err) {
        await db.query(
            `insert into prompt_optimization_attempts (
                team_id,
                project_id,
                target_model_id,
                optimizer_model_id,
                status,
                original_prompt,
                error,
                created_by
            )
            values ($1, $2, $3, $4, 'failed', $5, $6, $7)`,
            [
                input.teamId,
                input.projectId,
                input.targetModelId,
                input.optimizerModelId,
                input.content,
                errorMessage(err),
                input.createdBy,
            ],
        );
        throw err;
    }
}

export async function generatePromptSchemaPayload(
    db: IDb,
    config: IApiConfig,
    input: IGeneratePromptSchemaRequest,
): Promise<IGeneratePromptSchemaResponse> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    try {
        const result = await runSchemaGenerator(db, config, input);
        await db.query(
            `insert into prompt_schema_generation_attempts (
                team_id,
                project_id,
                target_model_id,
                generator_model_id,
                status,
                openai_compatible,
                created_by
            )
            values ($1, $2, $3, $4, 'proposed', $5, $6)`,
            [
                input.teamId,
                input.projectId,
                input.targetModelId,
                input.generatorModelId,
                result.openaiCompatible,
                input.createdBy,
            ],
        );
        return result;
    } catch (err) {
        await db.query(
            `insert into prompt_schema_generation_attempts (
                team_id,
                project_id,
                target_model_id,
                generator_model_id,
                status,
                error,
                created_by
            )
            values ($1, $2, $3, $4, 'failed', $5, $6)`,
            [
                input.teamId,
                input.projectId,
                input.targetModelId,
                input.generatorModelId,
                errorMessage(err),
                input.createdBy,
            ],
        );
        throw err;
    }
}

export async function testJudgeDraftPayload(
    db: IDb,
    config: IApiConfig,
    input: ITestJudgeDraftRequest,
): Promise<ITestJudgeDraftResponse> {
    const verdict = await runJudgeDraft(db, config, input);
    if (!verdict.ok) throw new ApiBadRequestError(verdict.error);
    return { score: verdict.score, rationale: verdict.rationale };
}

export async function testPromptDraftPayload(
    db: IDb,
    config: IApiConfig,
    input: ITestPromptDraftRequest,
): Promise<ITestPromptDraftResponse> {
    return runPromptTest(db, config, input);
}

export async function validateRunnablePromptPayload(
    db: IDb,
    config: IApiConfig,
    input: IValidateRunnablePromptRequest,
): Promise<IValidateRunnablePromptResponse> {
    const validation = await validatePromptForRunnableVersion(
        db,
        config,
        input,
    );
    if (validation.passed) {
        return validation;
    }

    await recordPromptValidationAttemptPayload(db, {
        teamId: input.teamId,
        projectId: input.projectId,
        targetModelId: input.targetModelId,
        status: validation.evidence.sampleResults.some(
            (sample) => sample.status === "provider_error",
        )
            ? "provider_error"
            : "failed",
        schemaHash: schemaHash(input.jsonSchema),
        evidence: validation.evidence,
        createdBy: input.createdBy,
    });

    return {
        ...validation,
        failureMessage: firstValidationIssue(validation.evidence),
    };
}

export async function createJudgePromptPayload(
    db: IDb,
    input: ICreateJudgePromptRequest,
): Promise<{ promptId: string; promptVersionId: string }> {
    await assertProjectInTeam(db, input.teamId, input.projectId);
    // With a promptId, save a new version of that judge prompt rather than a
    // second prompt (a second save from /prompts/new sends the id it got back).
    const promptId = input.promptId
        ? await updateOwnedJudgePrompt(db, {
              ...input,
              promptId: input.promptId,
          })
        : await insertJudgePrompt(db, input);
    const versionNumber = input.promptId
        ? await nextPromptVersion(db, promptId)
        : 1;
    const version = await db.query<{ id: string }>(
        `insert into prompt_versions (
            prompt_id,
            version,
            content,
            status,
            judge_spec,
            reasoning_config,
            created_by
        )
        values ($1, $2, $3, 'runnable', $4, $5, $6)
        returning id`,
        [
            promptId,
            versionNumber,
            input.rubricPrompt,
            input.judgeSpec ?? {
                modelId: input.modelId,
                declaredInputs: ["task_input", "candidate_output", "reference"],
            },
            input.reasoningConfig ?? null,
            input.createdBy,
        ],
    );
    return { promptId, promptVersionId: version.rows[0]!.id };
}

async function insertJudgePrompt(
    db: IDb,
    input: ICreateJudgePromptRequest,
): Promise<string> {
    const prompt = await db.query<{ id: string }>(
        `insert into prompts (team_id, project_id, name, kind, target_model_id)
        values ($1, $2, $3, 'judge', $4)
        returning id`,
        [input.teamId, input.projectId, input.name, input.modelId],
    );
    return prompt.rows[0]!.id;
}

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function updateOwnedJudgePrompt(
    db: IDb,
    input: ICreateJudgePromptRequest & { promptId: string },
): Promise<string> {
    // A malformed id can't match a prompt; answer 404 rather than letting
    // Postgres reject the uuid cast as a 500.
    if (!UUID_PATTERN.test(input.promptId)) {
        throw new ApiNotFoundError("Prompt not found.");
    }
    const prompt = await db.query<IPromptOwnershipRow>(
        `select id, team_id, kind
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.promptId, input.teamId, input.projectId],
    );
    const row = prompt.rows[0];
    if (!row) throw new ApiNotFoundError("Prompt not found.");
    if (row.kind !== "judge") {
        throw new ApiBadRequestError(
            "Only judge prompts can save judge versions.",
        );
    }
    await db.query(
        `update prompts
        set name = $1, target_model_id = $2
        where id = $3 and team_id = $4 and project_id = $5`,
        [input.name, input.modelId, row.id, input.teamId, input.projectId],
    );
    return row.id;
}

async function promptWorkbenchInitialPrompt(
    db: IDb,
    teamId: string,
    projectId: string,
    promptId: string,
): Promise<IPromptWorkbenchSetupResponse["initialPrompt"]> {
    const promptResult = await db.query<IPromptWorkbenchPromptRow>(
        `select id, name, description, kind, target_model_id
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [promptId, teamId, projectId],
    );
    const prompt = promptResult.rows[0];
    if (!prompt) throw new ApiNotFoundError();

    const versionResult = await db.query<IPromptWorkbenchVersionRow>(
        `select id, content, schema_version_id, reasoning_config
        from prompt_versions
        where prompt_id = $1
        order by version desc
        limit 1`,
        [prompt.id],
    );
    const version = versionResult.rows[0];
    const [schemaVersion, fitTags] = await Promise.all([
        version?.schema_version_id
            ? getPromptDetailSchema(db, version.schema_version_id)
            : undefined,
        version ? listPromptVersionFitTagsPayload(db, version.id) : [],
    ]);

    return {
        promptId: prompt.id,
        name: prompt.name,
        description: prompt.description ?? "",
        kind: prompt.kind,
        content: version?.content ?? "",
        jsonSchema: schemaVersion
            ? JSON.stringify(schemaVersion.jsonSchema, null, 4)
            : "",
        targetModelId: prompt.target_model_id ?? undefined,
        reasoningEffort: version?.reasoning_config?.effort,
        fitTags,
    };
}

async function listTeamFitTagsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    limit = 200,
): Promise<string[]> {
    const result = await db.query<IFitTagRow>(
        `select distinct pvt.tag
        from prompt_version_fit_tags pvt
        inner join prompt_versions pv on pvt.prompt_version_id = pv.id
        inner join prompts p on pv.prompt_id = p.id
        where p.team_id = $1 and p.project_id = $2
        limit $3`,
        [teamId, projectId, limit],
    );
    return result.rows.map((row) => row.tag).sort((a, b) => a.localeCompare(b));
}

async function listPromptVersionFitTagsPayload(
    db: IDb,
    promptVersionId: string,
): Promise<string[]> {
    const result = await db.query<IFitTagRow>(
        `select tag
        from prompt_version_fit_tags
        where prompt_version_id = $1`,
        [promptVersionId],
    );
    return result.rows.map((row) => row.tag);
}

async function createEvalPrompt(
    db: IDb,
    input: ISaveRunnablePromptRequest,
): Promise<string> {
    const result = await db.query<IIdRow>(
        `insert into prompts (
            team_id,
            project_id,
            name,
            kind,
            target_model_id,
            description
        )
        values ($1, $2, $3, 'eval', $4, $5)
        returning id`,
        [
            input.teamId,
            input.projectId,
            input.name,
            input.targetModelId,
            input.description ?? null,
        ],
    );
    return result.rows[0]!.id;
}

async function updateOwnedEvalPrompt(
    db: IDb,
    input: ISaveRunnablePromptRequest,
): Promise<string> {
    const prompt = await db.query<IPromptOwnershipRow>(
        `select id, team_id, kind
        from prompts
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [input.promptId, input.teamId, input.projectId],
    );
    const row = prompt.rows[0];
    if (!row) throw new ApiNotFoundError("Prompt not found.");
    if (row.kind !== "eval") {
        throw new ApiBadRequestError(
            "Only eval prompts can save structured versions.",
        );
    }
    await db.query(
        `update prompts
        set
            name = $1,
            target_model_id = $2,
            description = $3
        where id = $4 and team_id = $5 and project_id = $6`,
        [
            input.name,
            input.targetModelId,
            input.description ?? null,
            row.id,
            input.teamId,
            input.projectId,
        ],
    );
    return row.id;
}

async function nextPromptSchemaVersion(
    db: IDb,
    promptId: string,
): Promise<number> {
    const result = await db.query<{ version: number | string | null }>(
        `select max(version)::int as version
        from prompt_schema_versions
        where prompt_id = $1`,
        [promptId],
    );
    return Number(result.rows[0]?.version ?? 0) + 1;
}

async function nextPromptVersion(db: IDb, promptId: string): Promise<number> {
    const result = await db.query<{ version: number | string | null }>(
        `select max(version)::int as version
        from prompt_versions
        where prompt_id = $1`,
        [promptId],
    );
    return Number(result.rows[0]?.version ?? 0) + 1;
}

function schemaHash(schema: unknown): string {
    return createHash("sha256").update(stableStringify(schema)).digest("hex");
}

function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        return `{${Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(
                ([key, nested]) =>
                    `${JSON.stringify(key)}:${stableStringify(nested)}`,
            )
            .join(",")}}`;
    }
    return JSON.stringify(value);
}

function evidenceOpenAiCompatible(evidence: unknown): boolean {
    return (
        isRecord(evidence) &&
        isRecord(evidence.schemaValidation) &&
        evidence.schemaValidation.openaiCompatible === true
    );
}

function evidenceCompatibilityErrors(evidence: unknown): unknown {
    return isRecord(evidence) &&
        isRecord(evidence.schemaValidation) &&
        Array.isArray(evidence.schemaValidation.errors)
        ? evidence.schemaValidation.errors
        : [];
}

interface IOptimizerResult {
    proposedPrompt: string;
    rationale: string;
    fitTags: string[];
    structuredOutputNotes: string[];
    guidanceSource: IOptimizePromptResponse["optimizationGuidanceSource"];
}

const OPTIMIZER_OUTPUT_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: [
        "proposedPrompt",
        "rationale",
        "fitTags",
        "structuredOutputNotes",
    ],
    properties: {
        proposedPrompt: { type: "string" },
        rationale: { type: "string" },
        fitTags: { type: "array", items: { type: "string" } },
        structuredOutputNotes: { type: "array", items: { type: "string" } },
    },
};

async function runPromptOptimizer(
    db: IDb,
    config: IApiConfig,
    input: IOptimizePromptRequest,
): Promise<IOptimizerResult> {
    const provider = await evalProvider(db, config, input.teamId);
    const guidance = guidanceForModel(input.targetModelId);
    const result = await provider.complete({
        model: input.optimizerModelId,
        system: "You optimize prompts for non-technical product managers. Preserve the task intent, remove ambiguity, and make structured JSON output mandatory. Keep every field concise.",
        prompt: [
            guidance.text,
            "",
            `Target model: ${input.targetModelId}`,
            "JSON Schema:",
            JSON.stringify(input.jsonSchema, null, 2),
            "",
            "Original prompt:",
            input.content,
            "",
            "Return JSON for the optimizer result only.",
            "Constraints:",
            "- proposedPrompt: no more than 180 words.",
            "- proposedPrompt must be model-agnostic.",
            "- rationale: one sentence.",
            "- fitTags: 2 to 4 short tags.",
            "- structuredOutputNotes: 2 short notes.",
        ].join("\n"),
        responseSchema: {
            name: "prompt_optimization",
            schema: OPTIMIZER_OUTPUT_SCHEMA,
        },
        maxTokens: registryEntryFor(input.optimizerModelId)?.reasoning
            ? 3200
            : 1200,
        reasoningEffort: resolveReasoningEffort(input.optimizerModelId, "low"),
    });
    const parsed = result.parsed;
    if (!isRecord(parsed)) {
        throw new ApiBadRequestError(
            "Prompt optimizer response is missing required fields.",
        );
    }
    return {
        proposedPrompt: stringField(parsed, "proposedPrompt"),
        rationale: stringField(parsed, "rationale"),
        fitTags: stringArrayField(parsed, "fitTags"),
        structuredOutputNotes: stringArrayField(
            parsed,
            "structuredOutputNotes",
        ),
        guidanceSource: guidance.source,
    };
}

async function runSchemaGenerator(
    db: IDb,
    config: IApiConfig,
    input: IGeneratePromptSchemaRequest,
): Promise<IGeneratePromptSchemaResponse> {
    const provider = await evalProvider(db, config, input.teamId);
    const reasoning =
        registryEntryFor(input.generatorModelId)?.reasoning ?? false;
    const result = await provider.complete({
        model: input.generatorModelId,
        system: "You design strict JSON Schemas for OpenAI structured outputs. Return only the JSON Schema object — no prose, no Markdown fences.",
        prompt: [
            "Produce a JSON Schema describing the JSON object the following prompt asks the model to return.",
            "Requirements:",
            '- The root must be {"type": "object"}.',
            '- Set "additionalProperties": false on every object.',
            '- List every property key in that object\'s "required" array.',
            "- Do not use $ref, $defs, a root anyOf, if/then/else, not, or format keywords.",
            "- Omit $schema. Flash Evals validates the generated schema with JSON Schema 2020-12.",
            "",
            "Prompt:",
            input.content,
            "",
            "Return the JSON Schema object only.",
        ].join("\n"),
        maxTokens: reasoning ? 2000 : 1200,
        reasoningEffort: resolveReasoningEffort(input.generatorModelId, "low"),
    });
    const parsed = parseStrictJsonOnly(result.text);
    if (!parsed.ok || !isRecord(parsed.value)) {
        throw new ApiBadRequestError(
            "The schema generator did not return a JSON object. Try again.",
        );
    }
    const schema = normalizeGeneratedSchema(parsed.value);
    const errors = schemaCompatibilityErrors(schema);
    return {
        schema,
        openaiCompatible: errors.length === 0,
        compatibilityErrors: errors,
    };
}

async function runJudgeDraft(
    db: IDb,
    config: IApiConfig,
    input: ITestJudgeDraftRequest,
): Promise<
    | { ok: true; score: number; rationale: string }
    | { ok: false; error: string }
> {
    const transportModel = await resolveTransportModel(
        db,
        config,
        input.teamId,
        input.targetModelId,
        input.transport,
    );
    const provider = await evalProvider(
        db,
        config,
        input.teamId,
        input.transport,
        transportModel.id,
    );
    const declared = new Set(input.declaredInputs);
    const sections = [input.content, ""];
    if (declared.has("task_input") && input.taskInput) {
        sections.push(`# Input\n<input>\n${input.taskInput}\n</input>`);
    }
    if (declared.has("candidate_output")) {
        sections.push(
            `# Model output\n<candidate_output>\n${formatJudgeSectionValue(input.candidateOutput)}\n</candidate_output>`,
        );
    }
    if (declared.has("reference") && input.reference !== undefined) {
        sections.push(
            `# gpt-4o reference output\n<reference>\n${formatJudgeSectionValue(input.reference)}\n</reference>`,
        );
    }
    try {
        const result = await provider.complete({
            model: getBareModelName(input.targetModelId),
            system: "You are a strict evaluator. Score each rubric criterion independently, then give an overall 0-1 score. Return JSON.",
            prompt: sections.join("\n\n"),
            responseSchema: {
                name: "judge_verdict",
                schema: JUDGE_SCHEMA,
            },
            maxTokens: 4000,
            reasoningEffort: input.reasoningEffort,
        });
        if (result.schemaViolation || !isRecord(result.parsed)) {
            return {
                ok: false,
                error: "Judge returned unparseable or truncated output",
            };
        }
        const score = Number(result.parsed.score);
        if (Number.isNaN(score))
            return { ok: false, error: "Judge score was not a number" };
        return {
            ok: true,
            score: Math.min(1, Math.max(0, score)),
            rationale: summarizeCriteria(result.parsed.criteria),
        };
    } catch (err) {
        return { ok: false, error: errorMessage(err) };
    }
}

async function runPromptTest(
    db: IDb,
    config: IApiConfig,
    input: ITestPromptDraftRequest,
): Promise<IPromptTestRunResponse> {
    const samples =
        input.samples.length > 0
            ? input.samples
            : [{ name: "Single input", inputText: "" }];
    const resolvedEffort = resolveReasoningEffort(
        input.targetModelId,
        input.reasoningEffort,
    );
    const transportModel = await resolveTransportModel(
        db,
        config,
        input.teamId,
        input.targetModelId,
        input.transport,
    );
    let provider: IEvalCompletionProvider | undefined;
    const results: IPromptTestRunResponse["results"] = [];

    for (const sample of samples) {
        const prompt = promptForSample(input.prompt, sample);
        const startedAt = performance.now();
        try {
            const activeProvider = (provider ??= await evalProvider(
                db,
                config,
                input.teamId,
                input.transport,
                transportModel.id,
            ));
            const completion = await withTimeout(
                (signal) =>
                    activeProvider.complete({
                        model: getBareModelName(input.targetModelId),
                        prompt,
                        images: input.image ? [input.image] : undefined,
                        responseSchema: {
                            name: "prompt_output",
                            schema: input.jsonSchema,
                        },
                        maxTokens: DEFAULT_PROMPT_TEST_MAX_TOKENS,
                        reasoningEffort: resolvedEffort,
                        signal,
                    }),
                input.timeoutMs,
            );
            const latencyMs =
                completion.latencyMs ?? performance.now() - startedAt;
            const parsed = parseStrictJsonOnlyWithIssue(completion.text);
            if (!parsed.ok) {
                results.push({
                    sampleName: sample.name,
                    inputText: sample.inputText ?? "",
                    status: "failed_validation",
                    rawOutput: completion.text,
                    validation: { valid: false, errors: [parsed.error] },
                    usage: completion.usage,
                    latencyMs,
                    ...promptTestCost(
                        input.targetModelId,
                        completion.usage,
                        transportModel.pricing,
                    ),
                });
                continue;
            }

            const schemaResult = validateDataAgainstSchema(
                input.jsonSchema,
                parsed.value,
            );
            results.push({
                sampleName: sample.name,
                inputText: sample.inputText ?? "",
                status: schemaResult.ok ? "success" : "failed_validation",
                rawOutput: completion.text,
                parsedOutput: parsed.value,
                validation: {
                    valid: schemaResult.ok,
                    errors: schemaResult.ok ? [] : schemaResult.errors,
                },
                usage: completion.usage,
                latencyMs,
                ...promptTestCost(
                    input.targetModelId,
                    completion.usage,
                    transportModel.pricing,
                ),
            });
        } catch (err) {
            results.push(
                errorPromptTestResult(
                    sample,
                    err,
                    performance.now() - startedAt,
                ),
            );
        }
    }

    return {
        status: aggregatePromptTestStatus(results),
        targetModelId: input.targetModelId,
        ...(resolvedEffort ? { reasoningEffort: resolvedEffort } : {}),
        results,
    };
}

async function validatePromptForRunnableVersion(
    db: IDb,
    config: IApiConfig,
    input: IValidateRunnablePromptRequest,
): Promise<{ passed: boolean; evidence: IPromptValidationEvidence }> {
    const staticChecks = staticPromptChecks(input.prompt);
    const schemaValidation = validatePromptSchema(input.jsonSchema);
    const sampleResults: IPromptValidationEvidence["sampleResults"] = [];

    if (
        staticChecks.some(
            (check) => check.code === "prompt_conflicting_json",
        ) ||
        !schemaValidation.localValid ||
        !schemaValidation.openaiCompatible
    ) {
        return {
            passed: false,
            evidence: { staticChecks, schemaValidation, sampleResults },
        };
    }

    const transportModel = await resolveTransportModel(
        db,
        config,
        input.teamId,
        input.targetModelId,
        input.transport,
    );
    let provider: IEvalCompletionProvider | undefined;
    const samples =
        input.samples.length > 0
            ? input.samples
            : [{ name: "Single input", inputText: "" }];
    for (const sample of samples) {
        try {
            provider ??= await evalProvider(
                db,
                config,
                input.teamId,
                input.transport,
                transportModel.id,
            );
            const result = await runPromptValidationSample(provider, {
                prompt: input.prompt,
                sample,
                schema: input.jsonSchema,
                targetModelId: input.targetModelId,
                reasoningEffort: input.reasoningEffort,
            });
            const parsed = parseStrictJsonOnlyWithIssue(result.text);
            if (!parsed.ok) {
                sampleResults.push({
                    sampleName: sample.name,
                    status: "failed",
                    rawOutput: result.text,
                    errors: [parsed.error],
                });
                continue;
            }

            const schemaResult = validateDataAgainstSchema(
                input.jsonSchema,
                parsed.value,
            );
            sampleResults.push({
                sampleName: sample.name,
                status: schemaResult.ok ? "passed" : "failed",
                rawOutput: result.text,
                parsedOutput: parsed.value,
                errors: schemaResult.ok ? [] : schemaResult.errors,
            });
        } catch (err) {
            sampleResults.push({
                sampleName: sample.name,
                status: "provider_error",
                errors: [
                    {
                        path: "$",
                        code: "provider_error",
                        message: errorMessage(err),
                    },
                ],
            });
        }
    }

    return {
        passed: sampleResults.every((sample) => sample.status === "passed"),
        evidence: { staticChecks, schemaValidation, sampleResults },
    };
}

async function runPromptValidationSample(
    provider: IEvalCompletionProvider,
    input: {
        prompt: string;
        sample: IPromptSampleInput;
        schema: IJsonSchemaObject;
        targetModelId: string;
        reasoningEffort?: ReasoningEffort;
    },
): Promise<{ text: string; latencyMs?: number }> {
    const result = await provider.complete({
        model: getBareModelName(input.targetModelId),
        prompt: promptForSample(input.prompt, input.sample),
        responseSchema: { name: "prompt_output", schema: input.schema },
        maxTokens: DEFAULT_PROMPT_TEST_MAX_TOKENS,
        reasoningEffort: input.reasoningEffort,
    });
    return { text: result.text, latencyMs: result.latencyMs };
}

function promptTestCost(
    modelId: string,
    usage: UsageData,
    livePricing?: IModelPricing,
): {
    costUsd?: number;
    costSource: "computed" | "unavailable";
} {
    const pricing = livePricing ?? registryEntryFor(modelId)?.pricing;
    const costUsd = pricing
        ? computeCostFromUsageWithPricing(usage, pricing)
        : undefined;
    return costUsd === undefined
        ? { costSource: "unavailable" }
        : { costUsd, costSource: "computed" };
}

function promptForSample(prompt: string, sample: IPromptSampleInput): string {
    return sample.inputText
        ? `${prompt}\n\nSample input:\n<input>\n${sample.inputText}\n</input>`
        : prompt;
}

function validatePromptSchema(schema: unknown) {
    const errors: ISchemaCompatibilityIssue[] = [];

    if (!isRecord(schema)) {
        return {
            localValid: false,
            openaiCompatible: false,
            errors: [
                {
                    path: "$",
                    code: "schema_type",
                    message: "Schema must be a JSON object.",
                },
            ],
        };
    }

    let validator: ValidateFunction | undefined;
    try {
        validator = ajv.compile(schema);
    } catch (err) {
        errors.push({
            path: "$",
            code: "schema_compile",
            message: errorMessage(err),
        });
    }

    const localValid = errors.length === 0 && Boolean(validator);
    errors.push(...openAiCompatibilityIssues(schema));

    return {
        localValid,
        openaiCompatible: localValid && errors.length === 0,
        errors,
    };
}

function validateDataAgainstSchema(
    schema: IJsonSchemaObject,
    data: unknown,
): { ok: true } | { ok: false; errors: ISchemaCompatibilityIssue[] } {
    let validator: ValidateFunction;
    try {
        validator = ajv.compile(schema);
    } catch (err) {
        return {
            ok: false,
            errors: [
                {
                    path: "$",
                    code: "schema_compile",
                    message: errorMessage(err),
                },
            ],
        };
    }

    if (validator(data)) return { ok: true };
    return {
        ok: false,
        errors: formatAjvErrors(validator.errors ?? []),
    };
}

function staticPromptChecks(prompt: string): ISchemaCompatibilityIssue[] {
    const checks: ISchemaCompatibilityIssue[] = [];
    const normalized = prompt.toLowerCase();
    const positiveOutputInstructions = normalized.replace(
        /\b(do not|don't|never) include markdown\b/g,
        "",
    );

    if (!/\bjson\b/.test(normalized)) {
        checks.push({
            path: "$",
            code: "prompt_missing_json_instruction",
            message:
                "Prompt should explicitly instruct the model to return JSON.",
        });
    }

    if (
        /\bthen explain\b/.test(positiveOutputInstructions) ||
        /\bexplain (below|after)\b/.test(positiveOutputInstructions) ||
        /\b(use|include|return|respond in|format as) markdown\b/.test(
            positiveOutputInstructions,
        )
    ) {
        checks.push({
            path: "$",
            code: "prompt_conflicting_json",
            message:
                "Prompt asks for prose, Markdown, or explanation outside the JSON output.",
        });
    }

    return checks;
}

function parseStrictJsonOnlyWithIssue(
    text: string,
):
    | { ok: true; value: unknown }
    | { ok: false; error: ISchemaCompatibilityIssue } {
    const trimmed = text.trim();
    if (!trimmed) {
        return {
            ok: false,
            error: {
                path: "$",
                code: "invalid_json",
                message: "Model returned an empty response instead of JSON.",
            },
        };
    }

    if (/^```/.test(trimmed) || /```$/.test(trimmed)) {
        return {
            ok: false,
            error: {
                path: "$",
                code: "json_wrapper",
                message:
                    "Model returned JSON inside a Markdown code fence; output must be only the JSON object.",
            },
        };
    }

    try {
        const parsed = JSON.parse(trimmed) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                ok: false,
                error: {
                    path: "$",
                    code: "invalid_json_object",
                    message: "Model output must be a JSON object.",
                },
            };
        }
        return { ok: true, value: parsed };
    } catch {
        return {
            ok: false,
            error: {
                path: "$",
                code: "invalid_json",
                message: "Model output was not valid JSON.",
            },
        };
    }
}

function openAiCompatibilityIssues(schema: Record<string, unknown>) {
    const issues: ISchemaCompatibilityIssue[] = [];

    if (schema.type !== "object") {
        issues.push({
            path: "$",
            code: "openai_root_object",
            message:
                'OpenAI Structured Outputs require the root schema to have type "object".',
        });
    }
    if (hasOwn(schema, "anyOf")) {
        issues.push({
            path: "$",
            code: "openai_root_anyof",
            message:
                "OpenAI Structured Outputs do not support a root anyOf schema.",
        });
    }

    visitSchema(schema, "$", issues);
    return issues;
}

function visitSchema(
    schema: Record<string, unknown>,
    path: string,
    issues: ISchemaCompatibilityIssue[],
) {
    for (const key of Object.keys(schema)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
            issues.push({
                path,
                code: "reserved_key",
                message: `Schema key "${key}" is reserved and cannot be used.`,
            });
        }
        if (OPENAI_UNSUPPORTED_KEYS.has(key)) {
            issues.push({
                path,
                code: "openai_unsupported_keyword",
                message: `OpenAI Structured Outputs do not support "${key}" in this schema.`,
            });
        }
    }

    const type = schema.type;
    const isObject =
        type === "object" || (Array.isArray(type) && type.includes("object"));

    if (isObject) {
        if (schema.additionalProperties !== false) {
            issues.push({
                path,
                code: "openai_additional_properties",
                message:
                    "OpenAI Structured Outputs require object schemas to set additionalProperties to false.",
            });
        }
        if (isRecord(schema.properties)) {
            const propertyNames = Object.keys(schema.properties);
            const required = Array.isArray(schema.required)
                ? schema.required.filter(
                      (field): field is string => typeof field === "string",
                  )
                : [];
            const requiredSet = new Set(required);
            for (const property of propertyNames) {
                if (!requiredSet.has(property)) {
                    issues.push({
                        path: `${path}.${property}`,
                        code: "openai_required_property",
                        message:
                            "OpenAI Structured Outputs require every object property to be listed in required. Use a nullable union to model optional values.",
                    });
                }
            }
        }
    }

    if (isRecord(schema.properties)) {
        for (const [property, value] of Object.entries(schema.properties)) {
            if (PROTOTYPE_POLLUTION_KEYS.has(property)) {
                issues.push({
                    path: `${path}.${property}`,
                    code: "reserved_key",
                    message: `Schema property "${property}" is reserved and cannot be used.`,
                });
            }
            if (isRecord(value))
                visitSchema(value, `${path}.${property}`, issues);
        }
    }

    const items = schema.items;
    if (isRecord(items)) visitSchema(items, `${path}[]`, issues);
    if (Array.isArray(items)) {
        items.forEach((item, idx) => {
            if (isRecord(item)) visitSchema(item, `${path}[${idx}]`, issues);
        });
    }
    for (const keyword of ["anyOf", "oneOf", "allOf"] as const) {
        const variants = schema[keyword];
        if (Array.isArray(variants)) {
            variants.forEach((variant, idx) => {
                if (isRecord(variant)) {
                    visitSchema(variant, `${path}.${keyword}[${idx}]`, issues);
                }
            });
        }
    }
}

function formatAjvErrors(errors: ErrorObject[]): ISchemaCompatibilityIssue[] {
    return errors.map((error) => ({
        path: error.instancePath
            ? `$.${error.instancePath.slice(1).replace(/\//g, ".")}`
            : "$",
        code: error.keyword,
        message: error.message ?? "Schema validation failed.",
    }));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value, key);
}

function aggregatePromptTestStatus(
    results: IPromptTestRunResponse["results"],
): IPromptTestRunResponse["status"] {
    if (results.every((result) => result.status === "success"))
        return "success";
    if (results.some((result) => result.status === "success")) return "partial";
    return "failed";
}

async function withTimeout<T>(
    run: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number | undefined,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();

        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            fn();
        };

        if (timeoutMs) {
            timer = setTimeout(() => {
                controller.abort();
                settle(() => reject(timeoutError()));
            }, timeoutMs);
        }

        let promise: Promise<T>;
        try {
            promise = run(controller.signal);
        } catch (err) {
            settle(() => reject(err));
            return;
        }
        promise.then(
            (value) => settle(() => resolve(value)),
            (err: unknown) => settle(() => reject(err)),
        );
    });
}

function timeoutError(): Error {
    return Object.assign(new Error("Timed out"), { name: "TimeoutError" });
}

function errorPromptTestResult(
    sample: IPromptSampleInput,
    err: unknown,
    latencyMs: number,
): IPromptTestRunResponse["results"][number] {
    const name = err instanceof Error ? err.name : "";
    const status = name === "TimeoutError" ? "timeout" : "provider_error";
    return {
        sampleName: sample.name,
        inputText: sample.inputText ?? "",
        status,
        validation: { valid: false, errors: [] },
        latencyMs,
        costSource: "unavailable",
        error: errorMessage(err),
    };
}

function firstValidationIssue(
    evidence: IPromptValidationEvidence,
): string | undefined {
    return (
        evidence.sampleResults[0]?.errors[0]?.message ??
        evidence.schemaValidation.errors[0]?.message ??
        evidence.staticChecks[0]?.message
    );
}

const JUDGE_SCHEMA = {
    type: "object",
    additionalProperties: false,
    required: ["criteria", "score"],
    properties: {
        criteria: {
            type: "array",
            items: {
                type: "object",
                additionalProperties: false,
                required: ["name", "reasoning", "score"],
                properties: {
                    name: { type: "string" },
                    reasoning: { type: "string" },
                    score: { type: "number" },
                },
            },
        },
        score: { type: "number" },
    },
};

async function evalProvider(
    db: IDb,
    config: IApiConfig,
    teamId?: string,
    transport?: ProviderTransport,
    exactTransportModelId?: string,
): Promise<IEvalCompletionProvider> {
    const resolved = await resolveApiKeys(db, config, teamId);
    return getEvalProvider(resolved.apiKeys, {
        provider: config.mosaicLlmProvider,
        ...teamBaseUrlProviderOptions(resolved),
        ...(transport ? { transport } : {}),
        ...(exactTransportModelId ? { exactTransportModelId } : {}),
    });
}

async function resolveTransportModel(
    db: IDb,
    config: IApiConfig,
    teamId: string | undefined,
    modelId: string,
    transport: ProviderTransport | undefined,
): Promise<{ id?: string; pricing?: IModelPricing }> {
    if (!transport) return {};
    const registered = registryEntryFor(modelId);
    const registeredModelId = registered?.transports[transport];
    if (registeredModelId) {
        return {
            id: registeredModelId,
            ...(registered?.pricing ? { pricing: registered.pricing } : {}),
        };
    }

    // Gateway exposes newly added provider models dynamically. The catalog can
    // therefore contain a model before Flash Evals has a static registry entry for
    // it. Verify that exact live model id instead of rejecting the selection.
    if (transport === "gateway") {
        const { apiKeys } = await resolveApiKeys(db, config, teamId);
        const liveModels = await listAvailableModelMetadata(apiKeys, {
            provider: "gateway",
        });
        const liveModel = liveModels.find(
            (model) =>
                registryEntryForLiveGatewayModel(model.id, model.pricing)
                    ?.id === modelId,
        );
        if (liveModel) {
            const entry = registryEntryForLiveGatewayModel(
                liveModel.id,
                liveModel.pricing,
            );
            return {
                id: liveModel.id,
                ...(entry?.pricing ? { pricing: entry.pricing } : {}),
            };
        }
    }

    throw new ApiBadRequestError(
        `Model "${modelId}" does not support the "${transport}" transport.`,
    );
}

function resolveReasoningEffort(
    modelId: string,
    requested?: ReasoningEffort,
): ReasoningEffort | undefined {
    const capability = registryEntryFor(modelId)?.reasoningEffort;
    if (!capability) return undefined;
    if (requested && capability.supportedLevels.includes(requested))
        return requested;
    return capability.defaultLevel;
}

function stringField(record: Record<string, unknown>, key: string): string {
    const value = record[key];
    if (typeof value !== "string" || !value.trim()) {
        throw new ApiBadRequestError(
            "Prompt optimizer response is missing required fields.",
        );
    }
    return value;
}

function stringArrayField(
    record: Record<string, unknown>,
    key: string,
): string[] {
    const value = record[key];
    if (
        !Array.isArray(value) ||
        !value.every((item) => typeof item === "string")
    ) {
        throw new ApiBadRequestError(
            "Prompt optimizer response is missing required fields.",
        );
    }
    return value;
}

function parseStrictJsonOnly(
    text: string,
): { ok: true; value: unknown } | { ok: false } {
    const trimmed = text.trim();
    if (!trimmed || /^```/.test(trimmed) || /```$/.test(trimmed)) {
        return { ok: false };
    }
    try {
        const parsed = JSON.parse(trimmed) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? { ok: true, value: parsed }
            : { ok: false };
    } catch {
        return { ok: false };
    }
}

function normalizeGeneratedSchema(
    schema: Record<string, unknown>,
): Record<string, unknown> {
    const normalized = normalizeSchemaNode(schema) as Record<string, unknown>;
    // Generated schemas use our supported subset and the validator's dialect.
    // Models sometimes add a Draft 7 declaration that Ajv2020 cannot resolve.
    delete normalized.$schema;
    return normalized;
}

function normalizeSchemaNode(schema: unknown): unknown {
    if (Array.isArray(schema)) return schema.map(normalizeSchemaNode);
    if (!isRecord(schema)) return schema;
    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
        normalized[key] = normalizeSchemaNode(value);
    }
    const type = normalized.type;
    const isObject =
        type === "object" || (Array.isArray(type) && type.includes("object"));
    if (isObject) {
        normalized.additionalProperties = false;
        if (isRecord(normalized.properties)) {
            normalized.required = Object.keys(normalized.properties);
        }
    }
    return normalized;
}

function schemaCompatibilityErrors(schema: Record<string, unknown>) {
    const errors: Array<{ path: string; code: string; message: string }> = [];
    if (schema.type !== "object") {
        errors.push({
            path: "$",
            code: "schema_root_type",
            message: 'Schema root must have type "object".',
        });
    }
    collectUnsupportedSchemaKeys(schema, "$", errors);
    return errors;
}

const UNSUPPORTED_SCHEMA_KEYS = new Set([
    "$ref",
    "$defs",
    "definitions",
    "anyOf",
    "oneOf",
    "allOf",
    "not",
    "if",
    "then",
    "else",
    "format",
]);

function collectUnsupportedSchemaKeys(
    value: unknown,
    path: string,
    errors: Array<{ path: string; code: string; message: string }>,
): void {
    if (Array.isArray(value)) {
        value.forEach((item, index) =>
            collectUnsupportedSchemaKeys(item, `${path}[${index}]`, errors),
        );
        return;
    }
    if (!isRecord(value)) return;
    for (const [key, nested] of Object.entries(value)) {
        if (UNSUPPORTED_SCHEMA_KEYS.has(key)) {
            errors.push({
                path,
                code: "schema_openai_unsupported",
                message: `Schema uses unsupported keyword "${key}".`,
            });
        }
        collectUnsupportedSchemaKeys(nested, `${path}.${key}`, errors);
    }
}

function summarizeCriteria(value: unknown): string {
    if (!Array.isArray(value)) return "";
    return value
        .map((entry) => {
            if (!isRecord(entry)) return "";
            const name =
                typeof entry.name === "string" ? entry.name : "criterion";
            const reasoning =
                typeof entry.reasoning === "string" ? entry.reasoning : "";
            return `${name}: ${reasoning}`.trim();
        })
        .filter(Boolean)
        .join("\n");
}

function formatJudgeSectionValue(value: unknown): string {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function errorMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function listPromptDetailVersions(
    db: IDb,
    promptId: string,
): Promise<IPromptDetailVersion[]> {
    const result = await db.query<IPromptVersionRow>(
        `select
            id,
            version,
            status,
            content,
            created_at,
            schema_version_id,
            optimizer_attempt_id
        from prompt_versions
        where prompt_id = $1
        order by version desc`,
        [promptId],
    );

    return result.rows.map((row) => ({
        id: row.id,
        version:
            typeof row.version === "number" ? row.version : Number(row.version),
        status: row.status,
        content: row.content,
        createdAt:
            row.created_at instanceof Date
                ? row.created_at.toISOString()
                : new Date(row.created_at).toISOString(),
        schemaVersionId: row.schema_version_id,
        optimizerAttemptId: row.optimizer_attempt_id,
    }));
}

async function getPromptDetailSchema(
    db: IDb,
    schemaVersionId: string,
): Promise<IPromptDetailResponse["schemaVersion"] | undefined> {
    const result = await db.query<ISchemaVersionRow>(
        `select json_schema
        from prompt_schema_versions
        where id = $1
        limit 1`,
        [schemaVersionId],
    );
    const row = result.rows[0];
    return row ? { jsonSchema: row.json_schema } : undefined;
}
