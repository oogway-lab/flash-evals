import type {
    CellStatus,
    ICellAnnotation,
    IRunDetailItem,
    IRunProgress,
    IPipelineFieldConfig,
    ISttRunConfig,
    ISttTransliterationConfig,
    ReasoningEffort,
    RunStatus,
} from "./index.js";

export type WorkflowRunTarget = "single_item" | "dataset";
export type WorkflowKind = "prompt" | "stt" | "multi";
export type WorkflowNodeType =
    | "prompt"
    | "input"
    | "stt"
    | "llm_text"
    | "transliterate"
    | "judge"
    | "metric_compare";
export const WORKFLOW_MODEL_BACKED_NODE_TYPES = [
    "prompt",
    "llm_text",
    "transliterate",
    "judge",
] as const satisfies readonly WorkflowNodeType[];
const WORKFLOW_MODEL_BACKED_NODE_TYPE_SET = new Set<WorkflowNodeType>(
    WORKFLOW_MODEL_BACKED_NODE_TYPES,
);
export function isWorkflowModelBackedNodeType(
    nodeType: WorkflowNodeType,
): boolean {
    return WORKFLOW_MODEL_BACKED_NODE_TYPE_SET.has(nodeType);
}
export type WorkflowMetricReferenceField =
    "expectedTranscript" | "expectedTranscriptLatin";

export const WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION = 1 as const;
export const WORKFLOW_LLM_FINGERPRINT_VERSION = 1 as const;
export const WORKFLOW_JUDGE_SCHEMA_NAME = "judge_verdict" as const;
export const WORKFLOW_JUDGE_SCHEMA_DIGEST =
    "sha256:da6cc596e2b7c0e3927232ef8198bb54a7681076242488a5e3bcde85305fbc1c" as const;

export type WorkflowLlmTransport =
    "openai" | "gateway" | "openrouter" | "bifrost";

export type IWorkflowLlmSelection =
    /** Default path: invoke the selected provider model directly with the current team key. */
    | { mode: "simple"; transport: WorkflowLlmTransport }
    | { mode: "pinned_route"; routeVersionId: string }
    | { mode: "project_default" };

export interface IWorkflowLlmProjectDefault {
    projectId: string;
    routeVersionId: string;
}

export interface IWorkflowLlmGenerationConfig {
    maxOutputTokens: number;
    temperature?: number;
    topP?: number;
    seed?: number;
    reasoningEffort?: ReasoningEffort;
}

export type IWorkflowLlmStructuredOutputConfig =
    | { mode: "text" }
    | {
          mode: "json_schema";
          schemaName: string;
          schemaDigest: string;
          strict: boolean;
      };

export type WorkflowLlmRetryableErrorClass =
    "rate_limit" | "timeout" | "overloaded" | "upstream_unavailable";

export type IWorkflowLlmRetryPolicy =
    | {
          owner: "mosaic";
          maxAttempts: number;
          timeoutMs: number;
          retryableErrorClasses: WorkflowLlmRetryableErrorClass[];
      }
    | {
          owner: "gateway";
          timeoutMs: number;
      };

export interface IWorkflowLlmCachePolicy {
    mosaicReuse: "allow" | "force_fresh";
    /** Provider-managed caching cannot be disabled reliably across transports. */
    providerCaching: "allow";
}

export type IWorkflowOpenRouterProviderPolicy =
    | { mode: "auto" }
    | {
          mode: "preference";
          order: string[];
          allowFallbacks: boolean;
      }
    | {
          mode: "exact";
          only: string[];
      };

export type IWorkflowLlmTransportConfig =
    | { transport: "openai" }
    | {
          transport: "gateway";
          upstreamPolicy: { mode: "gateway_auto" };
          modelFallback: "disabled";
      }
    | {
          transport: "openrouter";
          upstreamPolicy: IWorkflowOpenRouterProviderPolicy;
          requireParameters: boolean;
          responseCache: "allow" | "disable";
      }
    | {
          transport: "bifrost";
          upstreamPolicy: { mode: "bifrost_default" };
      };

export interface IWorkflowLlmRouteConfig {
    transportConfig: IWorkflowLlmTransportConfig;
    modelId: string;
    generation: IWorkflowLlmGenerationConfig;
    structuredOutput: IWorkflowLlmStructuredOutputConfig;
    retry: IWorkflowLlmRetryPolicy;
    cache: IWorkflowLlmCachePolicy;
}

