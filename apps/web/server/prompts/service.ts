import { and, eq, desc, inArray, sql } from "drizzle-orm";
import { db } from "../db/client";
import {
    pipelines,
    promptDrafts,
    prompts,
    promptSchemaVersions,
    promptOptimizationAttempts,
    promptSchemaGenerationAttempts,
    promptValidationAttempts,
    promptVersionFitTags,
    promptVersions,
    runModels,
    runs,
} from "../db/schema";
import type {
    IPipelineFieldConfig,
    IJudgeSpec,
    IPromptOptimizerGuidanceSource,
    IPromptSampleInput,
    IPromptValidationEvidence,
    PromptKind,
    IReasoningConfig,
    JsonSchemaObject,
} from "../db/jsonTypes";
import {
    schemaHash,
    validatePromptSchema,
} from "./schemaValidation";

export async function createPrompt(
    teamId: string,
    name: string,
    basePromptId?: string,
    options: {
        targetModelId?: string;
        kind?: PromptKind;
        description?: string;
    } = {},
) {
    const [row] = await db
        .insert(prompts)
        .values({
            teamId,
            projectId: sql`(select id from projects where team_id = ${teamId} order by created_at limit 1)`,
            name,
            description: options.description,
            kind: options.kind ?? "eval",
            basePromptId,
            targetModelId: options.targetModelId,
        })
        .returning();
    return row;
}

export async function listPrompts(teamId: string, kind?: PromptKind) {
    return db
        .select()
        .from(prompts)
        .where(
            kind
                ? and(eq(prompts.teamId, teamId), eq(prompts.kind, kind))
                : eq(prompts.teamId, teamId),
        );
}

export async function getPrompt(id: string) {
    const [row] = await db
        .select()
        .from(prompts)
        .where(eq(prompts.id, id))
        .limit(1);
    return row;
}

export async function deletePrompt(promptId: string) {
    await db.transaction(async (tx) => {
        const versionRows = await tx
            .select({ id: promptVersions.id })
            .from(promptVersions)
            .where(eq(promptVersions.promptId, promptId));
        const versionIds = versionRows.map((version) => version.id);

        if (versionIds.length > 0) {
            const runModelUsage = await tx
                .select({ id: runModels.id })
                .from(runModels)
                .where(inArray(runModels.promptVersionId, versionIds))
                .limit(1);
            const judgeRunUsage = await tx
                .select({ id: runs.id })
                .from(runs)
                .where(inArray(runs.judgePromptVersionId, versionIds))
                .limit(1);
            if (runModelUsage.length > 0 || judgeRunUsage.length > 0) {
                throw new Error(
                    "Delete the runs that use this prompt before deleting the prompt.",
                );
            }
        }

        const schemaRows = await tx
            .select({ id: promptSchemaVersions.id })
            .from(promptSchemaVersions)
            .where(eq(promptSchemaVersions.promptId, promptId));
        const schemaIds = schemaRows.map((schema) => schema.id);
        const draftRows = await tx
            .select({ id: promptDrafts.id })
            .from(promptDrafts)
            .where(eq(promptDrafts.promptId, promptId));
        const draftIds = draftRows.map((draft) => draft.id);

        const validationIds = new Set<string>();
        for (const row of await tx
            .select({ id: promptValidationAttempts.id })
            .from(promptValidationAttempts)
            .where(eq(promptValidationAttempts.promptId, promptId))) {
            validationIds.add(row.id);
        }
        if (draftIds.length > 0) {
            for (const row of await tx
                .select({ id: promptValidationAttempts.id })
                .from(promptValidationAttempts)
                .where(inArray(promptValidationAttempts.draftId, draftIds))) {
                validationIds.add(row.id);
            }
        }
        if (versionIds.length > 0) {
            for (const row of await tx
                .select({ id: promptValidationAttempts.id })
                .from(promptValidationAttempts)
                .where(
                    inArray(promptValidationAttempts.promptVersionId, versionIds),
                )) {
                validationIds.add(row.id);
            }
        }
        if (schemaIds.length > 0) {
            for (const row of await tx
                .select({ id: promptValidationAttempts.id })
                .from(promptValidationAttempts)
                .where(inArray(promptValidationAttempts.schemaVersionId, schemaIds))) {
                validationIds.add(row.id);
            }
        }
        const validationAttemptIds = [...validationIds];

        if (versionIds.length > 0) {
            await tx
                .update(promptVersions)
                .set({
                    status: "legacy",
                    schemaVersionId: null,
                    validationAttemptId: null,
                    optimizerAttemptId: null,
                })
                .where(eq(promptVersions.promptId, promptId));
            await tx
                .update(promptDrafts)
                .set({ sourcePromptVersionId: null })
                .where(inArray(promptDrafts.sourcePromptVersionId, versionIds));
            await tx
                .update(promptValidationAttempts)
                .set({ promptVersionId: null })
                .where(
                    inArray(promptValidationAttempts.promptVersionId, versionIds),
                );
            await tx
                .update(promptOptimizationAttempts)
                .set({ sourcePromptVersionId: null })
                .where(
                    inArray(
                        promptOptimizationAttempts.sourcePromptVersionId,
                        versionIds,
                    ),
                );
            await tx
                .delete(promptVersionFitTags)
                .where(inArray(promptVersionFitTags.promptVersionId, versionIds));
        }

        if (schemaIds.length > 0) {
            await tx
                .update(promptDrafts)
                .set({ sourceSchemaVersionId: null })
                .where(inArray(promptDrafts.sourceSchemaVersionId, schemaIds));
            await tx
                .update(promptValidationAttempts)
                .set({ schemaVersionId: null })
                .where(inArray(promptValidationAttempts.schemaVersionId, schemaIds));
        }

        if (validationAttemptIds.length > 0) {
            await tx
                .update(promptOptimizationAttempts)
                .set({ validationAttemptId: null })
                .where(
                    inArray(
                        promptOptimizationAttempts.validationAttemptId,
                        validationAttemptIds,
                    ),
                );
        }

        await tx
            .delete(promptOptimizationAttempts)
            .where(eq(promptOptimizationAttempts.promptId, promptId));
        if (draftIds.length > 0) {
            await tx
                .delete(promptOptimizationAttempts)
                .where(inArray(promptOptimizationAttempts.draftId, draftIds));
        }
        if (validationAttemptIds.length > 0) {
            await tx
                .delete(promptValidationAttempts)
                .where(inArray(promptValidationAttempts.id, validationAttemptIds));
        }
        await tx.delete(promptDrafts).where(eq(promptDrafts.promptId, promptId));
        await tx
            .update(pipelines)
            .set({ promptId: null })
            .where(eq(pipelines.promptId, promptId));
        await tx
            .delete(promptVersions)
            .where(eq(promptVersions.promptId, promptId));
        await tx
            .delete(promptSchemaVersions)
            .where(eq(promptSchemaVersions.promptId, promptId));
        await tx.delete(prompts).where(eq(prompts.id, promptId));
    });
}

