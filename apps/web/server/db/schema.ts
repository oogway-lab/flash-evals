import { sql } from "drizzle-orm";
import type { ProviderMetadata } from "@mosaic/llm-core";
import type {
    ISttRunConfig,
    IWorkflowLlmActualRoute,
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmExecutionProvenance,
    IWorkflowLlmRouteConfig,
    IWorkflowLlmRouteIdentity,
    WorkflowLlmTransport,
    IWorkflowNodeArtifact,
} from "@mosaic/api-contract";
import {
    pgTable,
    pgEnum,
    uuid,
    text,
    integer,
    doublePrecision,
    jsonb,
    boolean,
    timestamp,
    unique,
    uniqueIndex,
    index,
    check,
    foreignKey,
    type AnyPgColumn,
    primaryKey,
} from "drizzle-orm/pg-core";
import type {
    FieldRule,
    IAudioTranscriptMetadata,
    IAudioTranscriptVariantMetadata,
    IJudgeSpec,
    IPipelineFieldConfig,
    IPromptOptimizerGuidanceSource,
    IPromptSampleInput,
    IPromptValidationEvidence,
    IReasoningConfig,
    IRunModelPromptSnapshot,
    ISchemaCompatibilityIssue,
    ITranscriptSegment,
    ITranscriptSpeaker,
    IWorkflowNodeEvalConfig,
    WorkflowNodeConfig,
    IWorkflowNodePosition,
    IWorkflowSnapshot,
    WorkflowNodeArtifact,
    JsonSchemaObject,
    LabelJson,
    OutputJson,
    RunConfigSnapshot,
} from "./jsonTypes";
import { costSource, scorerType } from "./schemaEnums";
import { createWorkflowSttTables } from "./workflowSttSchema";

export { costSource, scorerType } from "./schemaEnums";

export const itemType = pgEnum("item_type", [
    "audio",
    "image",
    "text",
    "mixed",
]);
export const promptKind = pgEnum("prompt_kind", ["eval", "judge"]);
export const promptVersionStatus = pgEnum("prompt_version_status", [
    "legacy",
    "runnable",
]);
export const promptValidationStatus = pgEnum("prompt_validation_status", [
    "running",
    "passed",
    "failed",
    "provider_error",
    "cancelled",
]);
export const promptOptimizationStatus = pgEnum("prompt_optimization_status", [
    "running",
    "proposed",
    "failed",
    "cancelled",
]);
export const promptSchemaGenerationStatus = pgEnum(
    "prompt_schema_generation_status",
    ["proposed", "failed"],
);
export const runStatus = pgEnum("run_status", [
    "pending",
    "running",
    "completed",
    "partial",
    "failed",
]);
export const cellStatus = pgEnum("cell_status", [
    "pending",
    "running",
    "succeeded",
    "failed",
    "cached",
]);
export const datasetPurpose = pgEnum("dataset_purpose", [
    "golden",
    "evaluation",
]);
export const datasetModality = pgEnum("dataset_modality", [
    "audio",
    "image",
    "text",
]);
export const reviewVerdict = pgEnum("review_verdict", [
    "unreviewed",
    "approved",
    "needs_review",
    "issue",
]);
export const runTarget = pgEnum("run_target", ["single_item", "dataset"]);

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
    timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const teams = pgTable("teams", {
    id: id(),
    name: text("name").notNull(),
    ownerUserId: uuid("owner_user_id").references((): AnyPgColumn => users.id),
    createdAt: createdAt(),
});

export const providerKeys = pgTable(
    "provider_keys",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        provider: text("provider").notNull(),
        ciphertext: text("ciphertext").notNull(),
        iv: text("iv").notNull(),
        authTag: text("auth_tag").notNull(),
        baseUrl: text("base_url"),
        hint: text("hint").notNull(),
        rotationVersion: uuid("rotation_version").notNull().defaultRandom(),
        createdAt: createdAt(),
    },
    (t) => [
        uniqueIndex("provider_keys_team_provider_idx").on(t.teamId, t.provider),
        unique().on(t.teamId, t.id),
        index("provider_keys_team_id_idx").on(t.teamId),
    ],
);

export const users = pgTable(
    "users",
    {
        id: id(),
        clerkUserId: text("clerk_user_id").unique(),
        teamId: uuid("team_id")
            .notNull()
            .references((): AnyPgColumn => teams.id),
        email: text("email").notNull().unique(),
        name: text("name"),
        defaultWorkspaceId: uuid("default_workspace_id"),
        createdAt: createdAt(),
    },
    (t) => [index("users_team_id_idx").on(t.teamId)],
);

export const workspaces = pgTable(
    "workspaces",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        ownerUserId: uuid("owner_user_id").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.teamId, t.id),
        uniqueIndex("workspaces_team_name_idx").on(t.teamId, t.name),
        index("workspaces_team_id_idx").on(t.teamId),
        index("workspaces_owner_user_id_idx").on(t.ownerUserId),
    ],
);

export const projects = pgTable(
    "projects",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        workspaceId: uuid("workspace_id").references(() => workspaces.id, {
            onDelete: "restrict",
        }),
        name: text("name").notNull(),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.teamId, t.id),
        index("projects_team_id_idx").on(t.teamId),
        index("projects_workspace_id_idx").on(t.workspaceId),
    ],
);

