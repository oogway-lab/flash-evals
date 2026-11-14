import type {
    IPipelineComparison,
    IPipelineComparisonConfig,
} from "./pipelineComparison.js";
import type {
    IPipelineFinalAnswer,
    IWorkflowRunAnswer,
    WorkflowRunCondition,
} from "./pipelineSteps.js";
import type {
    CellStatus,
    ICellAnnotation,
    IRunDetailItem,
    IRunProgress,
    IPipelineFieldConfig,
    IRunDataPolicy,
    ISttRunConfig,
    ISttTransliterationConfig,
    IThinkingOutcome,
    ReasoningEffort,
    RunStatus,
    RunStopReason,
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

/**
 * Transports a workflow LLM step can call. "anthropic" and "google" call the
 * model's maker directly (Anthropic, the Gemini API) with the team's Settings
 * key, the same way eval runs do.
 */
export const WORKFLOW_LLM_TRANSPORTS = [
    "openai",
    "gateway",
    "openrouter",
    "bifrost",
    "anthropic",
    "google",
] as const;

export type WorkflowLlmTransport = (typeof WORKFLOW_LLM_TRANSPORTS)[number];

/** Workflow transports served by the model's maker itself. */
export type WorkflowDirectMakerTransport = "anthropic" | "google";

export function isWorkflowLlmTransport(
    value: unknown,
): value is WorkflowLlmTransport {
    return (WORKFLOW_LLM_TRANSPORTS as readonly unknown[]).includes(value);
}

/**
 * The Settings key a workflow transport authenticates with. Direct Gemini API
 * calls use the saved Gemini key; every other transport has its own key.
 */
export function providerKeyForWorkflowTransport(
    transport: WorkflowLlmTransport,
): Exclude<WorkflowLlmTransport, "google"> | "gemini" {
    return transport === "google" ? "gemini" : transport;
}

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
          owner: "flash-evals";
          maxAttempts: number;
          timeoutMs: number;
          retryableErrorClasses: WorkflowLlmRetryableErrorClass[];
      }
    | {
          owner: "gateway";
          timeoutMs: number;
      };

export interface IWorkflowLlmCachePolicy {
    flashEvalsReuse: "allow" | "force_fresh";
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
      }
    /** Direct call to the maker: no gateway, so no upstream routing. */
    | { transport: "anthropic" }
    | { transport: "google" };

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

/**
 * The credential reference of a step whose key comes from the server's
 * environment (see WORKFLOW_ENV_KEYS, e.g. `AI_GATEWAY_API_KEY` or
 * `BIFROST_API_KEY` in apps/api/.env), not from Settings. Like
 * an eval run, it records no key id: the worker uses the environment's key
 * when the step runs. A key saved in Settings always wins over it.
 */
export const WORKFLOW_ENV_CREDENTIAL = {
    providerKeyId: "env",
    rotationVersion: "env",
    hint: "key from the server's .env",
} as const satisfies IWorkflowLlmCredentialReference;

/** Whether a step's key comes from the server's environment, not Settings. */
export function isWorkflowEnvCredential(
    credential: Pick<IWorkflowLlmCredentialReference, "providerKeyId">,
): boolean {
    return credential.providerKeyId === WORKFLOW_ENV_CREDENTIAL.providerKeyId;
}

/** Where a transport's key comes from in the server's environment. */
export interface IWorkflowEnvKeySource {
    /** The provider's name in messages. */
    label: string;
    /** The env variable holding the key. */
    apiKeyEnv: string;
    /** The env variable holding the address, when the transport needs one. */
    baseUrlEnv?: string;
}

/**
 * Transports whose key may come from the server's environment (apps/api/.env)
 * when none is saved in Settings, on the pipeline side, the same variables
 * eval runs read. OpenAI and OpenRouter keys from the environment are not
 * used by pipeline steps; their keys must be saved in Settings.
 */
export const WORKFLOW_ENV_KEYS = {
    gateway: { label: "Vercel AI Gateway", apiKeyEnv: "AI_GATEWAY_API_KEY" },
    bifrost: {
        label: "Bifrost",
        apiKeyEnv: "BIFROST_API_KEY",
        baseUrlEnv: "BIFROST_BASE_URL",
    },
} as const satisfies Partial<
    Record<WorkflowLlmTransport, IWorkflowEnvKeySource>
>;