export type WorkflowLlmGenerationControl =
    "maxOutputTokens" | "temperature" | "topP" | "seed" | "reasoningEffort";

export interface IWorkflowLlmTransportCapability {
    transport: WorkflowLlmTransport;
    /** Flash Evals canonical model ID used in route configuration. */
    modelId?: string;
    transportModelId: string;
    upstreamRoutingModes: Array<"none" | "auto" | "preference" | "exact">;
    supportedGenerationControls: WorkflowLlmGenerationControl[];
    supportsStructuredOutput: boolean;
    requiresCurrentDiscovery: boolean;
}

export interface IWorkflowLlmCapabilitySnapshot {
    capabilityVersionId: string;
    capabilityDigest: string;
    capturedAt: string;
    stale: boolean;
    transport: IWorkflowLlmTransportCapability;
    supportedUpstreamProviders?: string[];
}

export interface IWorkflowLlmCredentialReference {
    providerKeyId: string;
    rotationVersion: string;
    hint?: string;
}

export interface IWorkflowLlmResolvedExecution {
    contractVersion: typeof WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION;
    requestedSelection: IWorkflowLlmSelection;
    routeId: string;
    routeVersionId: string;
    routeVersion: number;
    route: IWorkflowLlmRouteConfig;
    credential: IWorkflowLlmCredentialReference;
    capability: IWorkflowLlmCapabilitySnapshot;
}

export type WorkflowLlmActualRouteStatus =
    | "resolved"
    | "unresolved"
    | "unavailable"
    | "not_invoked"
    | "legacy_unresolved";

export interface IWorkflowLlmRouteIdentity {
    transport?: WorkflowLlmTransport;
    modelId?: string;
    upstreamProvider?: string;
}

export type IWorkflowLlmActualRoute =
    | {
          status: "resolved";
          identity: IWorkflowLlmRouteIdentity;
          generationId?: string;
          evidenceCompleteness: "complete" | "partial";
      }
    | {
          status: "unresolved";
          identity?: IWorkflowLlmRouteIdentity;
          generationId?: string;
          evidenceCompleteness: "partial" | "absent";
      }
    | {
          status: "unavailable" | "legacy_unresolved";
          evidenceCompleteness: "absent";
      }
    | {
          status: "not_invoked";
          generationId?: string;
          evidenceCompleteness: "complete";
      };

export interface IWorkflowLlmAttempt {
    sequence: number;
    owner: "mosaic" | "gateway";
    requested: IWorkflowLlmRouteIdentity;
    actual?: IWorkflowLlmActualRoute;
    outcome: "succeeded" | "failed";
    errorClass?: string;
    latencyMs?: number;
}

export interface IWorkflowLlmUsage {
    inputTokens?: number;
    outputTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
}

export type WorkflowLlmCostSource =
    | "provider_reported"
    | "gateway_reported"
    | "catalog_estimate"
    | "unavailable";

export type IWorkflowLlmCost =
    | {
          usd: number;
          source: Exclude<WorkflowLlmCostSource, "unavailable">;
      }
    | { source: "unavailable"; usd?: never };

export type IWorkflowLlmCacheProvenance =
    | { status: "miss" | "disabled" }
    | {
          status: "mosaic_reuse";
          fingerprintVersion: typeof WORKFLOW_LLM_FINGERPRINT_VERSION;
          fingerprint: string;
          sourceRunId?: string;
          sourceCellId?: string;
          artifactDigest: string;
      }
    | {
          status: "provider_cache";
          kind: "prompt" | "response";
          hit: boolean;
      };

export interface IWorkflowLlmExecutionProvenance {
    requested: IWorkflowLlmSelection;
    resolved: IWorkflowLlmResolvedExecution;
    actual: IWorkflowLlmActualRoute;
    attempts: IWorkflowLlmAttempt[];
    cache: IWorkflowLlmCacheProvenance;
    usage: IWorkflowLlmUsage;
    currentCost: IWorkflowLlmCost;
    currentLatencyMs?: number;
    originCost?: IWorkflowLlmCost;
    originLatencyMs?: number;
    safeProviderEvidence?: Record<string, unknown>;
}

export type IWorkflowRunCellLlmExecution =
    | {
          availability: "complete";
          requested: IWorkflowLlmSelection;
          resolved: IWorkflowLlmResolvedExecution;
          actual: IWorkflowLlmActualRoute;
          attempts: IWorkflowLlmAttempt[];
          cache: IWorkflowLlmCacheProvenance;
          usage: IWorkflowLlmUsage;
          currentCost: IWorkflowLlmCost;
          currentLatencyMs?: number;
          originCost?: IWorkflowLlmCost;
          originLatencyMs?: number;
      }
    | {
          availability: "partial";
          requested: IWorkflowLlmSelection;
          resolved: IWorkflowLlmResolvedExecution;
      }
    | {
          availability: "legacy_unavailable";
      };