export const llmRoutes = pgTable(
    "llm_routes",
    {
        id: id(),
        teamId: uuid("team_id").notNull(),
        projectId: uuid("project_id").notNull(),
        name: text("name").notNull(),
        disabledAt: timestamp("disabled_at", { withTimezone: true }),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        foreignKey({
            columns: [t.teamId, t.projectId],
            foreignColumns: [projects.teamId, projects.id],
            name: "llm_routes_team_project_fk",
        }).onDelete("cascade"),
        unique().on(t.teamId, t.projectId, t.id),
        unique().on(t.projectId, t.id),
        uniqueIndex("llm_routes_project_name_idx").on(t.projectId, t.name),
        index("llm_routes_team_project_idx").on(t.teamId, t.projectId),
    ],
);

export const llmCapabilityVersions = pgTable(
    "llm_capability_versions",
    {
        id: id(),
        teamId: uuid("team_id").notNull(),
        projectId: uuid("project_id").notNull(),
        transport: text("transport").notNull(),
        capabilityDigest: text("capability_digest").notNull(),
        capabilitySnapshot: jsonb("capability_snapshot")
            .$type<IWorkflowLlmCapabilitySnapshot>()
            .notNull(),
        capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
        expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
        createdAt: createdAt(),
    },
    (t) => [
        foreignKey({
            columns: [t.teamId, t.projectId],
            foreignColumns: [projects.teamId, projects.id],
            name: "llm_capability_versions_team_project_fk",
        }).onDelete("cascade"),
        unique().on(t.teamId, t.projectId, t.id),
        unique().on(t.projectId, t.id),
        unique().on(t.projectId, t.capabilityDigest),
        index("llm_capability_versions_lookup_idx").on(
            t.projectId,
            t.transport,
            t.expiresAt,
        ),
        check(
            "llm_capability_versions_transport_check",
            sql`${t.transport} in ('openai', 'gateway', 'openrouter', 'bifrost')`,
        ),
        check(
            "llm_capability_versions_window_check",
            sql`${t.expiresAt} > ${t.capturedAt}`,
        ),
    ],
);

export const llmRouteVersions = pgTable(
    "llm_route_versions",
    {
        id: id(),
        teamId: uuid("team_id").notNull(),
        projectId: uuid("project_id").notNull(),
        routeId: uuid("route_id").notNull(),
        version: integer("version").notNull(),
        config: jsonb("config").$type<IWorkflowLlmRouteConfig>().notNull(),
        providerKeyId: uuid("provider_key_id").notNull(),
        providerKeyRotationVersion: uuid(
            "provider_key_rotation_version",
        ).notNull(),
        capabilityVersionId: uuid("capability_version_id").notNull(),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        foreignKey({
            columns: [t.teamId, t.projectId, t.routeId],
            foreignColumns: [
                llmRoutes.teamId,
                llmRoutes.projectId,
                llmRoutes.id,
            ],
            name: "llm_route_versions_route_scope_fk",
        }).onDelete("restrict"),
        foreignKey({
            columns: [t.teamId, t.projectId, t.capabilityVersionId],
            foreignColumns: [
                llmCapabilityVersions.teamId,
                llmCapabilityVersions.projectId,
                llmCapabilityVersions.id,
            ],
            name: "llm_route_versions_capability_scope_fk",
        }).onDelete("restrict"),
        unique().on(t.teamId, t.projectId, t.id),
        unique().on(t.projectId, t.id),
        unique().on(t.routeId, t.version),
        index("llm_route_versions_project_idx").on(t.projectId),
        check("llm_route_versions_version_check", sql`${t.version} > 0`),
    ],
);

/**
 * Absence of a row means the project has no default. Keeping this relationship
 * separate avoids a nullable circular foreign key on `projects`.
 */
export const projectLlmDefaults = pgTable(
    "project_llm_defaults",
    {
        projectId: uuid("project_id").primaryKey(),
        teamId: uuid("team_id").notNull(),
        routeVersionId: uuid("route_version_id").notNull(),
        updatedBy: uuid("updated_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
    },
    (t) => [
        foreignKey({
            columns: [t.teamId, t.projectId],
            foreignColumns: [projects.teamId, projects.id],
            name: "project_llm_defaults_team_project_fk",
        }).onDelete("cascade"),
        foreignKey({
            columns: [t.teamId, t.projectId, t.routeVersionId],
            foreignColumns: [
                llmRouteVersions.teamId,
                llmRouteVersions.projectId,
                llmRouteVersions.id,
            ],
            name: "project_llm_defaults_route_scope_fk",
        }).onDelete("restrict"),
        index("project_llm_defaults_team_id_idx").on(t.teamId),
    ],
);

export const sttRouteProbes = pgTable(
    "stt_route_probes",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        modelId: text("model_id").notNull(),
        routeId: text("route_id").notNull(),
        status: text("status")
            .$type<"available" | "failed" | "unsupported_input">()
            .notNull(),
        reason: text("reason"),
        probedAt: timestamp("probed_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        probedBy: uuid("probed_by")
            .notNull()
            .references(() => users.id),
    },
    (t) => [
        uniqueIndex("stt_route_probes_team_project_model_idx").on(
            t.teamId,
            t.projectId,
            t.modelId,
        ),
        index("stt_route_probes_team_project_idx").on(t.teamId, t.projectId),
        check(
            "stt_route_probes_status_check",
            sql`${t.status} in ('available', 'failed', 'unsupported_input')`,
        ),
    ],
);

export const mcpAccessTokens = pgTable(
    "mcp_access_tokens",
    {
        id: id(),
        userId: uuid("user_id")
            .notNull()
            .references(() => users.id, { onDelete: "cascade" }),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id, { onDelete: "cascade" }),
        name: text("name").notNull(),
        tokenHash: text("token_hash").notNull().unique(),
        lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
        revokedAt: timestamp("revoked_at", { withTimezone: true }),
        createdBy: uuid("created_by").references(() => users.id, {
            onDelete: "set null",
        }),
        createdAt: createdAt(),
    },
    (t) => [
        index("mcp_access_tokens_team_id_idx").on(t.teamId),
        index("mcp_access_tokens_user_id_idx").on(t.userId),
        index("mcp_access_tokens_revoked_at_idx").on(t.revokedAt),
    ],
);

