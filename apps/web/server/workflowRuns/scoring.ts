import { getBareModelName, type ApiKeys } from "@mosaic/llm-core";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/client";
import {
    judgeConfigs,
    labels,
    promptVersions,
    workflowCellScores,
    workflowRunItemScores,
    workflowRunItems,
} from "../db/schema";
import type {
    IWorkflowSnapshotNode,
    LabelJson,
    OutputJson,
} from "../db/jsonTypes";
import {
    scoreOutput,
    type IJudgePromptScoringConfig,
} from "../scoring/scoreOutput";
import type { JudgeFn } from "../scoring/judgeFields";
import {
    judgeCompletionRequest,
    judgeOutcomeFromCompletion,
} from "../scoring/judge";
import { scoreTranscriptMetrics } from "../audio/metrics";
import type {
    ISttRunConfig,
    IWorkflowLlmExecutionProvenance,
} from "@mosaic/api-contract";
import type { ITranscriptArtifact } from "../audio/transcription";
import type { IWorkflowSttScoreDetails } from "../db/jsonTypes";
import { executeWorkflowLlmInvocation } from "./llmInvocation";
import { pricingFor } from "../llm/pricing";

interface IWorkflowScoringItem {
    id: string;
    inputText?: string | null;
    storageKey?: string | null;
}

export interface IWorkflowScoringContext {
    labelsByItemId: Map<string, LabelJson>;
    judgePromptsByNodeKey: Map<string, IJudgePromptScoringConfig>;
}

async function resolveLabel(
    itemId: string,
    context?: IWorkflowScoringContext,
): Promise<LabelJson | undefined> {
    if (context) return context.labelsByItemId.get(itemId);
    const [row] = await db
        .select({ labelJson: labels.labelJson })
        .from(labels)
        .where(eq(labels.datasetItemId, itemId))
        .limit(1);
    return row?.labelJson;
}

async function resolveJudgePrompt(
    node: IWorkflowSnapshotNode,
    context?: IWorkflowScoringContext,
): Promise<IJudgePromptScoringConfig | undefined> {
    if (node.evalConfig.type !== "judge") return undefined;
    if (context) return context.judgePromptsByNodeKey.get(node.nodeKey);
    if (node.evalConfig.judgeConfigId) {
        const [judge] = await db
            .select()
            .from(judgeConfigs)
            .where(eq(judgeConfigs.id, node.evalConfig.judgeConfigId))
            .limit(1);
        if (!judge) return undefined;
        return {
            modelId: judge.modelId,
            rubricPrompt: judge.rubricPrompt,
            declaredInputs: ["task_input", "candidate_output"],
            reasoningEffort: judge.reasoningConfig?.effort,
        };
    }
    if (!node.evalConfig.judgePromptVersionId) return undefined;
    const [version] = await db
        .select()
        .from(promptVersions)
        .where(eq(promptVersions.id, node.evalConfig.judgePromptVersionId))
        .limit(1);
    if (!version?.judgeSpec) return undefined;
    return {
        modelId: version.judgeSpec.modelId,
        rubricPrompt: version.content,
        declaredInputs: version.judgeSpec.declaredInputs,
        reasoningEffort: version.reasoningConfig?.effort,
    };
}

async function replaceCellScores(
    cellId: string,
    result: Awaited<ReturnType<typeof scoreOutput>>,
    executionProvenance?: IWorkflowLlmExecutionProvenance,
): Promise<void> {
    await db.transaction(async (tx) => {
        await tx
            .delete(workflowCellScores)
            .where(
                and(
                    eq(workflowCellScores.workflowRunCellId, cellId),
                    inArray(workflowCellScores.scorerType, [
                        "field_diff",
                        "judge",
                    ]),
                ),
            );
        const rows = [];
        if (result.fieldDiff)
            rows.push({
                workflowRunCellId: cellId,
                scorerType: "field_diff" as const,
                score: result.fieldDiff.score,
                detailsJson: result.fieldDiff.details,
            });
        if (result.judge)
            rows.push({
                workflowRunCellId: cellId,
                scorerType: "judge" as const,
                score: result.judge.score,
                detailsJson: executionProvenance
                    ? {
                          ...result.judge.details,
                          executionProvenance,
                      }
                    : result.judge.details,
                rationale: result.judge.rationale,
            });
        if (rows.length > 0) await tx.insert(workflowCellScores).values(rows);
    });
}