/**
 * Append a new immutable version; version numbers auto-increment per prompt.
 * Serialized with a row lock on the parent prompt so concurrent appends can't
 * collide on the (prompt_id, version) unique constraint.
 */
export async function addPromptVersion(
    promptId: string,
    content: string,
    createdBy: string,
    reasoningConfig?: IReasoningConfig,
    judgeSpec?: IJudgeSpec,
) {
    return db.transaction(async (tx) => {
        await tx
            .select({ id: prompts.id })
            .from(prompts)
            .where(eq(prompts.id, promptId))
            .for("update");
        const [latest] = await tx
            .select({ version: promptVersions.version })
            .from(promptVersions)
            .where(eq(promptVersions.promptId, promptId))
            .orderBy(desc(promptVersions.version))
            .limit(1);
        const nextVersion = (latest?.version ?? 0) + 1;
        const [row] = await tx
            .insert(promptVersions)
            .values({
                promptId,
                version: nextVersion,
                content,
                reasoningConfig,
                judgeSpec,
                createdBy,
                status: judgeSpec ? "runnable" : "legacy",
            })
            .returning();
        return row;
    });
}

export async function createJudgePrompt(input: {
    teamId: string;
    name: string;
    modelId: string;
    rubricPrompt: string;
    judgeSpec: IJudgeSpec;
    reasoningConfig?: IReasoningConfig;
    createdBy: string;
}) {
    return db.transaction(async (tx) => {
        const [prompt] = await tx
            .insert(prompts)
            .values({
                teamId: input.teamId,
                projectId: sql`(select id from projects where team_id = ${input.teamId} order by created_at limit 1)`,
                name: input.name,
                kind: "judge",
                targetModelId: input.modelId,
            })
            .returning();
        const [version] = await tx
            .insert(promptVersions)
            .values({
                promptId: prompt.id,
                version: 1,
                content: input.rubricPrompt,
                status: "runnable",
                judgeSpec: input.judgeSpec,
                reasoningConfig: input.reasoningConfig,
                createdBy: input.createdBy,
            })
            .returning();
        return { prompt, version };
    });
}