export const datasets = pgTable(
    "datasets",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        name: text("name").notNull(),
        purpose: datasetPurpose("purpose").notNull().default("golden"),
        modality: datasetModality("modality").notNull().default("image"),
        pipelineId: uuid("pipeline_id").references(() => pipelines.id),
        description: text("description"),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("datasets_team_id_idx").on(t.teamId),
        index("datasets_project_id_idx").on(t.projectId),
    ],
);

export const pipelines = pgTable(
    "pipelines",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        name: text("name").notNull(),
        outputSchema: jsonb("output_schema")
            .$type<JsonSchemaObject>()
            .notNull(),
        fieldConfigs: jsonb("field_configs")
            .$type<IPipelineFieldConfig[]>()
            .notNull(),
        promptId: uuid("prompt_id").references(() => prompts.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("pipelines_team_id_idx").on(t.teamId),
        index("pipelines_project_id_idx").on(t.projectId),
    ],
);

export const datasetSchemas = pgTable("dataset_schemas", {
    id: id(),
    datasetId: uuid("dataset_id")
        .notNull()
        .references(() => datasets.id)
        .unique(),
    jsonSchema: jsonb("json_schema").$type<JsonSchemaObject>().notNull(),
    fieldRules: jsonb("field_rules").$type<FieldRule[]>().notNull(),
    createdAt: createdAt(),
});

export const datasetItems = pgTable(
    "dataset_items",
    {
        id: id(),
        datasetId: uuid("dataset_id")
            .notNull()
            .references(() => datasets.id),
        type: itemType("type").notNull(),
        inputText: text("input_text"),
        sourceName: text("source_name"),
        storageKey: text("storage_key"),
        mimeType: text("mime_type"),
        createdAt: createdAt(),
    },
    (t) => [
        index("dataset_items_dataset_id_idx").on(t.datasetId),
        uniqueIndex("dataset_items_dataset_source_name_idx").on(
            t.datasetId,
            t.sourceName,
        ),
    ],
);

export const labels = pgTable("labels", {
    id: id(),
    datasetItemId: uuid("dataset_item_id")
        .notNull()
        .references(() => datasetItems.id)
        .unique(),
    labelJson: jsonb("label_json").$type<LabelJson>().notNull(),
    createdAt: createdAt(),
});

export const prompts = pgTable(
    "prompts",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        name: text("name").notNull(),
        description: text("description"),
        kind: promptKind("kind").notNull().default("eval"),
        basePromptId: uuid("base_prompt_id"),
        targetModelId: text("target_model_id"),
        createdAt: createdAt(),
    },
    (t) => [
        index("prompts_team_id_idx").on(t.teamId),
        index("prompts_project_id_idx").on(t.projectId),
    ],
);

export const promptSchemaVersions = pgTable(
    "prompt_schema_versions",
    {
        id: id(),
        promptId: uuid("prompt_id")
            .notNull()
            .references(() => prompts.id),
        version: integer("version").notNull(),
        jsonSchema: jsonb("json_schema").$type<JsonSchemaObject>().notNull(),
        fieldConfigs: jsonb("field_configs")
            .$type<IPipelineFieldConfig[]>()
            .notNull(),
        schemaHash: text("schema_hash").notNull(),
        openaiCompatible: boolean("openai_compatible").notNull().default(false),
        compatibilityErrors: jsonb("compatibility_errors")
            .$type<ISchemaCompatibilityIssue[]>()
            .notNull()
            .default([]),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.promptId, t.version),
        index("prompt_schema_versions_prompt_id_idx").on(t.promptId),
    ],
);

export const promptVersions = pgTable(
    "prompt_versions",
    {
        id: id(),
        promptId: uuid("prompt_id")
            .notNull()
            .references(() => prompts.id),
        version: integer("version").notNull(),
        content: text("content").notNull(),
        schemaVersionId: uuid("schema_version_id").references(
            () => promptSchemaVersions.id,
        ),
        status: promptVersionStatus("status").notNull().default("legacy"),
        validationAttemptId: uuid("validation_attempt_id").references(
            (): AnyPgColumn => promptValidationAttempts.id,
        ),
        optimizerAttemptId: uuid("optimizer_attempt_id").references(
            (): AnyPgColumn => promptOptimizationAttempts.id,
        ),
        reasoningConfig: jsonb("reasoning_config").$type<IReasoningConfig>(),
        judgeSpec: jsonb("judge_spec").$type<IJudgeSpec>(),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.promptId, t.version),
        check(
            "prompt_versions_runnable_evidence_check",
            sql`${t.status} <> 'runnable' or (${t.judgeSpec} is not null or (${t.schemaVersionId} is not null and ${t.validationAttemptId} is not null))`,
        ),
    ],
);