export async function loadWorkflowScoringContext(
    nodes: IWorkflowSnapshotNode[],
    itemIds: string[],
    needsTranscriptLabels = false,
): Promise<IWorkflowScoringContext> {
    const needsLabels =
        nodes.some((node) => node.evalConfig.type === "field_diff") ||
        needsTranscriptLabels;
    const labelRows =
        !needsLabels || itemIds.length === 0
            ? []
            : await db
                  .select({
                      datasetItemId: labels.datasetItemId,
                      labelJson: labels.labelJson,
                  })
                  .from(labels)
                  .where(inArray(labels.datasetItemId, itemIds));
    const judgeConfigIds = nodes.flatMap((node) =>
        node.evalConfig.type === "judge" &&
        !node.scoringConfig &&
        node.evalConfig.judgeConfigId
            ? [node.evalConfig.judgeConfigId]
            : [],
    );
    const promptVersionIds = nodes.flatMap((node) =>
        node.evalConfig.type === "judge" &&
        !node.scoringConfig &&
        node.evalConfig.judgePromptVersionId
            ? [node.evalConfig.judgePromptVersionId]
            : [],
    );
    const [judgeRows, versionRows] = await Promise.all([
        judgeConfigIds.length === 0
            ? []
            : db
                  .select()
                  .from(judgeConfigs)
                  .where(inArray(judgeConfigs.id, judgeConfigIds)),
        promptVersionIds.length === 0
            ? []
            : db
                  .select()
                  .from(promptVersions)
                  .where(inArray(promptVersions.id, promptVersionIds)),
    ]);
    const judgesById = new Map(judgeRows.map((judge) => [judge.id, judge]));
    const versionsById = new Map(
        versionRows.map((version) => [version.id, version]),
    );
    const judgePromptsByNodeKey = new Map<string, IJudgePromptScoringConfig>();
    for (const node of nodes) {
        if (node.evalConfig.type !== "judge") continue;
        if (node.scoringConfig) {
            judgePromptsByNodeKey.set(node.nodeKey, node.scoringConfig);
        } else if (node.evalConfig.judgeConfigId) {
            const judge = judgesById.get(node.evalConfig.judgeConfigId);
            if (judge)
                judgePromptsByNodeKey.set(node.nodeKey, {
                    modelId: judge.modelId,
                    rubricPrompt: judge.rubricPrompt,
                    declaredInputs: ["task_input", "candidate_output"],
                    reasoningEffort: judge.reasoningConfig?.effort,
                });
        } else if (node.evalConfig.judgePromptVersionId) {
            const version = versionsById.get(
                node.evalConfig.judgePromptVersionId,
            );
            if (version?.judgeSpec)
                judgePromptsByNodeKey.set(node.nodeKey, {
                    modelId: version.judgeSpec.modelId,
                    rubricPrompt: version.content,
                    declaredInputs: version.judgeSpec.declaredInputs,
                    reasoningEffort: version.reasoningConfig?.effort,
                });
        }
    }
    return {
        labelsByItemId: new Map(
            labelRows.map((row) => [row.datasetItemId, row.labelJson]),
        ),
        judgePromptsByNodeKey,
    };
}

async function replaceWorkflowItemScore(input: {
    workflowRunItemId: string;
    leaseOwner: string;
    scorerType: "transcript_metric" | "transcript_judge";
    status: "completed" | "skipped" | "error";
    score?: number | null;
    detailsJson?: IWorkflowSttScoreDetails;
    rationale?: string | null;
    error?: string | null;
}): Promise<void> {
    await db.transaction(async (tx) => {
        const [ownedItem] = await tx
            .select({ id: workflowRunItems.id })
            .from(workflowRunItems)
            .where(
                and(
                    eq(workflowRunItems.id, input.workflowRunItemId),
                    eq(workflowRunItems.leaseOwner, input.leaseOwner),
                ),
            )
            .for("update")
            .limit(1);
        if (!ownedItem) return;
        const { leaseOwner: _leaseOwner, ...score } = input;
        await tx
            .insert(workflowRunItemScores)
            .values(score)
            .onConflictDoUpdate({
                target: [
                    workflowRunItemScores.workflowRunItemId,
                    workflowRunItemScores.scorerType,
                ],
                set: {
                    status: input.status,
                    score: input.score ?? null,
                    detailsJson: input.detailsJson,
                    rationale: input.rationale ?? null,
                    error: input.error ?? null,
                    updatedAt: new Date(),
                },
            });
    });
}