export async function createPromptDraft(input: {
    teamId: string;
    promptId: string;
    content?: string;
    jsonSchema?: JsonSchemaObject;
    fieldConfigs?: IPipelineFieldConfig[];
    sampleInputs?: IPromptSampleInput[];
    sourcePromptVersionId?: string;
    sourceSchemaVersionId?: string;
    createdBy: string;
}) {
    const [row] = await db
        .insert(promptDrafts)
        .values({
            teamId: input.teamId,
            projectId: sql`(select project_id from prompts where id = ${input.promptId})`,
            promptId: input.promptId,
            content: input.content ?? "",
            jsonSchema: input.jsonSchema,
            fieldConfigs: input.fieldConfigs,
            sampleInputs: input.sampleInputs,
            sourcePromptVersionId: input.sourcePromptVersionId,
            sourceSchemaVersionId: input.sourceSchemaVersionId,
            createdBy: input.createdBy,
            validationEvidenceStale: true,
        })
        .returning();
    return row;
}

export async function getLatestPromptDraftForTeam(teamId: string) {
    const [row] = await db
        .select()
        .from(promptDrafts)
        .where(eq(promptDrafts.teamId, teamId))
        .orderBy(desc(promptDrafts.updatedAt), desc(promptDrafts.createdAt))
        .limit(1);
    return row;
}

export async function updatePromptMetadata(input: {
    promptId: string;
    name: string;
    targetModelId?: string;
    description?: string;
}) {
    const [row] = await db
        .update(prompts)
        .set({
            name: input.name,
            description: input.description ?? null,
            targetModelId: input.targetModelId ?? null,
        })
        .where(eq(prompts.id, input.promptId))
        .returning();
    return row;
}

export async function savePromptDraftSampleInputs(input: {
    teamId: string;
    promptId: string;
    sampleInputs: IPromptSampleInput[];
    content?: string;
    jsonSchema?: JsonSchemaObject;
    fieldConfigs?: IPipelineFieldConfig[];
    createdBy: string;
}) {
    const [existing] = await db
        .select()
        .from(promptDrafts)
        .where(
            and(
                eq(promptDrafts.teamId, input.teamId),
                eq(promptDrafts.promptId, input.promptId),
            ),
        )
        .orderBy(desc(promptDrafts.updatedAt), desc(promptDrafts.createdAt))
        .limit(1);

    if (existing) {
        const [row] = await db
            .update(promptDrafts)
            .set({
                sampleInputs: input.sampleInputs,
                updatedAt: new Date(),
            })
            .where(eq(promptDrafts.id, existing.id))
            .returning();
        return row;
    }

    return createPromptDraft({
        teamId: input.teamId,
        promptId: input.promptId,
        content: input.content,
        jsonSchema: input.jsonSchema,
        fieldConfigs: input.fieldConfigs,
        sampleInputs: input.sampleInputs,
        createdBy: input.createdBy,
    });
}

export async function createSchemaVersion(input: {
    promptId: string;
    jsonSchema: JsonSchemaObject;
    fieldConfigs: IPipelineFieldConfig[];
    createdBy: string;
}) {
    const validation = validatePromptSchema(input.jsonSchema);
    const hash = schemaHash(input.jsonSchema);

    return db.transaction(async (tx) => {
        await tx
            .select({ id: prompts.id })
            .from(prompts)
            .where(eq(prompts.id, input.promptId))
            .for("update");
        const [latest] = await tx
            .select({ version: promptSchemaVersions.version })
            .from(promptSchemaVersions)
            .where(eq(promptSchemaVersions.promptId, input.promptId))
            .orderBy(desc(promptSchemaVersions.version))
            .limit(1);
        const nextVersion = (latest?.version ?? 0) + 1;
        const [row] = await tx
            .insert(promptSchemaVersions)
            .values({
                promptId: input.promptId,
                version: nextVersion,
                jsonSchema: input.jsonSchema,
                fieldConfigs: input.fieldConfigs,
                schemaHash: hash,
                openaiCompatible: validation.openaiCompatible,
                compatibilityErrors: validation.errors,
                createdBy: input.createdBy,
            })
            .returning();
        return row;
    });
}