export type IWorkflowNodeConfig =
    | { type: "prompt" }
    | {
          type: "input";
          modality: "audio" | "image" | "text";
          datasetId?: string;
      }
    | { type: "stt"; sttConfig: ISttRunConfig }
    | { type: "llm_text"; promptText: string }
    | {
          type: "transliterate";
          transliteration: ISttTransliterationConfig;
      }
    | { type: "judge"; rubricPrompt: string }
    | {
          type: "metric_compare";
          referenceField: WorkflowMetricReferenceField;
      };

export interface IWorkflowNodeArtifact {
    text: string;
    segments?: Array<{
        text: string;
        startMs?: number;
        endMs?: number;
        speaker?: string;
        language?: string;
    }>;
    language?: string;
    json?: Record<string, unknown>;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        thinkingTokens?: number;
        cacheReadTokens?: number;
        cacheWriteTokens?: number;
        totalTokens?: number;
        costUsd?: number;
    };
    executionProvenance?: IWorkflowLlmExecutionProvenance;
    providerMetadata?: Record<string, unknown>;
}
export interface IWorkflowNodePosition {
    x: number;
    y: number;
}

export type IWorkflowNodeEvalConfig =
    | { type: "none" }
    | {
          type: "judge";
          judgeConfigId?: string;
          judgePromptVersionId?: string;
      }
    | { type: "field_diff"; fieldConfigs: IPipelineFieldConfig[] };

export interface IWorkflowNode {
    id: string;
    workflowId: string;
    nodeKey: string;
    label: string;
    nodeType?: WorkflowNodeType;
    nodeConfig?: IWorkflowNodeConfig;
    promptVersionId?: string;
    modelId?: string;
    reasoningConfig?: { effort: ReasoningEffort };
    llmExecutionSelection?: IWorkflowLlmSelection;
    evalConfig: IWorkflowNodeEvalConfig;
    position?: IWorkflowNodePosition;
}

export interface IWorkflowEdge {
    id: string;
    workflowId: string;
    fromNodeId: string;
    toNodeId: string;
    carryOriginalInput: boolean;
}

export interface IPromptWorkflow {
    id: string;
    teamId: string;
    projectId: string;
    name: string;
    description: string;
    kind: WorkflowKind;
    sttConfig?: ISttRunConfig;
    createdAt: string;
    nodes: IWorkflowNode[];
    edges: IWorkflowEdge[];
}

export interface IWorkflowSummary {
    id: string;
    teamId: string;
    projectId: string;
    name: string;
    description: string;
    kind: WorkflowKind;
    createdAt: string;
    nodeCount: number;
}

interface IWorkflowNodeInputBase {
    nodeKey: string;
    label: string;
    reasoningConfig?: { effort: ReasoningEffort };
    /** Optional while legacy workflows are repaired; required to start new runs. */
    llmExecutionSelection?: IWorkflowLlmSelection;
    evalConfig: IWorkflowNodeEvalConfig;
    position?: IWorkflowNodePosition | null;
}

export type IWorkflowNodeInput = IWorkflowNodeInputBase &
    (
        | {
              nodeType?: "prompt";
              nodeConfig?: { type: "prompt" };
              promptVersionId: string;
              modelId: string;
          }
        | {
              nodeType: "input";
              nodeConfig: Extract<IWorkflowNodeConfig, { type: "input" }>;
              promptVersionId?: undefined;
              modelId?: undefined;
          }
        | {
              nodeType: "stt";
              nodeConfig: Extract<IWorkflowNodeConfig, { type: "stt" }>;
              promptVersionId?: undefined;
              modelId?: undefined;
          }
        | {
              nodeType: "llm_text";
              nodeConfig: Extract<IWorkflowNodeConfig, { type: "llm_text" }>;
              promptVersionId?: undefined;
              modelId: string;
          }
        | {
              nodeType: "transliterate";
              nodeConfig: Extract<
                  IWorkflowNodeConfig,
                  { type: "transliterate" }
              >;
              promptVersionId?: undefined;
              modelId?: string;
          }
        | {
              nodeType: "judge";
              nodeConfig: Extract<IWorkflowNodeConfig, { type: "judge" }>;
              promptVersionId?: undefined;
              modelId: string;
          }
        | {
              nodeType: "metric_compare";
              nodeConfig: Extract<
                  IWorkflowNodeConfig,
                  { type: "metric_compare" }
              >;
              promptVersionId?: undefined;
              modelId?: undefined;
          }
    );

