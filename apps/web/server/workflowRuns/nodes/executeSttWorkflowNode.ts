import type { ApiKeys, EvalImage } from "@mosaic/llm-core";
import type { IWorkflowNodeArtifact } from "@mosaic/api-contract";
import { db } from "../../db/client";
import { workflowCellScores } from "../../db/schema";
import type { IWorkflowSnapshotNode, LabelJson } from "../../db/jsonTypes";
import { scoreTranscriptMetrics } from "../../audio/metrics";
import type { ISttProviderKeys } from "../../audio/providerKeys";
import { getOrCreateAudioTranscriptArtifactWithProvenance } from "../../audio/transcription";
import { pricingFor } from "../../llm/pricing";
import { isRecord } from "../../lib/objects";
import {
    judgeCompletionRequest,
    judgeOutcomeFromCompletion,
} from "../../scoring/judge";
import { executeWorkflowLlmInvocation } from "../llmInvocation";

export interface ISttNodeExecutionResult {
    artifact: IWorkflowNodeArtifact;
    latencyMs?: number;
    costUsd?: number;
}

interface ISttNodeItem {
    id: string;
    inputText?: string | null;
    storageKey?: string | null;
    mimeType?: string | null;
}

interface IExecuteSttWorkflowNodeInput {
    cell: { id: string };
    item: ISttNodeItem;
    node: IWorkflowSnapshotNode;
    inputText: string;
    images: EvalImage[];
    upstreamArtifact?: unknown;
    apiKeys: ApiKeys;
    sttProviderKeys: ISttProviderKeys;
    labelsByItemId: Map<string, LabelJson>;
    teamId: string;
    projectId: string;
}

export async function executeSttWorkflowNode(
    input: IExecuteSttWorkflowNodeInput,
): Promise<ISttNodeExecutionResult> {
    switch (input.node.nodeType ?? "prompt") {
        case "input":
            return executeInputNode(input);
        case "stt":
            return executeSttNode(input);
        case "llm_text":
            return executeLlmTextNode(input);
        case "transliterate":
            return executeTransliterationNode(input);
        case "judge":
            return executeJudgeNode(input);
        case "metric_compare":
            return executeMetricNode(input);
        case "prompt":
            throw new Error(
                "Prompt nodes are not valid in STT eval workflows.",
            );
        default:
            throw new Error(
                `Unsupported workflow node type: ${String(input.node.nodeType)}.`,
            );
    }
}

function executeInputNode(
    input: IExecuteSttWorkflowNodeInput,
): ISttNodeExecutionResult {
    const { node, item } = input;
    if (node.nodeConfig?.type !== "input")
        throw new Error(`Input node ${node.nodeKey} has invalid config.`);
    switch (node.nodeConfig.modality) {
        case "text":
            return { artifact: { text: item.inputText ?? "" } };
        case "image":
            if (!item.storageKey || !item.mimeType)
                throw new Error(
                    `Input node ${node.nodeKey} requires stored image bytes.`,
                );
            return {
                artifact: { text: `[Image input: ${item.mimeType}]` },
            };
        case "audio":
            if (!item.storageKey || !item.mimeType)
                throw new Error(
                    `Input node ${node.nodeKey} requires stored audio bytes.`,
                );
            return {
                artifact: { text: `[Audio input: ${item.mimeType}]` },
            };
    }
}

async function executeSttNode(
    input: IExecuteSttWorkflowNodeInput,
): Promise<ISttNodeExecutionResult> {
    const { node, item } = input;
    if (node.nodeConfig?.type !== "stt")
        throw new Error(`STT node ${node.nodeKey} has invalid config.`);
    if (!item.storageKey || !item.mimeType)
        throw new Error(`STT node ${node.nodeKey} requires stored audio.`);
    const config = node.nodeConfig.sttConfig;
    const startedAt = Date.now();
    const result = await getOrCreateAudioTranscriptArtifactWithProvenance({
        datasetItemId: item.id,
        storageKey: item.storageKey,
        mimeType: item.mimeType,
        modelId: config.modelId,
        language: config.language,
        config: config.config,
        openaiApiKey: input.apiKeys.openai,
        aiGatewayApiKey: input.apiKeys.gateway,
        sonioxApiKey: input.sttProviderKeys.soniox,
        geminiApiKey: input.sttProviderKeys.gemini,
        openrouterApiKey: input.sttProviderKeys.openrouter,
    });
    return {
        artifact: {
            text: result.artifact.text,
            segments: result.artifact.segments,
            language: result.artifact.detectedLanguage,
            providerMetadata: result.artifact.providerMetadata
                ? { ...result.artifact.providerMetadata }
                : undefined,
            usage: result.artifact.providerMetadata?.usage
                ? {
                      promptTokens:
                          result.artifact.providerMetadata.usage.inputTokens,
                      completionTokens:
                          result.artifact.providerMetadata.usage.outputTokens,
                      thinkingTokens:
                          result.artifact.providerMetadata.usage.thinkingTokens,
                      totalTokens:
                          result.artifact.providerMetadata.usage.totalTokens,
                  }
                : undefined,
        },
        latencyMs: Date.now() - startedAt,
        ...(result.artifact.providerMetadata?.costUsd !== undefined
            ? { costUsd: result.artifact.providerMetadata.costUsd }
            : {}),
    };
}