export async function recordPromptValidationAttempt(input: {
    teamId: string;
    promptId?: string;
    draftId?: string;
    promptVersionId?: string;
    schemaVersionId?: string;
    targetModelId: string;
    status: "running" | "passed" | "failed" | "provider_error" | "cancelled";
    schemaHash?: string;
    evidence?: IPromptValidationEvidence;
    rawOutput?: string;
    parsedOutput?: unknown;
    error?: string;
    latencyMs?: number;
    createdBy: string;
}) {
    const [row] = await db
        .insert(promptValidationAttempts)
        .values({
            teamId: input.teamId,
            projectId: sql`(select id from projects where team_id = ${input.teamId} order by created_at limit 1)`,
            promptId: input.promptId,
            draftId: input.draftId,
            promptVersionId: input.promptVersionId,
            schemaVersionId: input.schemaVersionId,
            targetModelId: input.targetModelId,
            status: input.status,
            schemaHash: input.schemaHash,
            evidence: input.evidence,
            rawOutput: input.rawOutput,
            parsedOutput: input.parsedOutput,
            error: input.error,
            latencyMs: input.latencyMs,
            createdBy: input.createdBy,
        })
        .returning();
    return row;
}

export async function recordPromptOptimizationAttempt(input: {
    teamId: string;
    promptId?: string;
    draftId?: string;
    sourcePromptVersionId?: string;
    targetModelId?: string;
    optimizerModelId: string;
    status: "running" | "proposed" | "failed" | "cancelled";
    guidanceSource?: IPromptOptimizerGuidanceSource;
    originalPrompt: string;
    proposedPrompt?: string;
    rationale?: string;
    validationAttemptId?: string;
    error?: string;
    createdBy: string;
}) {
    const [row] = await db
        .insert(promptOptimizationAttempts)
        .values({
            teamId: input.teamId,
            projectId: sql`(select id from projects where team_id = ${input.teamId} order by created_at limit 1)`,
            promptId: input.promptId,
            draftId: input.draftId,
            sourcePromptVersionId: input.sourcePromptVersionId,
            targetModelId: input.targetModelId,
            optimizerModelId: input.optimizerModelId,
            status: input.status,
            guidanceSource: input.guidanceSource,
            originalPrompt: input.originalPrompt,
            proposedPrompt: input.proposedPrompt,
            rationale: input.rationale,
            validationAttemptId: input.validationAttemptId,
            error: input.error,
            createdBy: input.createdBy,
        })
        .returning();
    return row;
}

export async function addRunnablePromptVersion(input: {
    promptId: string;
    content: string;
    schemaVersionId: string;
    validationAttemptId: string;
    optimizerAttemptId?: string;
    reasoningConfig?: IReasoningConfig;
    fitTags?: string[];
    createdBy: string;
}) {
    if (!input.schemaVersionId || !input.validationAttemptId) {
        throw new Error(
            "Runnable prompt versions require a schema version and validation evidence.",
        );
    }

    return db.transaction(async (tx) => {
        const [schemaVersion] = await tx
            .select()
            .from(promptSchemaVersions)
            .where(eq(promptSchemaVersions.id, input.schemaVersionId))
            .limit(1);
        if (!schemaVersion || schemaVersion.promptId !== input.promptId) {
            throw new Error("Prompt schema version not found.");
        }
        if (!schemaVersion.openaiCompatible) {
            throw new Error("Prompt schema version is not OpenAI-compatible.");
        }

        const [validationAttempt] = await tx
            .select()
            .from(promptValidationAttempts)
            .where(eq(promptValidationAttempts.id, input.validationAttemptId))
            .limit(1);
        if (
            !validationAttempt ||
            validationAttempt.promptId !== input.promptId ||
            validationAttempt.status !== "passed"
        ) {
            throw new Error("Passing validation evidence is required.");
        }

        await tx
            .select({ id: prompts.id })
            .from(prompts)
            .where(eq(prompts.id, input.promptId))
            .for("update");
        const [latest] = await tx
            .select({ version: promptVersions.version })
            .from(promptVersions)
            .where(eq(promptVersions.promptId, input.promptId))
            .orderBy(desc(promptVersions.version))
            .limit(1);
        const nextVersion = (latest?.version ?? 0) + 1;
        const [version] = await tx
            .insert(promptVersions)
            .values({
                promptId: input.promptId,
                version: nextVersion,
                content: input.content,
                schemaVersionId: input.schemaVersionId,
                status: "runnable",
                validationAttemptId: input.validationAttemptId,
                optimizerAttemptId: input.optimizerAttemptId,
                reasoningConfig: input.reasoningConfig,
                judgeSpec: undefined,
                createdBy: input.createdBy,
            })
            .returning();

        const tags = [...new Set(input.fitTags ?? [])].filter(Boolean);
        if (tags.length > 0) {
            await tx.insert(promptVersionFitTags).values(
                tags.map((tag) => ({
                    promptVersionId: version.id,
                    tag,
                })),
            );
        }

        return version;
    });
}