export const promptDrafts = pgTable(
    "prompt_drafts",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        promptId: uuid("prompt_id")
            .notNull()
            .references(() => prompts.id),
        content: text("content").notNull().default(""),
        jsonSchema: jsonb("json_schema").$type<JsonSchemaObject>(),
        fieldConfigs: jsonb("field_configs").$type<IPipelineFieldConfig[]>(),
        sampleInputs: jsonb("sample_inputs").$type<IPromptSampleInput[]>(),
        sourcePromptVersionId: uuid("source_prompt_version_id").references(
            () => promptVersions.id,
        ),
        sourceSchemaVersionId: uuid("source_schema_version_id").references(
            () => promptSchemaVersions.id,
        ),
        validationEvidenceStale: boolean("validation_evidence_stale")
            .notNull()
            .default(true),
        createdBy: uuid("created_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [
        index("prompt_drafts_team_id_idx").on(t.teamId),
        index("prompt_drafts_project_id_idx").on(t.projectId),
        index("prompt_drafts_prompt_id_idx").on(t.promptId),
    ],
);

export const promptValidationAttempts = pgTable(
    "prompt_validation_attempts",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        promptId: uuid("prompt_id").references(() => prompts.id),
        draftId: uuid("draft_id").references(() => promptDrafts.id),
        promptVersionId: uuid("prompt_version_id").references(
            () => promptVersions.id,
        ),
        schemaVersionId: uuid("schema_version_id").references(
            () => promptSchemaVersions.id,
        ),
        targetModelId: text("target_model_id").notNull(),
        status: promptValidationStatus("status").notNull(),
        schemaHash: text("schema_hash"),
        evidence: jsonb("evidence").$type<IPromptValidationEvidence>(),
        rawOutput: text("raw_output"),
        parsedOutput: jsonb("parsed_output"),
        error: text("error"),
        latencyMs: doublePrecision("latency_ms"),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("prompt_validation_attempts_team_id_idx").on(t.teamId),
        index("prompt_validation_attempts_project_id_idx").on(t.projectId),
        index("prompt_validation_attempts_prompt_id_idx").on(t.promptId),
    ],
);

export const promptOptimizationAttempts = pgTable(
    "prompt_optimization_attempts",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        promptId: uuid("prompt_id").references(() => prompts.id),
        draftId: uuid("draft_id").references(() => promptDrafts.id),
        sourcePromptVersionId: uuid("source_prompt_version_id").references(
            () => promptVersions.id,
        ),
        targetModelId: text("target_model_id"),
        optimizerModelId: text("optimizer_model_id").notNull(),
        status: promptOptimizationStatus("status").notNull(),
        guidanceSource:
            jsonb("guidance_source").$type<IPromptOptimizerGuidanceSource>(),
        originalPrompt: text("original_prompt").notNull(),
        proposedPrompt: text("proposed_prompt"),
        rationale: text("rationale"),
        validationAttemptId: uuid("validation_attempt_id").references(
            () => promptValidationAttempts.id,
        ),
        error: text("error"),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("prompt_optimization_attempts_team_id_idx").on(t.teamId),
        index("prompt_optimization_attempts_project_id_idx").on(t.projectId),
        index("prompt_optimization_attempts_prompt_id_idx").on(t.promptId),
    ],
);

// Audit trail for AI schema generation so LLM spend is attributed per team and
// rate-limiting can be added later. No prompt content is stored — only which
// model ran, for whom, and the outcome.
export const promptSchemaGenerationAttempts = pgTable(
    "prompt_schema_generation_attempts",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        targetModelId: text("target_model_id"),
        generatorModelId: text("generator_model_id").notNull(),
        status: promptSchemaGenerationStatus("status").notNull(),
        openaiCompatible: boolean("openai_compatible"),
        error: text("error"),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("prompt_schema_generation_attempts_team_id_idx").on(t.teamId),
        index("prompt_schema_generation_attempts_project_id_idx").on(
            t.projectId,
        ),
    ],
);

export const promptVersionFitTags = pgTable(
    "prompt_version_fit_tags",
    {
        id: id(),
        promptVersionId: uuid("prompt_version_id")
            .notNull()
            .references(() => promptVersions.id),
        tag: text("tag").notNull(),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.promptVersionId, t.tag),
        index("prompt_version_fit_tags_prompt_version_id_idx").on(
            t.promptVersionId,
        ),
    ],
);

export const judgeConfigs = pgTable(
    "judge_configs",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        name: text("name").notNull(),
        modelId: text("model_id").notNull(),
        rubricPrompt: text("rubric_prompt").notNull(),
        reasoningConfig: jsonb("reasoning_config").$type<IReasoningConfig>(),
        createdAt: createdAt(),
    },
    (t) => [
        index("judge_configs_team_id_idx").on(t.teamId),
        index("judge_configs_project_id_idx").on(t.projectId),
    ],
);