async function executeLlmTextNode(
    input: IExecuteSttWorkflowNodeInput,
): Promise<ISttNodeExecutionResult> {
    const { node } = input;
    if (node.nodeConfig?.type !== "llm_text" || !node.resolvedLlmExecution)
        throw new Error(`LLM text node ${node.nodeKey} has invalid config.`);
    return executeWorkflowLlmInvocation({
        teamId: input.teamId,
        projectId: input.projectId,
        cellId: input.cell.id,
        nodeType: "llm_text",
        execution: node.resolvedLlmExecution,
        prompt: `${node.nodeConfig.promptText}\n\n${input.inputText}`,
        images: input.images,
        pricing: pricingFor(node.resolvedLlmExecution.route.modelId),
    });
}

async function executeTransliterationNode(
    input: IExecuteSttWorkflowNodeInput,
): Promise<ISttNodeExecutionResult> {
    const { node, item } = input;
    if (
        node.nodeConfig?.type !== "transliterate" ||
        !item.storageKey ||
        !node.resolvedLlmExecution
    )
        throw new Error(
            `Transliteration node ${node.nodeKey} has invalid config.`,
        );
    const config = node.nodeConfig.transliteration;
    return executeWorkflowLlmInvocation({
        teamId: input.teamId,
        projectId: input.projectId,
        cellId: input.cell.id,
        nodeType: "transliterate",
        execution: node.resolvedLlmExecution,
        system:
            config.prompt?.trim() ||
            "Transliterate the transcript into Latin script. Preserve meaning, punctuation, numbers, and line breaks. Return only the transliterated transcript.",
        prompt: [
            `Target script: ${config.targetScript}`,
            config.targetLanguage
                ? `Target language: ${config.targetLanguage}`
                : undefined,
            "",
            "<transcript>",
            input.inputText,
            "</transcript>",
        ]
            .filter((part): part is string => part !== undefined)
            .join("\n"),
        pricing: pricingFor(node.resolvedLlmExecution.route.modelId),
    });
}

async function executeJudgeNode(
    input: IExecuteSttWorkflowNodeInput,
): Promise<ISttNodeExecutionResult> {
    const { node } = input;
    if (node.nodeConfig?.type !== "judge" || !node.resolvedLlmExecution)
        throw new Error(`Judge node ${node.nodeKey} has invalid config.`);
    const upstream = isRecord(input.upstreamArtifact)
        ? input.upstreamArtifact
        : undefined;
    const judgeRequest = judgeCompletionRequest({
        judgeModelId: node.resolvedLlmExecution.route.modelId,
        rubricPrompt: node.nodeConfig.rubricPrompt,
        apiKeys: {},
        inputText: input.item.inputText ?? undefined,
        hasImage: Boolean(input.images.length),
        images: input.images,
        output: upstream?.json ?? upstream?.text ?? input.inputText,
        label: input.labelsByItemId.get(input.item.id),
    });
    const execution = await executeWorkflowLlmInvocation({
        teamId: input.teamId,
        projectId: input.projectId,
        cellId: input.cell.id,
        nodeType: "judge",
        execution: node.resolvedLlmExecution,
        prompt: judgeRequest.prompt,
        system: judgeRequest.system,
        images: input.images,
        responseSchema: judgeRequest.responseSchema,
        pricing: pricingFor(node.resolvedLlmExecution.route.modelId),
    });
    const result = judgeOutcomeFromCompletion({
        parsed: execution.artifact.json,
        schemaViolation: execution.artifact.json === undefined,
    });
    if (!result.ok)
        throw new Error(`Judge node ${node.nodeKey} returned no result.`);
    await writeTranscriptNodeScore({
        cellId: input.cell.id,
        scorerType: "transcript_judge",
        score: result.score,
        detailsJson: {
            metricKind: "llm_judge",
            modelId: node.resolvedLlmExecution.route.modelId,
            rubricPrompt: node.nodeConfig.rubricPrompt,
            criteria: result.criteria,
            winner: result.winner,
        },
        rationale: result.rationale,
    });
    return {
        ...execution,
        artifact: {
            ...execution.artifact,
            text: result.rationale,
            json: {
                score: result.score,
                criteria: result.criteria,
                winner: result.winner,
            },
        },
    };
}

async function executeMetricNode(
    input: IExecuteSttWorkflowNodeInput,
): Promise<ISttNodeExecutionResult> {
    const { node } = input;
    if (node.nodeConfig?.type !== "metric_compare")
        throw new Error(`Metric node ${node.nodeKey} has invalid config.`);
    const referenceField = node.nodeConfig.referenceField;
    const reference = input.labelsByItemId.get(input.item.id)?.[referenceField];
    const metric = scoreTranscriptMetrics({
        candidateText: input.inputText,
        candidateSegments: (input.upstreamArtifact as IWorkflowNodeArtifact)
            ?.segments,
        label:
            typeof reference === "string"
                ? { [referenceField]: reference }
                : undefined,
        variant: referenceField === "expectedTranscriptLatin" ? "latin" : "raw",
    });
    await writeTranscriptNodeScore({
        cellId: input.cell.id,
        scorerType: "transcript_metric",
        score: metric?.score ?? null,
        detailsJson: metric?.details ?? {
            metricKind: "mechanical_stt",
            referenceField,
            reason: "missing_reference",
        },
    });
    return {
        artifact: {
            text: metric ? String(metric.score) : "",
            json: metric?.details ? { ...metric.details } : undefined,
        },
    };
}

async function writeTranscriptNodeScore(input: {
    cellId: string;
    scorerType: "transcript_metric" | "transcript_judge";
    score: number | null;
    detailsJson?: unknown;
    rationale?: string | null;
}): Promise<void> {
    const { cellId, ...score } = input;
    await db
        .insert(workflowCellScores)
        .values({ workflowRunCellId: cellId, ...score });
}