export async function linkPromptOptimizationAttempt(input: {
    optimizerAttemptId: string;
    promptId: string;
    validationAttemptId: string;
}) {
    const [row] = await db
        .update(promptOptimizationAttempts)
        .set({
            promptId: input.promptId,
            validationAttemptId: input.validationAttemptId,
        })
        .where(eq(promptOptimizationAttempts.id, input.optimizerAttemptId))
        .returning();
    return row;
}

export async function duplicatePromptVersion(input: {
    teamId: string;
    sourcePromptVersionId: string;
    name: string;
    createdBy: string;
}) {
    const source = await getPromptVersion(input.sourcePromptVersionId);
    if (!source) throw new Error("Source prompt version not found.");
    const sourcePrompt = await getPrompt(source.promptId);
    if (!sourcePrompt) throw new Error("Source prompt not found.");

    const prompt = await createPrompt(
        input.teamId,
        input.name,
        sourcePrompt.basePromptId ?? sourcePrompt.id,
    );
    const draft = await createPromptDraft({
        teamId: input.teamId,
        promptId: prompt.id,
        content: source.content,
        sourcePromptVersionId: source.id,
        sourceSchemaVersionId: source.schemaVersionId ?? undefined,
        createdBy: input.createdBy,
    });
    return { prompt, draft };
}

export async function listVersions(promptId: string) {
    return db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.promptId, promptId))
        .orderBy(desc(promptVersions.version));
}

export async function latestVersion(promptId: string) {
    const [row] = await db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.promptId, promptId))
        .orderBy(desc(promptVersions.version))
        .limit(1);
    return row;
}

export async function getPromptVersion(id: string) {
    const [row] = await db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.id, id))
        .limit(1);
    return row;
}

export async function getPromptValidationAttempt(id: string) {
    const [row] = await db
        .select()
        .from(promptValidationAttempts)
        .where(eq(promptValidationAttempts.id, id))
        .limit(1);
    return row;
}

export async function recordPromptSchemaGenerationAttempt(input: {
    teamId: string;
    targetModelId?: string;
    generatorModelId: string;
    status: "proposed" | "failed";
    openaiCompatible?: boolean;
    error?: string;
    createdBy: string;
}) {
    const [row] = await db
        .insert(promptSchemaGenerationAttempts)
        .values({
            teamId: input.teamId,
            projectId: sql`(select id from projects where team_id = ${input.teamId} order by created_at limit 1)`,
            targetModelId: input.targetModelId,
            generatorModelId: input.generatorModelId,
            status: input.status,
            openaiCompatible: input.openaiCompatible,
            error: input.error,
            createdBy: input.createdBy,
        })
        .returning();
    return row;
}

export async function listPromptVersionFitTags(promptVersionId: string) {
    const rows = await db
        .select({ tag: promptVersionFitTags.tag })
        .from(promptVersionFitTags)
        .where(eq(promptVersionFitTags.promptVersionId, promptVersionId));
    return rows.map((row) => row.tag);
}

// Distinct fit tags previously used across a team's prompt versions, for tag
// suggestions. The join through prompts.teamId is required — the fit-tags table
// has no team column, so an unscoped query would leak tags across teams.
export async function listTeamFitTags(teamId: string, limit = 200) {
    const rows = await db
        .selectDistinct({ tag: promptVersionFitTags.tag })
        .from(promptVersionFitTags)
        .innerJoin(
            promptVersions,
            eq(promptVersionFitTags.promptVersionId, promptVersions.id),
        )
        .innerJoin(prompts, eq(promptVersions.promptId, prompts.id))
        .where(eq(prompts.teamId, teamId))
        .limit(limit);
    return rows.map((row) => row.tag).sort((a, b) => a.localeCompare(b));
}

export async function getPromptSchemaVersion(id: string) {
    const [row] = await db
        .select()
        .from(promptSchemaVersions)
        .where(eq(promptSchemaVersions.id, id))
        .limit(1);
    return row;
}

export async function listSchemaVersions(promptId: string) {
    return db
        .select()
        .from(promptSchemaVersions)
        .where(eq(promptSchemaVersions.promptId, promptId))
        .orderBy(desc(promptSchemaVersions.version));
}