export interface IWorkflowEdgeInput {
    fromNodeKey: string;
    toNodeKey: string;
    carryOriginalInput: boolean;
}

export type MultiWorkflowModality = "audio" | "image" | "text";

export interface ICreateMultiWorkflowSeedInput {
    modality: MultiWorkflowModality;
    datasetId?: string;
    sttModelId?: string;
}

export interface IMultiWorkflowSeed {
    nodes: IWorkflowNodeInput[];
    edges: IWorkflowEdgeInput[];
}

export function createMultiWorkflowSeed(
    input: ICreateMultiWorkflowSeedInput,
): IMultiWorkflowSeed {
    const sttModelId = input.sttModelId;
    const inputNode: IWorkflowNodeInput = {
        nodeKey: "input-1",
        label: "Input 1",
        nodeType: "input",
        nodeConfig: {
            type: "input",
            modality: input.modality,
            ...(input.datasetId ? { datasetId: input.datasetId } : {}),
        },
        evalConfig: { type: "none" },
    };
    if (input.modality !== "audio") {
        return { nodes: [inputNode], edges: [] };
    }
    if (!sttModelId) {
        throw new Error("An STT model is required for audio inputs.");
    }
    const sttNode: IWorkflowNodeInput = {
        nodeKey: "stt-1",
        label: "STT 1",
        nodeType: "stt",
        nodeConfig: {
            type: "stt",
            sttConfig: { modelId: sttModelId },
        },
        evalConfig: { type: "none" },
    };
    return {
        nodes: [inputNode, sttNode],
        edges: [
            {
                fromNodeKey: "input-1",
                toNodeKey: "stt-1",
                carryOriginalInput: false,
            },
        ],
    };
}

export interface ICreateWorkflowRequest {
    teamId: string;
    projectId: string;
    name: string;
    description?: string;
    kind?: WorkflowKind;
    sttConfig?: ISttRunConfig;
    nodes: IWorkflowNodeInput[];
    edges: IWorkflowEdgeInput[];
    createdBy: string;
}

export interface IUpdateWorkflowRequest {
    teamId: string;
    projectId: string;
    workflowId: string;
    name: string;
    description?: string;
    kind?: WorkflowKind;
    sttConfig?: ISttRunConfig | null;
    nodes: IWorkflowNodeInput[];
    edges: IWorkflowEdgeInput[];
}

export interface IDeleteWorkflowRequest {
    teamId: string;
    projectId: string;
    workflowId: string;
}

export interface ICreateWorkflowRunRequest {
    teamId: string;
    projectId: string;
    workflowId: string;
    datasetId: string;
    runTarget: WorkflowRunTarget;
    itemId?: string;
    sttConfig?: ISttRunConfig;
    /**
     * Caller-controlled retry key. Reusing it with the same request returns
     * the original durable run; reusing it with different intent conflicts.
     */
    idempotencyKey?: string;
    createdBy: string;
}

export interface ICreateWorkflowRunResponse {
    workflowRunId: string;
    enqueueStatus: "pending_enqueue" | "queued";
}

export interface IWorkflowRunSummary {
    id: string;
    workflowId: string;
    datasetId: string;
    datasetName: string;
    status: RunStatus;
    runTarget: WorkflowRunTarget;
    total: number;
    done: number;
    failed: number;
    createdAt: string;
}

export interface IWorkflowRunCell {
    id: string;
    workflowRunId: string;
    datasetItemId: string;
    nodeKey: string;
    status: CellStatus;
    inputText: string;
    outputJson?: IWorkflowNodeArtifact;
    /** Normalized safe routing evidence for model-backed workflow result views. */
    llmExecution?: IWorkflowRunCellLlmExecution;
    latencyMs?: number;
    costUsd?: number;
    annotation?: ICellAnnotation;
    error?: string;
}

export interface IWorkflowRunNote {
    body: string;
    updatedAt: string;
    updatedBy: string | null;
}

export interface IWorkflowNodeScore {
    scorerType:
        "field_diff" | "judge" | "transcript_metric" | "transcript_judge";
    score: number | null;
    rationale: string | null;
    detailsJson: unknown;
}