export const runs = pgTable(
    "runs",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        datasetId: uuid("dataset_id")
            .notNull()
            .references(() => datasets.id),
        judgeConfigId: uuid("judge_config_id").references(
            () => judgeConfigs.id,
        ),
        judgePromptVersionId: uuid("judge_prompt_version_id").references(
            () => promptVersions.id,
        ),
        pipelineId: uuid("pipeline_id").references(() => pipelines.id),
        status: runStatus("status").notNull().default("pending"),
        configSnapshot: jsonb("config_snapshot")
            .$type<RunConfigSnapshot>()
            .notNull(),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("runs_team_id_idx").on(t.teamId),
        index("runs_project_id_idx").on(t.projectId),
    ],
);

export const promptWorkflows = pgTable(
    "prompt_workflows",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        name: text("name").notNull(),
        description: text("description").notNull().default(""),
        kind: text("kind").notNull().default("prompt"),
        sttConfig: jsonb("stt_config").$type<ISttRunConfig>(),
        archivedAt: timestamp("archived_at", { withTimezone: true }),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        index("prompt_workflows_team_id_idx").on(t.teamId),
        index("prompt_workflows_project_id_idx").on(t.projectId),
    ],
);

export const workflowNodes = pgTable(
    "workflow_nodes",
    {
        id: id(),
        workflowId: uuid("workflow_id")
            .notNull()
            .references(() => promptWorkflows.id, { onDelete: "cascade" }),
        nodeKey: text("node_key").notNull(),
        label: text("label").notNull(),
        nodeType: text("node_type").notNull().default("prompt"),
        nodeConfig: jsonb("node_config").$type<WorkflowNodeConfig>(),
        promptVersionId: uuid("prompt_version_id").references(
            () => promptVersions.id,
        ),
        modelId: text("model_id"),
        reasoningConfig: jsonb("reasoning_config").$type<IReasoningConfig>(),
        llmSelectionMode: text("llm_selection_mode").$type<
            "simple" | "pinned_route" | "project_default"
        >(),
        llmTransport: text("llm_transport").$type<WorkflowLlmTransport>(),
        llmRouteVersionId: uuid("llm_route_version_id").references(
            () => llmRouteVersions.id,
            { onDelete: "restrict" },
        ),
        evalConfig: jsonb("eval_config")
            .$type<IWorkflowNodeEvalConfig>()
            .notNull()
            .default({ type: "none" }),
        position: jsonb("position").$type<IWorkflowNodePosition>(),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.workflowId, t.id),
        unique().on(t.workflowId, t.nodeKey),
        index("workflow_nodes_workflow_id_idx").on(t.workflowId),
        check(
            "workflow_nodes_prompt_version_check",
            sql`${t.nodeType} <> 'prompt' or ${t.promptVersionId} is not null`,
        ),
        check(
            "workflow_nodes_model_id_check",
            sql`${t.nodeType} in ('metric_compare', 'input') or ${t.modelId} is not null`,
        ),
        check(
            "workflow_nodes_llm_selection_check",
            sql`coalesce((${t.llmSelectionMode} is null and ${t.llmRouteVersionId} is null)
                or (${t.llmSelectionMode} = 'simple' and ${t.llmTransport} is not null and ${t.llmRouteVersionId} is null)
                or (${t.llmSelectionMode} = 'project_default' and ${t.llmRouteVersionId} is null)
                or (${t.llmSelectionMode} = 'pinned_route' and ${t.llmRouteVersionId} is not null), false)`,
        ),
    ],
);

export const workflowEdges = pgTable(
    "workflow_edges",
    {
        id: id(),
        workflowId: uuid("workflow_id")
            .notNull()
            .references(() => promptWorkflows.id, { onDelete: "cascade" }),
        fromNodeId: uuid("from_node_id").notNull(),
        toNodeId: uuid("to_node_id").notNull(),
        carryOriginalInput: boolean("carry_original_input")
            .notNull()
            .default(false),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.workflowId, t.fromNodeId, t.toNodeId),
        foreignKey({
            columns: [t.workflowId, t.fromNodeId],
            foreignColumns: [workflowNodes.workflowId, workflowNodes.id],
            name: "workflow_edges_from_node_workflow_fk",
        }).onDelete("cascade"),
        foreignKey({
            columns: [t.workflowId, t.toNodeId],
            foreignColumns: [workflowNodes.workflowId, workflowNodes.id],
            name: "workflow_edges_to_node_workflow_fk",
        }).onDelete("cascade"),
        index("workflow_edges_workflow_id_idx").on(t.workflowId),
        index("workflow_edges_from_node_id_idx").on(t.fromNodeId),
        index("workflow_edges_to_node_id_idx").on(t.toNodeId),
    ],
);

