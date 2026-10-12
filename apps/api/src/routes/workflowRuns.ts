import { createHash, randomUUID } from "node:crypto";
import type {
    CellStatus,
    ICreateWorkflowRunRequest,
    ICreateWorkflowRunResponse,
    IWorkflowNodeAggregate,
    IWorkflowEdge,
    IWorkflowNode,
    IWorkflowNodeScore,
    IWorkflowRunCell,
    IWorkflowRunCellLlmExecution,
    IWorkflowRunDetailResponse,
    IWorkflowRunNote,
    IWorkflowRunProgressResponse,
    IWorkflowRunSummary,
    IWorkflowSttAggregate,
    IWorkflowSttPreparation,
    IWorkflowSttScore,
    IWorkflowSnapshot,
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmResolvedExecution,
    IWorkflowLlmRouteConfig,
    ReasoningEffort,
    ISttRunConfig,
    ReviewVerdict,
    RunStatus,
    WorkflowRunTarget,
    WorkflowLlmTransport,
} from "@mosaic/api-contract";
import {
    WORKFLOW_JUDGE_SCHEMA_DIGEST,
    WORKFLOW_JUDGE_SCHEMA_NAME,
    WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
    canonicalJsonString,
    isWorkflowModelBackedNodeType,
} from "@mosaic/api-contract";
import type { IApiConfig } from "../config.js";
import { assertRunCellLimit, assertTeamSpendUnderCap } from "../runLimits.js";
import type { IDb } from "../db.js";
import { withTransaction } from "../db.js";
import {
    ApiBadRequestError,
    ApiConflictError,
    ApiFieldValidationError,
    ApiNotFoundError,
} from "../errors.js";
import { resolveApiKeys } from "../secrets/resolveApiKeys.js";
import { registryEntryFor } from "../modelRegistry.js";
import {
    sttConfigForSnapshot,
    validateSttConfigForRun,
} from "./runs/creation.js";
import { workflowDetailPayload } from "./workflows.js";
import { validatePinnedWorkflowLlmRouteConfig } from "./llmRouting.js";

interface IWorkflowRunRow {
    id: string;
    teamId: string;
    projectId: string;
    workflowId: string;
    datasetId: string;
    targetItemId: string | null;
    status: RunStatus;
    workflowSnapshot: IWorkflowSnapshot;
    runTarget: WorkflowRunTarget;
    createdAt: Date | string;
}

interface IPromptVersionRow {
    id: string;
    content: string;
    schemaHash: string | null;
    jsonSchema: Record<string, unknown> | null;
}

interface IResolvedLlmRouteRow {
    routeVersionId: string;
    routeId: string;
    routeVersion: number;
    config: IWorkflowLlmRouteConfig;
    providerKeyId: string;
    capturedRotationVersion: string;
    currentRotationVersion: string | null;
    credentialHint: string | null;
    capabilityVersionId: string;
    capabilityDigest: string;
    capabilitySnapshot: IWorkflowLlmCapabilitySnapshot;
    disabledAt: Date | string | null;
}

interface IWorkflowScoringConfig {
    modelId: string;
    rubricPrompt: string;
    declaredInputs: Array<"task_input" | "candidate_output" | "reference">;
    reasoningEffort?: ReasoningEffort;
}

interface IDatasetItemRow {
    id: string;
}

interface IScoreRow extends IWorkflowNodeScore {
    cellId: string;
}

interface IWorkflowSttScoreRow extends IWorkflowSttScore {
    datasetItemId: string;
}

interface IWorkflowRunNoteRow {
    body: string;
    updated_at: Date | string;
    updated_by: string | null;
}

interface IWorkflowRunCellAnnotationRow {
    workflow_run_cell_id: string;
    verdict: ReviewVerdict;
    comment: string;
    updated_at: Date | string;
    updated_by: string | null;
}

interface ISaveWorkflowRunNoteInput {
    teamId: string;
    projectId: string;
    workflowRunId: string;
    body: string;
    updatedBy: string;
}

interface ISaveWorkflowRunCellAnnotationInput {
    teamId: string;
    projectId: string;
    workflowRunCellId: string;
    verdict: ReviewVerdict;
    comment: string;
    updatedBy: string;
}

function workflowSttAggregate(
    scorerType: IWorkflowSttAggregate["scorerType"],
    scores: IWorkflowSttScoreRow[],
): IWorkflowSttAggregate | undefined {
    const matching = scores.filter((score) => score.scorerType === scorerType);
    if (!matching.length) return undefined;
    const totals = matching.reduce(
        (result, score) => {
            if (score.status === "completed") {
                result.scored += 1;
                if (typeof score.score === "number") {
                    result.scoreSum += score.score;
                    result.numericScores += 1;
                }
            } else if (score.status === "skipped") result.skipped += 1;
            else result.failed += 1;
            return result;
        },
        { scored: 0, skipped: 0, failed: 0, scoreSum: 0, numericScores: 0 },
    );
    return {
        scorerType,
        scored: totals.scored,
        skipped: totals.skipped,
        failed: totals.failed,
        averageScore: totals.numericScores
            ? totals.scoreSum / totals.numericScores
            : undefined,
    };
}

function iso(value: Date | string): string {
    return value instanceof Date ? value.toISOString() : value;
}

function workflowRunCellLlmExecution(
    cell: IWorkflowRunCell,
    node: IWorkflowSnapshot["nodes"][number] | undefined,
): IWorkflowRunCellLlmExecution | undefined {
    if (!node || !isWorkflowModelBackedNodeType(node.nodeType ?? "prompt"))
        return undefined;
    const provenance = cell.outputJson?.executionProvenance;
    if (provenance)
        return {
            availability: "complete",
            requested: provenance.requested,
            resolved: provenance.resolved,
            actual: provenance.actual,
            attempts: provenance.attempts,
            cache: provenance.cache,
            usage: provenance.usage,
            currentCost: provenance.currentCost,
            ...(provenance.currentLatencyMs !== undefined
                ? { currentLatencyMs: provenance.currentLatencyMs }
                : {}),
            ...(provenance.originCost
                ? { originCost: provenance.originCost }
                : {}),
            ...(provenance.originLatencyMs !== undefined
                ? { originLatencyMs: provenance.originLatencyMs }
                : {}),
        };
    if (node.resolvedLlmExecution)
        return {
            availability: "partial",
            requested: node.resolvedLlmExecution.requestedSelection,
            resolved: node.resolvedLlmExecution,
        };
    return { availability: "legacy_unavailable" };
}