export interface IWorkflowTranscriptScoringInput {
    ownership: {
        workflowRunItemId: string;
        leaseOwner: string;
    };
    candidate: {
        itemId: string;
        transcript: string;
        variant: "raw" | "latin";
        artifact: ITranscriptArtifact;
    };
    model: {
        sttModelId: string;
        providerId: string;
        routeId: string;
        configHash: string;
    };
    provenance: {
        latencyMs?: number;
        costUsd?: number;
        costSource?: "computed" | "unavailable";
    };
    evaluator: ISttRunConfig["evaluator"];
    apiKeys: ApiKeys;
    context: IWorkflowScoringContext;
}

type TranscriptScoringStatus = "completed" | "skipped" | "error";
type TranscriptScorerType = "transcript_metric" | "transcript_judge";

interface ITranscriptScoringJob {
    scorerType: TranscriptScorerType;
    run: () => Promise<TranscriptScoringStatus>;
}

export async function scoreWorkflowTranscriptItem(
    input: IWorkflowTranscriptScoringInput,
): Promise<void> {
    const { ownership, candidate } = input;
    const label = input.context.labelsByItemId.get(candidate.itemId);
    const jobs: ITranscriptScoringJob[] = [
        {
            scorerType: "transcript_metric",
            run: () => scoreMechanicalTranscript(input, label),
        },
        {
            scorerType: "transcript_judge",
            run: () => scoreTranscriptJudge(input, label),
        },
    ];
    const outcomes = await Promise.allSettled(jobs.map((job) => job.run()));
    const statuses = await Promise.all(
        outcomes.map((outcome, index) =>
            settleTranscriptScoringJob(jobs[index]!, outcome, ownership),
        ),
    );
    const errors = statuses.filter((status) => status === "error").length;
    const evaluationStatus =
        errors === 0
            ? "completed"
            : errors < statuses.length
              ? "partial"
              : "error";
    await db
        .update(workflowRunItems)
        .set({
            evaluationStatus,
            claimedAt: null,
            leaseOwner: null,
            error: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(workflowRunItems.id, ownership.workflowRunItemId),
                eq(workflowRunItems.leaseOwner, ownership.leaseOwner),
            ),
        );
}

async function scoreMechanicalTranscript(
    input: IWorkflowTranscriptScoringInput,
    label: LabelJson | undefined,
): Promise<TranscriptScoringStatus> {
    const { ownership, candidate, model, provenance } = input;
    const metric = scoreTranscriptMetrics({
        candidateText: candidate.transcript,
        candidateSegments: candidate.artifact.segments,
        label,
        variant: candidate.variant,
        sttModelId: model.sttModelId,
        providerId: model.providerId,
        routeId: model.routeId,
        configHash: model.configHash,
        latencyMsTotal: provenance.latencyMs,
        costUsd: provenance.costUsd,
        costSource: provenance.costSource,
    });
    await replaceWorkflowItemScore(
        metric
            ? {
                  workflowRunItemId: ownership.workflowRunItemId,
                  leaseOwner: ownership.leaseOwner,
                  scorerType: "transcript_metric",
                  status: "completed",
                  score: metric.score,
                  detailsJson: { ...metric.details },
              }
            : {
                  workflowRunItemId: ownership.workflowRunItemId,
                  leaseOwner: ownership.leaseOwner,
                  scorerType: "transcript_metric",
                  status: "skipped",
                  detailsJson: {
                      metricKind: "mechanical_stt",
                      transcriptVariant: candidate.variant,
                      reason: "missing_reference",
                  },
              },
    );
    return metric ? "completed" : "skipped";
}