export const workflowRuns = pgTable(
    "workflow_runs",
    {
        id: id(),
        teamId: uuid("team_id")
            .notNull()
            .references(() => teams.id),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id),
        workflowId: uuid("workflow_id")
            .notNull()
            .references(() => promptWorkflows.id),
        datasetId: uuid("dataset_id")
            .notNull()
            .references(() => datasets.id),
        status: runStatus("status").notNull().default("pending"),
        enqueueStatus: text("enqueue_status")
            .$type<
                "pending_enqueue" | "queued" | "failed" | "legacy_unresolved"
            >()
            .notNull()
            .default("pending_enqueue"),
        workflowSnapshot: jsonb("workflow_snapshot")
            .$type<IWorkflowSnapshot>()
            .notNull(),
        runTarget: runTarget("run_target").notNull(),
        targetItemId: uuid("target_item_id").references(() => datasetItems.id),
        idempotencyKey: text("idempotency_key"),
        idempotencyFingerprint: text("idempotency_fingerprint"),
        createdBy: uuid("created_by").references(() => users.id),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.projectId, t.id),
        index("workflow_runs_team_id_idx").on(t.teamId),
        index("workflow_runs_project_id_idx").on(t.projectId),
        index("workflow_runs_workflow_id_idx").on(t.workflowId),
        index("workflow_runs_dataset_id_idx").on(t.datasetId),
        unique("workflow_runs_project_workflow_idempotency_unique").on(
            t.projectId,
            t.workflowId,
            t.idempotencyKey,
        ),
        check(
            "workflow_runs_idempotency_pair_check",
            sql`(${t.idempotencyKey} is null and ${t.idempotencyFingerprint} is null) or (${t.idempotencyKey} is not null and ${t.idempotencyFingerprint} is not null)`,
        ),
        check(
            "workflow_runs_enqueue_status_check",
            sql`${t.enqueueStatus} in ('pending_enqueue', 'queued', 'failed', 'legacy_unresolved')`,
        ),
    ],
);

export const workflowRunCells = pgTable(
    "workflow_run_cells",
    {
        id: id(),
        workflowRunId: uuid("workflow_run_id")
            .notNull()
            .references(() => workflowRuns.id, { onDelete: "cascade" }),
        datasetItemId: uuid("dataset_item_id")
            .notNull()
            .references(() => datasetItems.id),
        nodeKey: text("node_key").notNull(),
        status: cellStatus("status").notNull().default("pending"),
        inputText: text("input_text").notNull().default(""),
        outputJson: jsonb("output_json").$type<
            OutputJson | WorkflowNodeArtifact
        >(),
        latencyMs: doublePrecision("latency_ms"),
        costUsd: doublePrecision("cost_usd"),
        error: text("error"),
        claimedAt: timestamp("claimed_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.workflowRunId, t.datasetItemId, t.nodeKey),
        index("workflow_run_cells_lookup_idx").on(
            t.workflowRunId,
            t.datasetItemId,
            t.nodeKey,
        ),
        index("workflow_run_cells_workflow_run_id_idx").on(t.workflowRunId),
        index("workflow_run_cells_dataset_item_id_idx").on(t.datasetItemId),
    ],
);

export const workflowCellAttempts = pgTable(
    "workflow_cell_attempts",
    {
        id: id(),
        workflowRunCellId: uuid("workflow_run_cell_id")
            .notNull()
            .references(() => workflowRunCells.id, { onDelete: "restrict" }),
        sequence: integer("sequence").notNull(),
        owner: text("owner").$type<"mosaic" | "gateway">().notNull(),
        requested: jsonb("requested")
            .$type<IWorkflowLlmRouteIdentity>()
            .notNull(),
        actual: jsonb("actual").$type<IWorkflowLlmActualRoute>(),
        outcome: text("outcome").$type<"succeeded" | "failed">().notNull(),
        errorClass: text("error_class"),
        latencyMs: doublePrecision("latency_ms"),
        safeProviderEvidence: jsonb("safe_provider_evidence").$type<
            Record<string, unknown>
        >(),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.workflowRunCellId, t.sequence, t.owner),
        index("workflow_cell_attempts_cell_idx").on(t.workflowRunCellId),
        check("workflow_cell_attempts_sequence_check", sql`${t.sequence} > 0`),
        check(
            "workflow_cell_attempts_owner_check",
            sql`${t.owner} in ('mosaic', 'gateway')`,
        ),
        check(
            "workflow_cell_attempts_outcome_check",
            sql`${t.outcome} in ('succeeded', 'failed')`,
        ),
    ],
);