/** The env variables a transport's key may come from, if any. */
export function workflowEnvKeySource(
    transport: WorkflowLlmTransport,
): IWorkflowEnvKeySource | undefined {
    return (
        WORKFLOW_ENV_KEYS as Partial<
            Record<WorkflowLlmTransport, IWorkflowEnvKeySource>
        >
    )[transport];
}

/** Whether a transport's key may come from the server's environment. */
export function workflowTransportAcceptsEnvKey(
    transport: WorkflowLlmTransport,
): boolean {
    return workflowEnvKeySource(transport) !== undefined;
}

/**
 * Names the env key a transport uses, for messages: "the Vercel AI Gateway
 * key from the server's .env (AI_GATEWAY_API_KEY)".
 */
export function describeWorkflowEnvKey(source: IWorkflowEnvKeySource): string {
    const vars = source.baseUrlEnv
        ? `${source.apiKeyEnv} and ${source.baseUrlEnv}`
        : source.apiKeyEnv;
    return `the ${source.label} key from the server's .env (${vars})`;
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
    owner: "flash-evals" | "gateway";
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
    /** Priced at the price Bifrost's model list gives the id it was sent as. */
    | "bifrost_list_price"
    /** Priced at the model registry's list price. */
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
          status: "flash_evals_reuse";
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
    /** Whether the step's thinking level was sent with its call. */
    thinking?: IThinkingOutcome;
    /**
     * Plain-words notes about the step's call, e.g. an output limit above
     * what the model can give (from Bifrost's model list).
     */
    warnings?: string[];
    /** Why a skipped step did not run (no model call was made). */
    skipReason?: string;
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

/**
 * Per-step settings for a Prompt or LLM text step, sent on every call on
 * every provider. Unset values keep the step's route (or Simple mode's
 * default output limit; temperature is then not sent).
 */
export interface IWorkflowStepSettings {
    /** 0 to 2. Not sent to models that refuse temperature. */
    temperature?: number;
    /** Most output tokens per call, thinking included. */
    maxOutputTokens?: number;
    /**
     * How a step with an output schema asks for JSON: "json_schema" (the
     * default) has the provider enforce the schema; "json_object" asks for
     * any JSON object; "text" asks for nothing and reads the JSON object out
     * of the reply (code fences allowed). The schema checks the parsed answer
     * in the last two.
     */
    outputMode?: WorkflowStepOutputMode;
    /**
     * Builds the step's user message instead of the default `<input>` /
     * `<from node>` assembly: `{{input}}`, `{{input.<name>}}` (a tagged
     * section or JSON field of the item; `{{input.<name>.<field>}}` reads a
     * field of the JSON inside a section) and `{{Step.$.path}}` (an earlier
     * step's answer; `| pick:a,b` keeps some fields). See stepTemplates.
     */
    inputTemplate?: string;
}

export const WORKFLOW_STEP_OUTPUT_MODES = [
    "json_schema",
    "json_object",
    "text",
] as const;

export type WorkflowStepOutputMode =
    (typeof WORKFLOW_STEP_OUTPUT_MODES)[number];

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
    /** Run this step only when earlier steps' answers match (all conditions). */
    runCondition?: WorkflowRunCondition;
    /** Temperature and output limit for this step's calls. */
    stepSettings?: IWorkflowStepSettings;
}

export interface IWorkflowEdge {
    id: string;
    workflowId: string;
    fromNodeId: string;
    toNodeId: string;
    carryOriginalInput: boolean;
    /**
     * "Order only": the target step runs after the source (so it can be
     * gated by it) but reads the original input, not the source's answer.
     */
    orderOnly?: boolean;
}

export interface IPromptWorkflow {
    id: string;
    teamId: string;
    projectId: string;
    name: string;
    description: string;
    kind: WorkflowKind;
    sttConfig?: ISttRunConfig;
    /** How each item's final answer is assembled from step answers. */
    finalAnswer?: IPipelineFinalAnswer;
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
    /** Run this step only when earlier steps' answers match (all conditions). */
    runCondition?: WorkflowRunCondition | null;
    /** Temperature and output limit for this step's calls; null clears them. */
    stepSettings?: IWorkflowStepSettings | null;
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
    /** Wait for the source step without passing its answer on. */
    orderOnly?: boolean;
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
    finalAnswer?: IPipelineFinalAnswer | null;
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
    /** Omit to keep the saved final answer; null removes it. */
    finalAnswer?: IPipelineFinalAnswer | null;
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
    /**
     * Spend limit in USD: the worker stops starting steps once the run's
     * recorded step, judge and transcription spend reaches it.
     */
    maxCostUsd?: number;
    /** Who may serve the run's step and judge calls and what they may keep. */
    dataPolicy?: IRunDataPolicy;
    /**
     * A completed eval run on the same dataset with a benchmark Task Map:
     * each item's final answer is scored against that run's reference with
     * its Task Map, policy, judge and data rules. Needs a final answer.
     */
    compareWithRunId?: string;
}