export async function saveWorkflowRunNotePayload(
    db: IDb,
    input: ISaveWorkflowRunNoteInput,
): Promise<void> {
    const run = (
        await db.query<{ id: string }>(
            `select id
             from workflow_runs
             where id = $1 and team_id = $2 and project_id = $3
             limit 1`,
            [input.workflowRunId, input.teamId, input.projectId],
        )
    ).rows[0];
    if (!run) throw new ApiNotFoundError("Workflow run not found.");

    await db.query(
        `insert into workflow_run_notes (
            workflow_run_id,
            body,
            updated_by,
            updated_at
        )
        values ($1, $2, $3, now())
        on conflict (workflow_run_id) do update set
            body = excluded.body,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [input.workflowRunId, input.body, input.updatedBy],
    );
}

export async function saveWorkflowRunCellAnnotationPayload(
    db: IDb,
    input: ISaveWorkflowRunCellAnnotationInput,
): Promise<{ workflowRunId: string }> {
    if (!isReviewVerdict(input.verdict))
        throw new ApiBadRequestError("Invalid review verdict");

    const cell = (
        await db.query<{ workflowRunId: string }>(
            `select c.workflow_run_id as "workflowRunId"
             from workflow_run_cells c
             inner join workflow_runs r on c.workflow_run_id = r.id
             where c.id = $1
               and r.team_id = $2
               and r.project_id = $3
             limit 1`,
            [input.workflowRunCellId, input.teamId, input.projectId],
        )
    ).rows[0];
    if (!cell) throw new ApiNotFoundError("Workflow run cell not found.");

    await db.query(
        `insert into workflow_run_cell_annotations (
            workflow_run_cell_id,
            verdict,
            comment,
            updated_by,
            updated_at
        )
        values ($1, $2, $3, $4, now())
        on conflict (workflow_run_cell_id) do update set
            verdict = excluded.verdict,
            comment = excluded.comment,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at`,
        [
            input.workflowRunCellId,
            input.verdict,
            input.comment,
            input.updatedBy,
        ],
    );
    return { workflowRunId: cell.workflowRunId };
}

export function workflowRunSttConfig(
    datasetModality: "audio" | "image" | "text",
    override: ISttRunConfig | undefined,
    workflowDefault: ISttRunConfig | undefined,
): ISttRunConfig | undefined {
    return datasetModality === "audio"
        ? (override ?? workflowDefault)
        : undefined;
}

export async function createWorkflowRunPayload(
    db: IDb,
    input: ICreateWorkflowRunRequest,
    config?: IApiConfig,
): Promise<ICreateWorkflowRunResponse> {
    const idempotencyKey = normalizeWorkflowRunIdempotencyKey(
        input.idempotencyKey,
    );
    const normalizedInput = {
        ...input,
        ...(idempotencyKey ? { idempotencyKey } : {}),
    };
    return withTransaction(db, (tx) =>
        createWorkflowRunInTransaction(tx, normalizedInput, config),
    );
}

// eslint-disable-next-line complexity -- run creation coordinates validation, snapshotting, and enqueue atomicity.
async function createWorkflowRunInTransaction(
    db: IDb,
    input: ICreateWorkflowRunRequest,
    config?: IApiConfig,
): Promise<ICreateWorkflowRunResponse> {
    const idempotencyFingerprint = input.idempotencyKey
        ? workflowRunRequestFingerprint(input)
        : undefined;
    if (input.idempotencyKey && idempotencyFingerprint) {
        await db.query(
            `select pg_advisory_xact_lock(hashtextextended($1, 0))`,
            [
                [
                    "workflow-run",
                    input.teamId,
                    input.projectId,
                    input.workflowId,
                    input.idempotencyKey,
                ].join(":"),
            ],
        );
        const existing = (
            await db.query<{
                workflowRunId: string;
                idempotencyFingerprint: string;
                enqueueStatus: "pending_enqueue" | "queued" | "failed";
            }>(
                `select id as "workflowRunId",
                        idempotency_fingerprint as "idempotencyFingerprint",
                        enqueue_status as "enqueueStatus"
                 from workflow_runs
                 where team_id=$1 and project_id=$2 and workflow_id=$3
                   and idempotency_key=$4`,
                [
                    input.teamId,
                    input.projectId,
                    input.workflowId,
                    input.idempotencyKey,
                ],
            )
        ).rows[0];
        if (existing) {
            if (existing.idempotencyFingerprint !== idempotencyFingerprint)
                throw new ApiConflictError(
                    "This workflow run idempotency key was already used for a different request.",
                );
            return {
                workflowRunId: existing.workflowRunId,
                enqueueStatus:
                    existing.enqueueStatus === "queued"
                        ? "queued"
                        : "pending_enqueue",
            };
        }
    }
    const detail = await workflowDetailPayload(
        db,
        input.teamId,
        input.projectId,
        input.workflowId,
        true,
    );
    if (
        config?.workflowLlmWritesEnabled === false &&
        detail.nodes.some((node) =>
            isWorkflowModelBackedNodeType(node.nodeType ?? "prompt"),
        )
    )
        throw new ApiConflictError(
            "Workflow LLM run creation is disabled until the API and worker rollout is ready.",
        );
    const workflowKind = detail.kind ?? "prompt";
    const versionIds = detail.nodes.flatMap((node) =>
        (node.nodeType ?? "prompt") === "prompt" && node.promptVersionId
            ? [node.promptVersionId]
            : [],
    );
    const versions = versionIds.length
        ? await db.query<IPromptVersionRow>(
              `select pv.id, pv.content, psv.schema_hash as "schemaHash",
                      psv.json_schema as "jsonSchema"
         from prompt_versions pv
         join prompts p on p.id = pv.prompt_id
         left join prompt_schema_versions psv on psv.id = pv.schema_version_id
         where pv.id = any($1::uuid[]) and p.team_id = $2 and p.project_id = $3
         for share of pv, p`,
              [versionIds, input.teamId, input.projectId],
          )
        : { rows: [] };
    if (versions.rows.length !== new Set(versionIds).size)
        throw new ApiBadRequestError(
            "Workflow prompt versions are no longer available in this project.",
        );
    const content = new Map(versions.rows.map((row) => [row.id, row.content]));
    const schemaHashes = new Map(
        versions.rows.map((row) => [row.id, row.schemaHash]),
    );
    const schemas = new Map(
        versions.rows.map((row) => [
            row.id,
            row.schemaHash && row.jsonSchema
                ? { digest: row.schemaHash, schema: row.jsonSchema }
                : undefined,
        ]),
    );
    const targetItemId =
        input.runTarget === "single_item" ? input.itemId : undefined;
    if (input.runTarget === "single_item" && !targetItemId)
        throw new ApiBadRequestError(
            "Select an item for a single-item workflow run.",
        );
    const dataset = (
        await db.query<{
            archivedAt: Date | string | null;
            modality: "audio" | "image" | "text";
        }>(
            `select archived_at as "archivedAt", modality
            from datasets
            where id=$1 and team_id=$2 and project_id=$3
            for share`,
            [input.datasetId, input.teamId, input.projectId],
        )
    ).rows[0];
    if (!dataset) throw new ApiNotFoundError("Dataset not found.");
    if (dataset.archivedAt != null)
        throw new ApiConflictError(
            "This dataset is archived. Restore it before running.",
        );
    if (workflowKind === "stt" && dataset.modality !== "audio")
        throw new ApiBadRequestError(
            "STT eval workflows require an audio dataset.",
        );
    if (workflowKind === "multi")
        validateMultiWorkflowRunInput(
            detail.nodes,
            input.datasetId,
            dataset.modality,
        );
    validateWorkflowVisionCapabilities(detail.nodes, detail.edges);
    const requestedSttConfig = workflowRunSttConfig(
        dataset.modality,
        input.sttConfig,
        detail.sttConfig,
    );
    const sttNodeConfigs = detail.nodes.flatMap((node) =>
        node.nodeConfig?.type === "stt" ? [node.nodeConfig.sttConfig] : [],
    );
    const effectiveConfig =
        config && (requestedSttConfig || sttNodeConfigs.length)
            ? await workflowConfigWithResolvedKeys(db, config, input.teamId)
            : config;
    if (workflowKind === "prompt")
        validateSttConfigForRun({
            datasetModality: dataset.modality ?? "text",
            sttConfig: requestedSttConfig,
            config: effectiveConfig,
        });
    else
        for (const sttNodeConfig of sttNodeConfigs)
            validateSttConfigForRun({
                datasetModality: "audio",
                sttConfig: sttNodeConfig,
                config: effectiveConfig,
            });
    const sttConfig = sttConfigForSnapshot(requestedSttConfig, effectiveConfig);
    const resolvedLlmExecutions = await resolveWorkflowLlmExecutions(
        db,
        detail.nodes,
        input.teamId,
        input.projectId,
        schemaHashes,
    );
    const scoringConfigs = await resolveWorkflowScoringConfigs(
        db,
        detail.nodes,
        resolvedLlmExecutions,
        input.teamId,
        input.projectId,
    );
    const resolvedPromptSchemas = new Map<
        string,
        {
            name: string;
            digest: string;
            strict: boolean;
            schema: Record<string, unknown>;
        }
    >();
    for (const node of detail.nodes) {
        if (!node.promptVersionId) continue;
        const stored = schemas.get(node.promptVersionId);
        const structured = resolvedLlmExecutions.get(node.id)?.route
            .structuredOutput;
        if (!stored || structured?.mode !== "json_schema") continue;
        resolvedPromptSchemas.set(node.id, {
            ...stored,
            name: structured.schemaName,
            strict: structured.strict,
        });
    }
    if (sttConfig?.evaluator?.enabled)
        throw routingRunError(
            "sttConfig.evaluator",
            "Workflow STT evaluators do not yet have an explicit LLM route selection.",
            "Disable the attached evaluator. Explicit STT evaluator routing must be configured before it can run.",
        );
    const snapshot: IWorkflowSnapshot = {
        workflowId: detail.id,
        name: detail.name,
        kind: workflowKind,
        nodes: detail.nodes.map((node) => ({
            ...node,
            ...(node.promptVersionId
                ? { promptContent: content.get(node.promptVersionId) }
                : {}),
            ...(resolvedPromptSchemas.get(node.id)
                ? { promptSchema: resolvedPromptSchemas.get(node.id)! }
                : {}),
            ...(resolvedLlmExecutions.get(node.id)
                ? {
                      resolvedLlmExecution: resolvedLlmExecutions.get(node.id)!,
                  }
                : {}),
            ...(scoringConfigs.get(node.id)
                ? { scoringConfig: scoringConfigs.get(node.id)! }
                : {}),
            ...(node.nodeConfig?.type === "stt"
                ? {
                      nodeConfig: {
                          ...node.nodeConfig,
                          sttConfig: sttConfigForSnapshot(
                              node.nodeConfig.sttConfig,
                              effectiveConfig,
                          )!,
                      },
                  }
                : {}),
        })),
        edges: detail.edges,
        ...(sttConfig ? { sttConfig } : {}),
    };
    const items = await db.query<IDatasetItemRow>(
        `select id
        from dataset_items
        where dataset_id=$1 and ($2::uuid is null or id=$2)
        for share`,
        [input.datasetId, targetItemId ?? null],
    );
    if (!items.rows.length)
        throw new ApiBadRequestError("The selected workflow run has no items.");
    assertRunCellLimit({
        itemCount: items.rows.length,
        perItemCount: detail.nodes.length,
        perItemLabel: "workflow nodes",
        maxRunCells: config?.maxRunCells,
    });
    await assertTeamSpendUnderCap(
        db,
        input.teamId,
        config?.teamDailySpendCapUsd,
    );
    const runId = randomUUID();
    const cellIds: string[] = [];
    const itemIds: string[] = [];
    const nodeKeys: string[] = [];
    for (const item of items.rows)
        for (const node of detail.nodes) {
            cellIds.push(randomUUID());
            itemIds.push(item.id);
            nodeKeys.push(node.nodeKey);
        }
    await db.query(
        `insert into workflow_runs(id,team_id,project_id,workflow_id,dataset_id,target_item_id,status,workflow_snapshot,run_target,created_by,enqueue_status,idempotency_key,idempotency_fingerprint) values($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,'pending_enqueue',$10,$11)`,
        [
            runId,
            input.teamId,
            input.projectId,
            input.workflowId,
            input.datasetId,
            targetItemId ?? null,
            snapshot,
            input.runTarget,
            input.createdBy,
            input.idempotencyKey ?? null,
            idempotencyFingerprint ?? null,
        ],
    );
    await db.query(
        `insert into workflow_run_cells(id, workflow_run_id, dataset_item_id, node_key, status)
             select cell_id, $1, item_id, node_key, 'pending' from unnest($2::uuid[], $3::uuid[], $4::text[]) as cells(cell_id, item_id, node_key)`,
        [runId, cellIds, itemIds, nodeKeys],
    );
    await db.query(
        `insert into workflow_run_enqueue_outbox (
            project_id, workflow_run_id, status
        ) values ($1, $2, 'pending_enqueue')
        on conflict (workflow_run_id) do nothing`,
        [input.projectId, runId],
    );
    return { workflowRunId: runId, enqueueStatus: "pending_enqueue" };
}

function normalizeWorkflowRunIdempotencyKey(
    value: unknown,
): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim().length === 0)
        throw new ApiFieldValidationError(
            "Workflow run idempotency key must be a non-empty string.",
            "idempotencyKey",
            "Provide a stable retry key or omit idempotencyKey.",
        );
    const normalized = value.trim();
    if (normalized.length > 200)
        throw new ApiFieldValidationError(
            "Workflow run idempotency key must be at most 200 characters.",
            "idempotencyKey",
            "Use a shorter stable retry key.",
        );
    return normalized;
}

function workflowRunRequestFingerprint(
    input: ICreateWorkflowRunRequest,
): string {
    return createHash("sha256")
        .update(
            canonicalJsonString({
                teamId: input.teamId,
                projectId: input.projectId,
                workflowId: input.workflowId,
                datasetId: input.datasetId,
                runTarget: input.runTarget,
                itemId: input.itemId ?? null,
                sttConfig: input.sttConfig ?? null,
                createdBy: input.createdBy,
            }),
        )
        .digest("hex");
}

async function resolveWorkflowScoringConfigs(
    db: IDb,
    nodes: IWorkflowNode[],
    executions: Map<string, IWorkflowLlmResolvedExecution>,
    teamId: string,
    projectId: string,
): Promise<Map<string, IWorkflowScoringConfig>> {
    const configs = new Map<string, IWorkflowScoringConfig>();
    for (const node of nodes) {
        const execution = executions.get(node.id);
        const needsLlmScoring =
            node.evalConfig.type === "judge" ||
            (node.evalConfig.type === "field_diff" &&
                node.evalConfig.fieldConfigs.some(
                    (field) => field.kind === "generative",
                ));
        if (!needsLlmScoring) continue;
        if (!execution)
            throw routingRunError(
                `nodes.${node.nodeKey}.evalConfig`,
                `Workflow scoring for node "${node.label}" has no resolved LLM execution.`,
                "Attach scoring only to a model-backed node with an explicit route.",
            );
        if (node.evalConfig.type === "field_diff") {
            for (const [index, field] of node.evalConfig.fieldConfigs.entries())
                if (
                    field.kind === "generative" &&
                    field.modelId !== execution.route.modelId
                )
                    throw routingRunError(
                        `nodes.${node.nodeKey}.evalConfig.fieldConfigs.${index}.modelId`,
                        `Workflow scoring for node "${node.label}" uses a different model from its resolved route.`,
                        "Use the node route model for every generative scoring field or remove the attached scorer.",
                    );
            continue;
        }
        if (node.evalConfig.type !== "judge") continue;
        let config: IWorkflowScoringConfig | undefined;
        if (node.evalConfig.judgeConfigId) {
            config = (
                await db.query<IWorkflowScoringConfig>(
                    `select model_id as "modelId",
                            rubric_prompt as "rubricPrompt",
                            array['task_input','candidate_output']::text[] as "declaredInputs",
                            reasoning_config->>'effort' as "reasoningEffort"
                    from judge_configs
                    where id = $1 and team_id = $2 and project_id = $3
                    for share`,
                    [node.evalConfig.judgeConfigId, teamId, projectId],
                )
            ).rows[0];
        } else if (node.evalConfig.judgePromptVersionId) {
            config = (
                await db.query<IWorkflowScoringConfig>(
                    `select pv.judge_spec->>'modelId' as "modelId",
                            pv.content as "rubricPrompt",
                            pv.judge_spec->'declaredInputs' as "declaredInputs",
                            pv.reasoning_config->>'effort' as "reasoningEffort"
                    from prompt_versions pv
                    join prompts p on p.id = pv.prompt_id
                    where pv.id = $1 and p.team_id = $2 and p.project_id = $3
                      and pv.judge_spec is not null
                    for share of pv, p`,
                    [node.evalConfig.judgePromptVersionId, teamId, projectId],
                )
            ).rows[0];
        }
        if (!config)
            throw routingRunError(
                `nodes.${node.nodeKey}.evalConfig`,
                `Workflow scoring for node "${node.label}" is no longer available.`,
                "Select a current judge prompt before starting the run.",
            );
        if (config.modelId !== execution.route.modelId)
            throw routingRunError(
                `nodes.${node.nodeKey}.evalConfig`,
                `Workflow scoring for node "${node.label}" uses model "${config.modelId}", but its resolved route uses "${execution.route.modelId}".`,
                "Select a route for the judge model or use a matching scoring model.",
            );
        if (
            (config.reasoningEffort ?? undefined) !==
            execution.route.generation.reasoningEffort
        )
            throw routingRunError(
                `nodes.${node.nodeKey}.evalConfig`,
                `Workflow scoring for node "${node.label}" uses reasoning settings that differ from its resolved route.`,
                "Use the route reasoning setting for the attached judge.",
            );
        configs.set(node.id, {
            modelId: config.modelId,
            rubricPrompt: config.rubricPrompt,
            declaredInputs: config.declaredInputs,
            ...(config.reasoningEffort
                ? { reasoningEffort: config.reasoningEffort }
                : {}),
        });
    }
    return configs;
}

// eslint-disable-next-line complexity -- route resolution applies independent capability and provenance guards.
async function resolveWorkflowLlmExecutions(
    db: IDb,
    nodes: IWorkflowNode[],
    teamId: string,
    projectId: string,
    promptSchemaHashes: Map<string, string | null>,
): Promise<Map<string, IWorkflowLlmResolvedExecution>> {
    const resolved = new Map<string, IWorkflowLlmResolvedExecution>();
    const modelNodes = nodes.filter((node) =>
        isWorkflowModelBackedNodeType(node.nodeType ?? "prompt"),
    );
    for (const node of modelNodes)
        if (!node.llmExecutionSelection)
            throw routingRunError(
                `nodes.${node.nodeKey}.llmExecutionSelection`,
                `Workflow node "${node.label}" has no LLM route selection.`,
                "Select a pinned route or explicitly use the project default before starting a run.",
            );
    const routedNodes = modelNodes.filter(
        (node) => node.llmExecutionSelection?.mode !== "simple",
    );
    const defaultNode = routedNodes.find(
        (node) => node.llmExecutionSelection?.mode === "project_default",
    );
    let defaultRouteVersionId: string | undefined;
    if (defaultNode) {
        defaultRouteVersionId = (
            await db.query<{ routeVersionId: string }>(
                `select route_version_id as "routeVersionId"
                from project_llm_defaults
                where team_id = $1 and project_id = $2
                for share`,
                [teamId, projectId],
            )
        ).rows[0]?.routeVersionId;
        if (!defaultRouteVersionId)
            throw routingRunError(
                `nodes.${defaultNode.nodeKey}.llmExecutionSelection`,
                `Workflow node "${defaultNode.label}" selects the project default, but no default is configured.`,
                "Set a project LLM route default or pin a route on this node.",
            );
    }
    const routeVersionIdByNode = new Map(
        routedNodes.map((node) => [
            node.id,
            node.llmExecutionSelection!.mode === "pinned_route"
                ? node.llmExecutionSelection!.routeVersionId
                : defaultRouteVersionId!,
        ]),
    );
    const routeRows = await resolvedRouteRows(
        db,
        [...new Set(routeVersionIdByNode.values())],
        teamId,
        projectId,
    );
    const routeByVersionId = new Map(
        routeRows.map((route) => [route.routeVersionId, route]),
    );
    const simpleTransports = [
        ...new Set(
            modelNodes.flatMap((node) =>
                node.llmExecutionSelection?.mode === "simple"
                    ? [node.llmExecutionSelection.transport]
                    : [],
            ),
        ),
    ];
    const simpleCredentialRows = simpleTransports.length
        ? (
              await db.query<{
                  id: string;
                  provider: WorkflowLlmTransport;
                  rotationVersion: string;
              }>(
                  `select id, provider, rotation_version as "rotationVersion"
                   from provider_keys
                   where team_id = $1 and provider = any($2::text[])`,
                  [teamId, simpleTransports],
              )
          ).rows
        : [];
    const simpleCredentials = new Map(
        simpleCredentialRows.map((credential) => [
            credential.provider,
            credential,
        ]),
    );
    for (const node of modelNodes) {
        const nodeType = node.nodeType ?? "prompt";
        const path = `nodes.${node.nodeKey}.llmExecutionSelection`;
        const requestedSelection = node.llmExecutionSelection!;
        if (requestedSelection.mode === "simple") {
            if (!node.modelId)
                throw routingRunError(
                    `nodes.${node.nodeKey}.modelId`,
                    `Workflow node "${node.label}" needs a model for Simple mode.`,
                    "Choose a provider and model.",
                );
            const credential = simpleCredentials.get(
                requestedSelection.transport,
            );
            if (!credential)
                throw routingRunError(
                    path,
                    `No ${requestedSelection.transport} provider key is configured for Simple mode.`,
                    "Add a provider key, then choose a model again.",
                );
            const route = simpleWorkflowRoute(
                requestedSelection.transport,
                node.modelId,
                node.reasoningConfig?.effort,
                nodeType === "judge",
            );
            const promptSchemaDigest = node.promptVersionId
                ? promptSchemaHashes.get(node.promptVersionId)
                : undefined;
            if (nodeType === "prompt" && promptSchemaDigest) {
                route.structuredOutput = {
                    mode: "json_schema",
                    schemaName: "output",
                    schemaDigest: promptSchemaDigest,
                    strict: true,
                };
            }
            const identity = `simple:${requestedSelection.transport}:${node.modelId}`;
            resolved.set(node.id, {
                contractVersion: WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
                requestedSelection,
                routeId: identity,
                routeVersionId: identity,
                routeVersion: 0,
                route,
                credential: {
                    providerKeyId: credential.id,
                    rotationVersion: credential.rotationVersion,
                },
                capability: {
                    capabilityVersionId: identity,
                    capabilityDigest: identity,
                    capturedAt: new Date().toISOString(),
                    stale: false,
                    transport: {
                        transport: requestedSelection.transport,
                        modelId: node.modelId,
                        transportModelId: node.modelId,
                        upstreamRoutingModes:
                            requestedSelection.transport === "openrouter"
                                ? ["auto"]
                                : requestedSelection.transport === "openai"
                                  ? ["none"]
                                  : ["auto"],
                        supportedGenerationControls: [
                            "maxOutputTokens",
                            "reasoningEffort",
                        ],
                        // Simple mode asks the provider to enforce schemas at invocation time.
                        supportsStructuredOutput: true,
                        requiresCurrentDiscovery: false,
                    },
                },
            });
            continue;
        }
        const route = routeByVersionId.get(routeVersionIdByNode.get(node.id)!);
        if (!route) {
            throw routingRunError(
                path,
                `The LLM route for workflow node "${node.label}" is unavailable.`,
                "Choose an active route owned by this project.",
            );
        }
        if (route.disabledAt) {
            throw routingRunError(
                path,
                `The LLM route for workflow node "${node.label}" is disabled.`,
                "Choose an active route or update the project default.",
            );
        }
        if (
            !route.currentRotationVersion ||
            route.currentRotationVersion !== route.capturedRotationVersion
        ) {
            throw routingRunError(
                path,
                `The stored credential for workflow node "${node.label}" changed after this route version was created.`,
                "Create a new route version using the current stored credential.",
            );
        }
        if (
            route.capabilitySnapshot.capabilityVersionId !==
                route.capabilityVersionId ||
            route.capabilitySnapshot.capabilityDigest !== route.capabilityDigest
        ) {
            throw routingRunError(
                path,
                `The capability evidence for workflow node "${node.label}" is inconsistent.`,
                "Create a new route version from the provider's current model listing.",
            );
        }
        try {
            validatePinnedWorkflowLlmRouteConfig(
                route.config,
                route.capabilitySnapshot,
            );
        } catch (error) {
            throw routingRunError(
                path,
                `The LLM settings for workflow node "${node.label}" are no longer valid.`,
                error instanceof Error
                    ? error.message
                    : "Choose settings supported by the captured capability.",
            );
        }
        if (node.modelId && node.modelId !== route.config.modelId) {
            throw routingRunError(
                `nodes.${node.nodeKey}.modelId`,
                `Workflow node "${node.label}" and its selected route use different models.`,
                "Update the node model or select a route for the same model.",
            );
        }
        if (
            node.reasoningConfig?.effort !==
            route.config.generation.reasoningEffort
        ) {
            throw routingRunError(
                `nodes.${node.nodeKey}.reasoningConfig`,
                `Workflow node "${node.label}" and its selected route use different reasoning settings.`,
                "Save the node with the reasoning setting captured by its route.",
            );
        }
        const needsJudgeSchema =
            nodeType === "judge" ||
            node.evalConfig.type === "judge" ||
            (node.evalConfig.type === "field_diff" &&
                node.evalConfig.fieldConfigs.some(
                    (field) => field.kind === "generative",
                ));
        if (
            needsJudgeSchema &&
            (route.config.structuredOutput.mode !== "json_schema" ||
                route.config.structuredOutput.schemaName !==
                    WORKFLOW_JUDGE_SCHEMA_NAME ||
                route.config.structuredOutput.schemaDigest !==
                    WORKFLOW_JUDGE_SCHEMA_DIGEST)
        ) {
            throw routingRunError(
                `nodes.${node.nodeKey}.llmExecutionSelection`,
                `Workflow node "${node.label}" invokes the canonical judge but its route does not capture that structured-output contract.`,
                "Create and select a route version using the canonical judge schema name and digest.",
            );
        }
        if (
            node.promptVersionId &&
            route.config.structuredOutput.mode === "json_schema" &&
            promptSchemaHashes.get(node.promptVersionId) !==
                route.config.structuredOutput.schemaDigest
        ) {
            throw routingRunError(
                `nodes.${node.nodeKey}.promptVersionId`,
                `Workflow node "${node.label}" no longer matches the schema captured by its route.`,
                "Create a route version for the prompt's current schema.",
            );
        }
        resolved.set(node.id, {
            contractVersion: WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
            requestedSelection,
            routeId: route.routeId,
            routeVersionId: route.routeVersionId,
            routeVersion: route.routeVersion,
            route: route.config,
            credential: {
                providerKeyId: route.providerKeyId,
                rotationVersion: route.capturedRotationVersion,
                ...(route.credentialHint ? { hint: route.credentialHint } : {}),
            },
            capability: route.capabilitySnapshot,
        });
    }
    return resolved;
}

function simpleWorkflowRoute(
    transport: WorkflowLlmTransport,
    modelId: string,
    reasoningEffort: ReasoningEffort | undefined,
    isJudge: boolean,
): IWorkflowLlmRouteConfig {
    return {
        modelId,
        generation: {
            maxOutputTokens: 4096,
            ...(reasoningEffort ? { reasoningEffort } : {}),
        },
        transportConfig:
            transport === "gateway"
                ? {
                      transport,
                      upstreamPolicy: { mode: "gateway_auto" },
                      modelFallback: "disabled",
                  }
                : transport === "openrouter"
                  ? {
                        transport,
                        upstreamPolicy: { mode: "auto" },
                        requireParameters: false,
                        responseCache: "allow",
                    }
                  : transport === "bifrost"
                    ? { transport, upstreamPolicy: { mode: "bifrost_default" } }
                    : { transport },
        structuredOutput: isJudge
            ? {
                  mode: "json_schema",
                  schemaName: WORKFLOW_JUDGE_SCHEMA_NAME,
                  schemaDigest: WORKFLOW_JUDGE_SCHEMA_DIGEST,
                  strict: true,
              }
            : { mode: "text" },
        retry:
            transport === "gateway"
                ? { owner: "gateway", timeoutMs: 60_000 }
                : {
                      owner: "mosaic",
                      maxAttempts: 1,
                      timeoutMs: 60_000,
                      retryableErrorClasses: [],
                  },
        cache: { mosaicReuse: "force_fresh", providerCaching: "allow" },
    };
}

async function resolvedRouteRows(
    db: IDb,
    routeVersionIds: string[],
    teamId: string,
    projectId: string,
): Promise<IResolvedLlmRouteRow[]> {
    if (!routeVersionIds.length) return [];
    const result = await db.query<IResolvedLlmRouteRow>(
        `select
            v.id as "routeVersionId",
            v.route_id as "routeId",
            v.version as "routeVersion",
            v.config,
            v.provider_key_id as "providerKeyId",
            v.provider_key_rotation_version as "capturedRotationVersion",
            pk.rotation_version as "currentRotationVersion",
            pk.hint as "credentialHint",
            c.id as "capabilityVersionId",
            c.capability_digest as "capabilityDigest",
            c.capability_snapshot as "capabilitySnapshot",
            r.disabled_at as "disabledAt"
        from llm_route_versions v
        join llm_routes r
          on r.id = v.route_id
         and r.team_id = v.team_id
         and r.project_id = v.project_id
        join llm_capability_versions c
          on c.id = v.capability_version_id
         and c.team_id = v.team_id
         and c.project_id = v.project_id
        join provider_keys pk
          on pk.id = v.provider_key_id
         and pk.team_id = v.team_id
        where v.id = any($1::uuid[]) and v.team_id = $2 and v.project_id = $3
        for share of v, r, c, pk`,
        [routeVersionIds, teamId, projectId],
    );
    return result.rows;
}

function routingRunError(
    path: string,
    message: string,
    remediation: string,
): ApiFieldValidationError {
    return new ApiFieldValidationError(message, path, remediation);
}

export function validateMultiWorkflowRunInput(
    nodes: IWorkflowNode[],
    datasetId: string,
    datasetModality: "audio" | "image" | "text",
): void {
    for (const node of nodes) {
        if (node.nodeConfig?.type !== "input") continue;
        if (!node.nodeConfig.datasetId)
            throw new ApiBadRequestError(
                `Workflow input "${node.label}" must select a dataset before running.`,
            );
        if (node.nodeConfig.datasetId !== datasetId)
            throw new ApiBadRequestError(
                "Select the dataset configured by the workflow input block.",
            );
        if (node.nodeConfig.modality !== datasetModality)
            throw new ApiBadRequestError(
                `Workflow input "${node.label}" requires an ${node.nodeConfig.modality} dataset, but the selected dataset is ${datasetModality}.`,
            );
    }
}

export function validateWorkflowVisionCapabilities(
    nodes: IWorkflowNode[],
    edges: IWorkflowEdge[],
): void {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    for (const edge of edges) {
        const source = nodeById.get(edge.fromNodeId);
        const target = nodeById.get(edge.toNodeId);
        if (
            source?.nodeConfig?.type !== "input" ||
            source.nodeConfig.modality !== "image" ||
            !target?.modelId ||
            !["prompt", "llm_text", "judge"].includes(
                target.nodeType ?? "prompt",
            )
        )
            continue;
        if (!registryEntryFor(target.modelId)?.vision)
            throw new ApiBadRequestError(
                `${target.modelId} cannot run on image inputs because vision support is not available.`,
            );
    }
}

async function workflowConfigWithResolvedKeys(
    db: IDb,
    config: IApiConfig,
    teamId: string,
): Promise<IApiConfig> {
    const resolved = await resolveApiKeys(db, config, teamId);
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

export async function workflowRunProgressPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    workflowId: string,
    runId: string,
): Promise<IWorkflowRunProgressResponse> {
    const row = (
        await db.query<IWorkflowRunProgressResponse>(
            `select r.status,count(c.id)::int total,
                    count(c.id) filter(where c.status in ('succeeded','cached'))::int done,
                    count(c.id) filter(where c.status='failed')::int failed,
                    count(c.id) filter(where c.status in ('pending','running'))::int pending
             from workflow_runs r
             left join workflow_run_cells c on c.workflow_run_id=r.id
             where r.id=$1 and r.workflow_id=$2 and r.team_id=$3 and r.project_id=$4
             group by r.status`,
            [runId, workflowId, teamId, projectId],
        )
    ).rows[0];
    if (!row) throw new ApiNotFoundError("Workflow run not found.");
    return row;
}

export async function workflowRunSummaryPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    workflowId: string,
    runId: string,
) {
    const run = (
        await db.query<{
            id: string;
            dataset_id: string;
            target_item_id: string | null;
            status: RunStatus;
            run_target: WorkflowRunTarget;
            created_at: Date | string;
        }>(
            `select id,dataset_id,target_item_id,status,run_target,created_at
             from workflow_runs
             where id=$1 and workflow_id=$2 and team_id=$3 and project_id=$4
             limit 1`,
            [runId, workflowId, teamId, projectId],
        )
    ).rows[0];
    if (!run) throw new ApiNotFoundError("Workflow run not found.");
    const progress = await workflowRunProgressPayload(
        db,
        teamId,
        projectId,
        workflowId,
        runId,
    );
    return {
        run: {
            id: run.id,
            datasetId: run.dataset_id,
            targetItemId: run.target_item_id,
            status: run.status,
            runTarget: run.run_target,
            createdAt: iso(run.created_at),
        },
        progress,
    };
}

interface IWorkflowRunCellPageRow {
    id: string;
    dataset_item_id: string;
    node_key: string;
    status: CellStatus;
    input_text: string | null;
    output_json: unknown;
    latency_ms: number | null;
    cost_usd: number | null;
    error: string | null;
    cursor_created_at: string;
    annotation_verdict: ReviewVerdict | null;
    annotation_comment: string | null;
    scores: Array<{ scorerType: string; score: number | null }> | null;
}

type IWorkflowRunCellPageOptions = Pick<
    Parameters<typeof listWorkflowRunCellsPagePayload>[1],
    "includeInputText" | "includeOutput" | "includeReview" | "includeScores"
>;

function workflowRunCellPageProjection(options: IWorkflowRunCellPageOptions) {
    return {
        inputText: options.includeInputText ? "c.input_text" : "null::text",
        output: options.includeOutput ? "c.output_json" : "null::jsonb",
        reviewVerdict: options.includeReview
            ? "a.verdict"
            : "null::review_verdict",
        reviewComment: options.includeReview ? "a.comment" : "null::text",
        scores: options.includeScores
            ? "(select coalesce(json_agg(json_build_object('scorerType',s.scorer_type,'score',s.score) order by s.scorer_type),'[]'::json) from workflow_cell_scores s where s.workflow_run_cell_id=c.id)"
            : "null::json",
    };
}

function workflowRunCellPageOrder(
    order: "oldest_first" | "newest_first" | undefined,
) {
    const newestFirst = order === "newest_first";
    return {
        cursorOperator: newestFirst ? "<" : ">",
        direction: newestFirst ? "desc" : "asc",
    };
}

function workflowRunCellPageItem(
    row: IWorkflowRunCellPageRow,
    options: IWorkflowRunCellPageOptions,
) {
    return {
        id: row.id,
        itemId: row.dataset_item_id,
        nodeKey: row.node_key,
        status: row.status,
        latencyMs: row.latency_ms,
        costUsd: row.cost_usd,
        error: row.error,
        ...(options.includeInputText ? { inputText: row.input_text } : {}),
        ...(options.includeOutput ? { output: row.output_json } : {}),
        ...(options.includeReview
            ? {
                  review: row.annotation_verdict
                      ? {
                            verdict: row.annotation_verdict,
                            comment: row.annotation_comment ?? "",
                        }
                      : null,
              }
            : {}),
        ...(options.includeScores ? { scores: row.scores ?? [] } : {}),
    };
}

export async function listWorkflowRunCellsPagePayload(
    db: IDb,
    input: {
        teamId: string;
        projectId: string;
        workflowId: string;
        runId: string;
        limit: number;
        cursor?: { createdAt: string; id: string };
        itemId?: string;
        nodeKey?: string;
        status?: CellStatus;
        reviewVerdict?: ReviewVerdict;
        order?: "oldest_first" | "newest_first";
        includeInputText?: boolean;
        includeOutput?: boolean;
        includeReview?: boolean;
        includeScores?: boolean;
    },
) {
    const run = await db.query<{ id: string }>(
        `select id from workflow_runs
         where id=$1 and workflow_id=$2 and team_id=$3 and project_id=$4 limit 1`,
        [input.runId, input.workflowId, input.teamId, input.projectId],
    );
    if (!run.rows[0]) throw new ApiNotFoundError("Workflow run not found.");
    const projection = workflowRunCellPageProjection(input);
    const sort = workflowRunCellPageOrder(input.order);
    const result = await db.query<IWorkflowRunCellPageRow>(
        `select c.id,c.dataset_item_id,c.node_key,c.status,
                ${projection.inputText} as input_text,${projection.output} as output_json,
                c.latency_ms,c.cost_usd,c.error,
                ${projection.reviewVerdict} as annotation_verdict,
                ${projection.reviewComment} as annotation_comment,
                ${projection.scores} as scores,
                to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at
         from workflow_run_cells c
         left join workflow_run_cell_annotations a on a.workflow_run_cell_id=c.id
         where c.workflow_run_id=$1
           and ($2::uuid is null or c.dataset_item_id=$2)
           and ($3::text is null or c.node_key=$3)
           and ($4::cell_status is null or c.status=$4::cell_status)
           and ($5::review_verdict is null or coalesce(a.verdict,'unreviewed'::review_verdict)=$5::review_verdict)
           and ($6::timestamptz is null or (c.created_at,c.id)${sort.cursorOperator}($6::timestamptz,$7::uuid))
         order by c.created_at ${sort.direction},c.id ${sort.direction}
         limit $8`,
        [
            input.runId,
            input.itemId ?? null,
            input.nodeKey ?? null,
            input.status ?? null,
            input.reviewVerdict ?? null,
            input.cursor?.createdAt ?? null,
            input.cursor?.id ?? null,
            input.limit + 1,
        ],
    );
    const complete = result.rows.length <= input.limit;
    const rows = result.rows.slice(0, input.limit);
    return {
        cells: rows.map((row) => workflowRunCellPageItem(row, input)),
        complete,
        ...(complete || rows.length === 0
            ? {}
            : {
                  nextCursor: {
                      createdAt: rows.at(-1)!.cursor_created_at,
                      id: rows.at(-1)!.id,
                  },
              }),
    };
}

export async function listWorkflowRunsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    workflowId: string,
): Promise<IWorkflowRunSummary[]> {
    const result = await db.query<IWorkflowRunSummary>(
        `select r.id,
                r.workflow_id as "workflowId",
                r.dataset_id as "datasetId",
                d.name as "datasetName",
                r.status,
                r.run_target as "runTarget",
                count(c.*)::int as total,
                count(*) filter (where c.status in ('succeeded','cached'))::int as done,
                count(*) filter (where c.status = 'failed')::int as failed,
                r.created_at as "createdAt"
         from workflow_runs r
         join datasets d on d.id = r.dataset_id
         left join workflow_run_cells c on c.workflow_run_id = r.id
         where r.workflow_id = $1 and r.team_id = $2 and r.project_id = $3
         group by r.id, d.name
         order by r.created_at desc`,
        [workflowId, teamId, projectId],
    );
    return result.rows.map(workflowRunSummaryRow);
}

function workflowRunSummaryRow(row: IWorkflowRunSummary): IWorkflowRunSummary {
    return {
        id: row.id,
        workflowId: row.workflowId,
        datasetId: row.datasetId,
        datasetName: row.datasetName,
        status: row.status,
        runTarget: row.runTarget,
        total: row.total,
        done: row.done,
        failed: row.failed,
        createdAt: iso(row.createdAt),
    };
}

export async function listWorkflowRunSummariesPagePayload(
    db: IDb,
    teamId: string,
    projectId: string,
    workflowId: string,
    input: { limit: number; cursor?: { createdAt: string; id: string } },
) {
    const result = await db.query<
        IWorkflowRunSummary & { cursor_created_at: string }
    >(
        `select r.id,r.workflow_id as "workflowId",r.dataset_id as "datasetId",
                d.name as "datasetName",r.status,r.run_target as "runTarget",
                count(c.*)::int as total,
                count(*) filter (where c.status in ('succeeded','cached'))::int as done,
                count(*) filter (where c.status='failed')::int as failed,
                r.created_at as "createdAt",
                to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at
         from workflow_runs r
         join datasets d on d.id=r.dataset_id
         left join workflow_run_cells c on c.workflow_run_id=r.id
         where r.workflow_id=$1 and r.team_id=$2 and r.project_id=$3
           and ($4::timestamptz is null or (r.created_at,r.id)<($4::timestamptz,$5::uuid))
         group by r.id,d.name
         order by r.created_at desc,r.id desc
         limit $6`,
        [
            workflowId,
            teamId,
            projectId,
            input.cursor?.createdAt ?? null,
            input.cursor?.id ?? null,
            input.limit + 1,
        ],
    );
    const complete = result.rows.length <= input.limit;
    const rows = result.rows.slice(0, input.limit);
    return {
        workflowRuns: rows.map(workflowRunSummaryRow),
        complete,
        ...(complete || rows.length === 0
            ? {}
            : {
                  nextCursor: {
                      createdAt: rows.at(-1)!.cursor_created_at,
                      id: rows.at(-1)!.id,
                  },
              }),
    };
}

export async function workflowRunDetailPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    workflowId: string,
    runId: string,
): Promise<IWorkflowRunDetailResponse> {
    const run = (
        await db.query<IWorkflowRunRow>(
            `select id,team_id as "teamId",project_id as "projectId",workflow_id as "workflowId",dataset_id as "datasetId",target_item_id as "targetItemId",status,workflow_snapshot as "workflowSnapshot",run_target as "runTarget",created_at as "createdAt" from workflow_runs where id=$1 and workflow_id=$2 and team_id=$3 and project_id=$4`,
            [runId, workflowId, teamId, projectId],
        )
    ).rows[0];
    if (!run) throw new ApiNotFoundError("Workflow run not found.");
    const [
        cellsResult,
        itemsResult,
        scoresResult,
        sttItemsResult,
        sttScoresResult,
        noteResult,
        annotationsResult,
        progress,
    ] = await Promise.all([
        db.query<IWorkflowRunCell>(
            `select id,workflow_run_id as "workflowRunId",dataset_item_id as "datasetItemId",node_key as "nodeKey",status,input_text as "inputText",output_json as "outputJson",latency_ms as "latencyMs",cost_usd as "costUsd",error from workflow_run_cells where workflow_run_id=$1`,
            [runId],
        ),
        db.query<IWorkflowRunDetailResponse["items"][number]>(
            `select distinct i.id,i.type,i.input_text as "inputText",i.storage_key as "storageKey",i.mime_type as "mimeType" from dataset_items i join workflow_run_cells c on c.dataset_item_id=i.id where c.workflow_run_id=$1`,
            [runId],
        ),
        db.query<IScoreRow>(
            `select s.workflow_run_cell_id as "cellId",s.scorer_type as "scorerType",s.score,s.details_json as "detailsJson",s.rationale from workflow_cell_scores s join workflow_run_cells c on c.id=s.workflow_run_cell_id where c.workflow_run_id=$1`,
            [runId],
        ),
        db.query<IWorkflowSttPreparation>(
            `select wi.id,wi.workflow_run_id as "workflowRunId",wi.dataset_item_id as "datasetItemId",wi.selected_transcript as "selectedTranscript",wi.transcript_variant as "transcriptVariant",wi.detected_language as "detectedLanguage",wi.provider_id as "providerId",wi.route_id as "routeId",wi.stt_model_id as "sttModelId",wi.canonical_model_id as "canonicalModelId",wi.language,wi.config_hash as "configHash",wi.config_json as "configJson",wi.segments_json as segments,wi.speakers_json as speakers,wi.warnings,wi.provider_metadata as "providerMetadata",wi.artifact_latency_ms as "artifactLatencyMs",wi.artifact_cost_usd as "artifactCostUsd",wi.artifact_cost_source as "artifactCostSource",wi.lookup_latency_ms as "lookupLatencyMs",wi.transcription_latency_ms as "transcriptionLatencyMs",wi.transliteration_latency_ms as "transliterationLatencyMs",wi.incurred_cost_usd as "incurredCostUsd",wi.incurred_cost_source as "incurredCostSource",wi.cache_hit as "cacheHit",wi.preparation_status as "preparationStatus",wi.evaluation_status as "evaluationStatus",wi.claimed_at as "claimedAt",wi.lease_owner as "leaseOwner",wi.error
             from workflow_run_items wi
             join workflow_runs r on r.id=wi.workflow_run_id
             where r.id=$1 and r.workflow_id=$2 and r.team_id=$3 and r.project_id=$4
            order by wi.created_at,wi.id`,
            [runId, workflowId, teamId, projectId],
        ),
        db.query<IWorkflowSttScoreRow>(
            `select wi.dataset_item_id as "datasetItemId",s.scorer_type as "scorerType",s.status,s.score,s.details_json as "detailsJson",s.rationale,s.error
             from workflow_run_item_scores s
             join workflow_run_items wi on wi.id=s.workflow_run_item_id
             join workflow_runs r on r.id=wi.workflow_run_id
             where r.id=$1 and r.workflow_id=$2 and r.team_id=$3 and r.project_id=$4
            order by wi.created_at,wi.id,s.created_at,s.id`,
            [runId, workflowId, teamId, projectId],
        ),
        db.query<IWorkflowRunNoteRow>(
            `select body, updated_at, updated_by
             from workflow_run_notes
             where workflow_run_id = $1
             limit 1`,
            [runId],
        ),
        db.query<IWorkflowRunCellAnnotationRow>(
            `select a.workflow_run_cell_id,
                    a.verdict,
                    a.comment,
                    a.updated_at,
                    a.updated_by
             from workflow_run_cell_annotations a
             inner join workflow_run_cells c
                on c.id = a.workflow_run_cell_id
             where c.workflow_run_id = $1`,
            [runId],
        ),
        workflowRunProgressPayload(db, teamId, projectId, workflowId, runId),
    ]);
    const annotationsByCell = new Map(
        annotationsResult.rows.map((row) => [
            row.workflow_run_cell_id,
            {
                verdict: row.verdict,
                comment: row.comment,
                updatedAt: iso(row.updated_at),
                updatedBy: row.updated_by,
            },
        ]),
    );
    const nodesByKey = new Map(
        run.workflowSnapshot.nodes.map((node) => [node.nodeKey, node]),
    );
    const cells = cellsResult.rows.map((cell) => {
        const llmExecution = workflowRunCellLlmExecution(
            cell,
            nodesByKey.get(cell.nodeKey),
        );
        return {
            ...cell,
            ...(llmExecution ? { llmExecution } : {}),
            annotation: annotationsByCell.get(cell.id),
        };
    });
    const items = itemsResult.rows;
    const scores = scoresResult.rows;
    const sttItems = sttItemsResult.rows;
    const sttScores = sttScoresResult.rows;
    const noteRow = noteResult.rows[0];
    const note: IWorkflowRunNote | undefined = noteRow
        ? {
              body: noteRow.body,
              updatedAt: iso(noteRow.updated_at),
              updatedBy: noteRow.updated_by,
          }
        : undefined;
    const scoresByCell: Record<string, IWorkflowNodeScore[]> =
        Object.fromEntries(cells.map((cell) => [cell.id, []]));
    for (const { cellId, ...score } of scores)
        scoresByCell[cellId]?.push(score);
    const cellsByNode = new Map<string, IWorkflowRunCell[]>();
    for (const cell of cells)
        cellsByNode.set(cell.nodeKey, [
            ...(cellsByNode.get(cell.nodeKey) ?? []),
            cell,
        ]);
    const nodeAggregates: IWorkflowNodeAggregate[] =
        run.workflowSnapshot.nodes.map((node) => {
            const nodeCells = cellsByNode.get(node.nodeKey) ?? [];
            const numericScores = nodeCells
                .flatMap((cell) => scoresByCell[cell.id] ?? [])
                .filter(
                    (score) =>
                        score.scorerType === "field_diff" ||
                        score.scorerType === "judge",
                )
                .map((score) => score.score)
                .filter((score): score is number => typeof score === "number");
            const latencies = nodeCells
                .map((cell) => cell.latencyMs)
                .filter(
                    (latency): latency is number => typeof latency === "number",
                );
            return {
                nodeKey: node.nodeKey,
                completed: nodeCells.filter((cell) =>
                    (["succeeded", "cached"] as CellStatus[]).includes(
                        cell.status,
                    ),
                ).length,
                failed: nodeCells.filter((cell) => cell.status === "failed")
                    .length,
                averageScore: numericScores.length
                    ? numericScores.reduce((sum, score) => sum + score, 0) /
                      numericScores.length
                    : undefined,
                averageLatencyMs: latencies.length
                    ? latencies.reduce((sum, latency) => sum + latency, 0) /
                      latencies.length
                    : undefined,
                totalCostUsd: nodeCells.some(
                    (cell) => typeof cell.costUsd === "number",
                )
                    ? nodeCells.reduce(
                          (sum, cell) => sum + (cell.costUsd ?? 0),
                          0,
                      )
                    : undefined,
            };
        });
    const sttScoresByItem: Record<string, IWorkflowSttScore[]> =
        Object.fromEntries(sttItems.map((item) => [item.datasetItemId, []]));
    for (const { datasetItemId, ...score } of sttScores)
        sttScoresByItem[datasetItemId]?.push(score);
    const sttAggregates = (["transcript_metric", "transcript_judge"] as const)
        .map((scorerType) => workflowSttAggregate(scorerType, sttScores))
        .filter(
            (aggregate): aggregate is IWorkflowSttAggregate =>
                aggregate !== undefined,
        );
    return {
        workflowRun: {
            ...run,
            targetItemId: run.targetItemId ?? undefined,
            createdAt: iso(run.createdAt),
        },
        progress,
        nodes: run.workflowSnapshot.nodes,
        edges: run.workflowSnapshot.edges,
        items,
        cells,
        scoresByCell,
        nodeAggregates,
        sttItems,
        sttScoresByItem,
        sttAggregates,
        note,
    };
}

const REVIEW_VERDICTS = new Set<string>([
    "unreviewed",
    "approved",
    "needs_review",
    "issue",
]);

function isReviewVerdict(value: string): value is ReviewVerdict {
    return REVIEW_VERDICTS.has(value);
}