export const workflowExactReuse = pgTable(
    "workflow_exact_reuse",
    {
        id: id(),
        projectId: uuid("project_id")
            .notNull()
            .references(() => projects.id, { onDelete: "cascade" }),
        fingerprintVersion: integer("fingerprint_version").notNull(),
        fingerprint: text("fingerprint").notNull(),
        canonicalInputDigest: text("canonical_input_digest").notNull(),
        artifactDigest: text("artifact_digest").notNull(),
        artifact: jsonb("artifact").$type<IWorkflowNodeArtifact>().notNull(),
        originProvenance: jsonb("origin_provenance")
            .$type<IWorkflowLlmExecutionProvenance>()
            .notNull(),
        sourceCellId: uuid("source_cell_id").references(
            () => workflowRunCells.id,
            { onDelete: "set null" },
        ),
        publishedAt: timestamp("published_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.projectId, t.fingerprintVersion, t.fingerprint),
        index("workflow_exact_reuse_source_cell_idx").on(t.sourceCellId),
        check(
            "workflow_exact_reuse_fingerprint_version_check",
            sql`${t.fingerprintVersion} > 0`,
        ),
        check(
            "workflow_exact_reuse_digest_check",
            sql`length(${t.fingerprint}) > 0
                and length(${t.canonicalInputDigest}) > 0
                and length(${t.artifactDigest}) > 0`,
        ),
    ],
);

export const workflowRunEnqueueOutbox = pgTable(
    "workflow_run_enqueue_outbox",
    {
        id: id(),
        projectId: uuid("project_id").notNull(),
        workflowRunId: uuid("workflow_run_id").notNull(),
        status: text("status")
            .$type<"pending_enqueue" | "publishing" | "queued" | "failed">()
            .notNull()
            .default("pending_enqueue"),
        publishAttempts: integer("publish_attempts").notNull().default(0),
        availableAt: timestamp("available_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        queuedAt: timestamp("queued_at", { withTimezone: true }),
        lastError: text("last_error"),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [
        foreignKey({
            columns: [t.projectId, t.workflowRunId],
            foreignColumns: [workflowRuns.projectId, workflowRuns.id],
            name: "workflow_run_enqueue_outbox_run_scope_fk",
        }).onDelete("cascade"),
        unique().on(t.workflowRunId),
        index("workflow_run_enqueue_outbox_pending_idx").on(
            t.status,
            t.availableAt,
        ),
        check(
            "workflow_run_enqueue_outbox_status_check",
            sql`${t.status} in ('pending_enqueue', 'publishing', 'queued', 'failed')`,
        ),
        check(
            "workflow_run_enqueue_outbox_attempts_check",
            sql`${t.publishAttempts} >= 0`,
        ),
    ],
);

export const workflowRunNotes = pgTable(
    "workflow_run_notes",
    {
        id: id(),
        workflowRunId: uuid("workflow_run_id")
            .notNull()
            .references(() => workflowRuns.id)
            .unique(),
        body: text("body").notNull().default(""),
        updatedBy: uuid("updated_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [
        index("workflow_run_notes_workflow_run_id_idx").on(t.workflowRunId),
    ],
);

export const workflowRunCellAnnotations = pgTable(
    "workflow_run_cell_annotations",
    {
        id: id(),
        workflowRunCellId: uuid("workflow_run_cell_id")
            .notNull()
            .references(() => workflowRunCells.id)
            .unique(),
        verdict: reviewVerdict("verdict").notNull().default("unreviewed"),
        comment: text("comment").notNull().default(""),
        updatedBy: uuid("updated_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [
        index("workflow_run_cell_annotations_workflow_run_cell_id_idx").on(
            t.workflowRunCellId,
        ),
    ],
);

export const { workflowRunItems, workflowRunItemScores } =
    createWorkflowSttTables({
        workflowRunId: () => workflowRuns.id,
        datasetItemId: () => datasetItems.id,
    });

export const workflowCellScores = pgTable(
    "workflow_cell_scores",
    {
        id: id(),
        workflowRunCellId: uuid("workflow_run_cell_id")
            .notNull()
            .references(() => workflowRunCells.id, { onDelete: "cascade" }),
        scorerType: scorerType("scorer_type").notNull(),
        score: doublePrecision("score"),
        detailsJson: jsonb("details_json"),
        rationale: text("rationale"),
        createdAt: createdAt(),
    },
    (t) => [
        index("workflow_cell_scores_workflow_run_cell_id_idx").on(
            t.workflowRunCellId,
        ),
    ],
);

export const runModels = pgTable(
    "run_models",
    {
        id: id(),
        runId: uuid("run_id")
            .notNull()
            .references(() => runs.id),
        modelId: text("model_id").notNull(),
        promptVersionId: uuid("prompt_version_id").references(
            () => promptVersions.id,
        ),
        schemaVersionId: uuid("schema_version_id").references(
            () => promptSchemaVersions.id,
        ),
        promptSnapshot:
            jsonb("prompt_snapshot").$type<IRunModelPromptSnapshot>(),
        reasoningConfig: jsonb("reasoning_config").$type<IReasoningConfig>(),
        isReference: boolean("is_reference").notNull().default(false),
    },
    (t) => [
        index("run_models_run_id_idx").on(t.runId),
        index("run_models_cache_lookup_idx").on(t.modelId, t.promptVersionId),
    ],
);

export const runCells = pgTable(
    "run_cells",
    {
        id: id(),
        runId: uuid("run_id")
            .notNull()
            .references(() => runs.id),
        datasetItemId: uuid("dataset_item_id")
            .notNull()
            .references(() => datasetItems.id),
        runModelId: uuid("run_model_id")
            .notNull()
            .references(() => runModels.id),
        status: cellStatus("status").notNull().default("pending"),
        outputJson: jsonb("output_json").$type<OutputJson>(),
        latencyMs: doublePrecision("latency_ms"),
        costUsd: doublePrecision("cost_usd"),
        costSource: costSource("cost_source"),
        promptTokens: integer("prompt_tokens"),
        completionTokens: integer("completion_tokens"),
        providerMetadata: jsonb("provider_metadata").$type<ProviderMetadata>(),
        schemaViolation: boolean("schema_violation").notNull().default(false),
        maxTokens: integer("max_tokens"),
        contentFingerprint: text("content_fingerprint"),
        schemaHash: text("schema_hash"),
        error: text("error"),
        claimedAt: timestamp("claimed_at", { withTimezone: true }),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(t.runId, t.datasetItemId, t.runModelId),
        index("run_cells_run_id_idx").on(t.runId),
        index("run_cells_dataset_item_id_idx").on(t.datasetItemId),
        index("run_cells_cache_lookup_idx").on(
            t.datasetItemId,
            t.contentFingerprint,
            t.maxTokens,
            t.schemaHash,
            t.status,
            t.schemaViolation,
        ),
    ],
);

export const audioTranscripts = pgTable(
    "audio_transcripts",
    {
        id: id(),
        datasetItemId: uuid("dataset_item_id")
            .notNull()
            .references(() => datasetItems.id, { onDelete: "cascade" }),
        storageKey: text("storage_key").notNull(),
        providerId: text("provider_id").notNull().default("openai"),
        routeId: text("route_id")
            .notNull()
            .default("openai-audio-transcriptions"),
        sttModelId: text("stt_model_id").notNull(),
        canonicalModelId: text("canonical_model_id").notNull().default(""),
        language: text("language").notNull().default(""),
        configHash: text("config_hash").notNull().default(""),
        configJson: jsonb("config_json")
            .$type<Record<string, unknown>>()
            .notNull()
            .default({}),
        transcript: text("transcript").notNull(),
        rawText: text("raw_text"),
        normalizedText: text("normalized_text"),
        detectedLanguage: text("detected_language"),
        segmentsJson: jsonb("segments_json")
            .$type<ITranscriptSegment[]>()
            .notNull()
            .default([]),
        speakersJson: jsonb("speakers_json")
            .$type<ITranscriptSpeaker[]>()
            .notNull()
            .default([]),
        providerMetadata:
            jsonb("provider_metadata").$type<IAudioTranscriptMetadata>(),
        warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
        status: text("status").notNull().default("completed"),
        error: text("error"),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(
            t.datasetItemId,
            t.storageKey,
            t.providerId,
            t.routeId,
            t.canonicalModelId,
            t.language,
            t.configHash,
        ),
        index("audio_transcripts_lookup_idx").on(
            t.datasetItemId,
            t.storageKey,
            t.providerId,
            t.routeId,
            t.canonicalModelId,
            t.language,
            t.configHash,
        ),
    ],
);

export const audioTranscriptVariants = pgTable(
    "audio_transcript_variants",
    {
        id: id(),
        datasetItemId: uuid("dataset_item_id")
            .notNull()
            .references(() => datasetItems.id, { onDelete: "cascade" }),
        storageKey: text("storage_key").notNull(),
        sourceTranscriptHash: text("source_transcript_hash").notNull(),
        variantKind: text("variant_kind").notNull(),
        targetScript: text("target_script").notNull(),
        targetLanguage: text("target_language").notNull().default(""),
        modelId: text("model_id").notNull(),
        promptHash: text("prompt_hash").notNull().default(""),
        prompt: text("prompt"),
        transcript: text("transcript").notNull(),
        providerMetadata:
            jsonb("provider_metadata").$type<IAudioTranscriptVariantMetadata>(),
        status: text("status").notNull().default("completed"),
        error: text("error"),
        createdAt: createdAt(),
    },
    (t) => [
        unique().on(
            t.datasetItemId,
            t.storageKey,
            t.sourceTranscriptHash,
            t.variantKind,
            t.targetScript,
            t.targetLanguage,
            t.modelId,
            t.promptHash,
        ),
        index("audio_transcript_variants_lookup_idx").on(
            t.datasetItemId,
            t.storageKey,
            t.sourceTranscriptHash,
            t.variantKind,
            t.targetScript,
            t.targetLanguage,
            t.modelId,
            t.promptHash,
        ),
    ],
);

export const cellScores = pgTable(
    "cell_scores",
    {
        id: id(),
        runCellId: uuid("run_cell_id")
            .notNull()
            .references(() => runCells.id),
        scorerType: scorerType("scorer_type").notNull(),
        score: doublePrecision("score"),
        detailsJson: jsonb("details_json"),
        rationale: text("rationale"),
        createdAt: createdAt(),
    },
    (t) => [index("cell_scores_run_cell_id_idx").on(t.runCellId)],
);

export const runNotes = pgTable(
    "run_notes",
    {
        id: id(),
        runId: uuid("run_id")
            .notNull()
            .references(() => runs.id)
            .unique(),
        body: text("body").notNull().default(""),
        updatedBy: uuid("updated_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [index("run_notes_run_id_idx").on(t.runId)],
);

export const runCellAnnotations = pgTable(
    "run_cell_annotations",
    {
        id: id(),
        runCellId: uuid("run_cell_id")
            .notNull()
            .references(() => runCells.id)
            .unique(),
        verdict: reviewVerdict("verdict").notNull().default("unreviewed"),
        comment: text("comment").notNull().default(""),
        updatedBy: uuid("updated_by").references(() => users.id),
        updatedAt: timestamp("updated_at", { withTimezone: true })
            .notNull()
            .defaultNow(),
        createdAt: createdAt(),
    },
    (t) => [index("run_cell_annotations_run_cell_id_idx").on(t.runCellId)],
);

// Fixed-window request counters for API rate limiting (apps/api/src/rateLimit.ts).
// Rows are pruned per bucket when a new window starts.
export const apiRateLimits = pgTable(
    "api_rate_limits",
    {
        bucketKey: text("bucket_key").notNull(),
        windowStart: timestamp("window_start", {
            withTimezone: true,
        }).notNull(),
        requestCount: integer("request_count").notNull().default(0),
    },
    (t) => [primaryKey({ columns: [t.bucketKey, t.windowStart] })],
);