/** Run-level settings captured when a pipeline run is created. */
export interface IWorkflowRunConfig {
    maxCostUsd?: number;
    dataPolicy?: IRunDataPolicy;
    /** The eval run whose reference the final answers are compared with. */
    comparison?: IPipelineComparisonConfig;
}

export interface ICreateWorkflowRunResponse {
    workflowRunId: string;
    enqueueStatus: "pending_enqueue" | "queued";
}

/** Requeue a finished workflow run's failed cells, keeping successful ones. */
export interface IRetryWorkflowRunRequest {
    teamId: string;
    projectId: string;
    workflowId: string;
    workflowRunId: string;
}

export interface IRetryWorkflowRunResponse extends ICreateWorkflowRunResponse {
    /** Failed cells reset to pending, including blocked descendants. */
    retriedCellCount: number;
    /** False when there was nothing to queue: the run's job is still waiting. */
    requeued?: boolean;
}

/** Ask a pending or running pipeline run to stop. */
export type ICancelWorkflowRunRequest = IRetryWorkflowRunRequest;

export interface ICancelWorkflowRunResponse {
    workflowRunId: string;
    /** `cancelled` at once for a run no worker had started; otherwise unchanged until the worker stops. */
    status: RunStatus;
    stopReason?: RunStopReason;
}

export interface IWorkflowRunSummary {
    id: string;
    workflowId: string;
    datasetId: string;
    datasetName: string;
    status: RunStatus;
    /** Why a cancelled run stopped. */
    stopReason?: RunStopReason;
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
    /** What judging this step's answer cost, when a judge call reported it. */
    judgeCostUsd?: number;
    /** The hosting company that served this step's call, when the gateway said. */
    servedBy?: string;
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
    /** The final answer mapping, with the output schema captured at launch. */
    finalAnswer?: IPipelineFinalAnswer & {
        schema?: { digest: string; schema: Record<string, unknown> };
    };
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
        /** The audio was loudness-levelled before transcription. */
        volumeLevelled?: boolean;
        /** How the audio was prepared: version, levelling filter, chunks. */
        audioPreparation?: Record<string, unknown>;
    };
    artifactLatencyMs?: number;
    artifactCostUsd?: number;
    artifactCostSource?: "computed" | "unavailable";
    lookupLatencyMs?: number;
    transcriptionLatencyMs?: number;
    transliterationLatencyMs?: number;
    /** Known spend for this item; may be a lower bound, see the source. */
    incurredCostUsd?: number;
    /** "unavailable": some part's cost is unknown, incurredCostUsd is a floor. */
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
        /** The spend limit and data rules captured at creation. */
        configSnapshot?: IWorkflowRunConfig;
        /** Set once a stop was asked for; see RunStopReason. */
        stopReason?: RunStopReason;
        /** Why the run failed before any step started. */
        error?: string;
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
    /** Each item's final answer, when the pipeline defines one. */
    answers?: IWorkflowRunAnswer[];
    /** The comparison with the chosen eval run's reference, when one was chosen. */
    comparison?: IPipelineComparison;
    /**
     * On a completed run: final answers whose benchmark judge failed on a
     * task, which a retry judges again. Absent when there are none.
     */
    answersToRejudge?: number;
    note?: IWorkflowRunNote;
}

export interface IWorkflowRunProgressResponse extends IRunProgress {
    status: RunStatus;
    enqueueStatus?: "pending_enqueue" | "queued";
    /** Set once a stop was asked for, while the run is still winding down too. */
    stopReason?: RunStopReason;
    /** Why the run failed before any step started. */
    error?: string;
    /** For a pending run: when it was created or last queued. */
    pendingSince?: string;
}