async function scoreTranscriptJudge(
    input: IWorkflowTranscriptScoringInput,
    label: LabelJson | undefined,
): Promise<TranscriptScoringStatus> {
    if (!input.evaluator?.enabled) return "skipped";
    void label;
    throw new Error(
        "Workflow transcript judge requires an explicit evaluator route.",
    );
}

async function settleTranscriptScoringJob(
    job: ITranscriptScoringJob,
    outcome: PromiseSettledResult<TranscriptScoringStatus>,
    ownership: IWorkflowTranscriptScoringInput["ownership"],
): Promise<TranscriptScoringStatus> {
    if (outcome.status === "fulfilled") return outcome.value;
    const message =
        outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason);
    await replaceWorkflowItemScore({
        workflowRunItemId: ownership.workflowRunItemId,
        leaseOwner: ownership.leaseOwner,
        scorerType: job.scorerType,
        status: "error",
        error: message,
        detailsJson: { error: message },
    });
    return "error";
}

export async function scoreWorkflowCell(input: {
    cellId: string;
    node: IWorkflowSnapshotNode;
    item: IWorkflowScoringItem;
    output: unknown;
    apiKeys: ApiKeys;
    context?: IWorkflowScoringContext;
    teamId?: string;
    projectId?: string;
}): Promise<void> {
    if (input.node.evalConfig.type === "none") return;
    const fieldConfigs =
        input.node.evalConfig.type === "field_diff"
            ? input.node.evalConfig.fieldConfigs
            : [];
    const [label, judgePrompt] = await Promise.all([
        input.node.evalConfig.type === "field_diff"
            ? resolveLabel(input.item.id, input.context)
            : undefined,
        resolveJudgePrompt(input.node, input.context),
    ]);
    if (input.node.evalConfig.type === "judge" && !judgePrompt) return;
    const output =
        typeof input.output === "object" && input.output !== null
            ? (input.output as OutputJson)
            : { text: String(input.output) };
    const needsLlm =
        fieldConfigs.some((config) => config.kind === "generative") ||
        judgePrompt !== undefined;
    let scorerExecutionProvenance: IWorkflowLlmExecutionProvenance | undefined;
    const explicitJudge: JudgeFn | undefined = needsLlm
        ? async (judgeInput) => {
              if (
                  !input.node.resolvedLlmExecution ||
                  !input.teamId ||
                  !input.projectId
              )
                  throw new Error(
                      `Workflow scoring for node ${input.node.nodeKey} has no resolved LLM execution.`,
                  );
              if (
                  judgeInput.judgeModelId !==
                  getBareModelName(
                      input.node.resolvedLlmExecution.route.modelId,
                  )
              )
                  throw new Error(
                      `Workflow scoring model ${judgeInput.judgeModelId} does not match the resolved route model.`,
                  );
              const request = judgeCompletionRequest(judgeInput);
              const execution = await executeWorkflowLlmInvocation({
                  teamId: input.teamId,
                  projectId: input.projectId,
                  cellId: input.cellId,
                  nodeType: input.node.nodeType ?? "prompt",
                  execution: input.node.resolvedLlmExecution,
                  prompt: request.prompt,
                  system: request.system,
                  images: request.images,
                  responseSchema: request.responseSchema,
                  pricing: pricingFor(
                      input.node.resolvedLlmExecution.route.modelId,
                  ),
              });
              scorerExecutionProvenance =
                  execution.artifact.executionProvenance;
              return judgeOutcomeFromCompletion({
                  parsed: execution.artifact.json,
                  schemaViolation: execution.artifact.json === undefined,
              });
          }
        : undefined;
    const result = await scoreOutput(
        {
            output,
            label,
            fieldConfigs,
            inputText: input.item.inputText ?? undefined,
            hasImage: Boolean(input.item.storageKey),
            apiKeys: input.apiKeys,
            maxTokens:
                input.node.resolvedLlmExecution?.route.generation
                    .maxOutputTokens ?? 0,
            judgePrompt,
        },
        explicitJudge,
    );
    await replaceCellScores(input.cellId, result, scorerExecutionProvenance);
}