export interface IWorkflowNodeAggregate {
    nodeKey: string;
    completed: number;
    failed: number;
    averageScore?: number;
    averageLatencyMs?: number;
    totalCostUsd?: number;
}

export interface IWorkflowSnapshot {
    workflowId: string;
    name: string;
    kind?: WorkflowKind;
    nodes: Array<
        IWorkflowNode & {
            promptContent?: string;
            promptSchema?: {
                name: string;
                digest: string;
                strict: boolean;
                schema: Record<string, unknown>;
            };
            scoringConfig?: {
                modelId: string;
                rubricPrompt: string;
                declaredInputs: Array<
                    "task_input" | "candidate_output" | "reference"
                >;
                reasoningEffort?: ReasoningEffort;
            };
            /** Absent only on historical snapshots created before contract v1. */
            resolvedLlmExecution?: IWorkflowLlmResolvedExecution;
        }
    >;
    edges: IWorkflowEdge[];
    sttConfig?: ISttRunConfig;
}

export type WorkflowSttTranscriptVariant = "raw" | "latin";
export type WorkflowSttPreparationStatus =
    "pending" | "running" | "completed" | "error";
export type WorkflowSttEvaluationStatus =
    "pending" | "running" | "completed" | "partial" | "error" | "skipped";
export type WorkflowSttScoreStatus = "completed" | "skipped" | "error";
export type WorkflowSttScorerType = "transcript_metric" | "transcript_judge";
export type WorkflowSttReferenceKind =
    "human_gold" | "silver" | "prod_reference";

export interface IWorkflowSttPreparation {
    id: string;
    workflowRunId: string;
    datasetItemId: string;
    selectedTranscript?: string;
    transcriptVariant?: WorkflowSttTranscriptVariant;
    detectedLanguage?: string;
    providerId?: string;
    routeId?: string;
    sttModelId?: string;
    canonicalModelId?: string;
    language?: string;
    configHash?: string;
    configJson?: Record<string, unknown>;
    segments: Array<{
        text: string;
        startMs?: number;
        endMs?: number;
        speaker?: string;
        language?: string;
    }>;
    speakers: Array<{ id: string; label?: string }>;
    warnings: string[];
    providerMetadata?: {
        requestId?: string;
        providerMode?: string;
        providerBaseUrl?: string;
    };
    artifactLatencyMs?: number;
    artifactCostUsd?: number;
    artifactCostSource?: "computed" | "unavailable";
    lookupLatencyMs?: number;
    transcriptionLatencyMs?: number;
    transliterationLatencyMs?: number;
    incurredCostUsd?: number;
    incurredCostSource?: "computed" | "unavailable";
    cacheHit?: boolean;
    preparationStatus: WorkflowSttPreparationStatus;
    evaluationStatus: WorkflowSttEvaluationStatus;
    claimedAt?: string;
    leaseOwner?: string;
    error?: string;
}

export interface IWorkflowSttScore {
    scorerType: WorkflowSttScorerType;
    status: WorkflowSttScoreStatus;
    score: number | null;
    detailsJson?: {
        metricKind?: "mechanical_stt" | "llm_judge";
        referenceKind?: WorkflowSttReferenceKind;
        referenceField?: string;
        [key: string]: unknown;
    };
    rationale?: string;
    error?: string;
}

export interface IWorkflowSttAggregate {
    scorerType: WorkflowSttScorerType;
    scored: number;
    skipped: number;
    failed: number;
    averageScore?: number;
}

export interface IWorkflowRunDetailResponse {
    workflowRun: {
        id: string;
        teamId: string;
        projectId: string;
        workflowId: string;
        datasetId: string;
        status: RunStatus;
        runTarget: WorkflowRunTarget;
        targetItemId?: string;
        workflowSnapshot: IWorkflowSnapshot;
        createdAt: string;
    };
    progress: IRunProgress;
    nodes: IWorkflowNode[];
    edges: IWorkflowEdge[];
    items: IRunDetailItem[];
    cells: IWorkflowRunCell[];
    scoresByCell: Record<string, IWorkflowNodeScore[]>;
    nodeAggregates: IWorkflowNodeAggregate[];
    sttItems: IWorkflowSttPreparation[];
    sttScoresByItem: Record<string, IWorkflowSttScore[]>;
    sttAggregates: IWorkflowSttAggregate[];
    note?: IWorkflowRunNote;
}

export interface IWorkflowRunProgressResponse extends IRunProgress {
    status: RunStatus;
}
