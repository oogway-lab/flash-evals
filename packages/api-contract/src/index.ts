import type { ILeaderboardRow, IRunBestModel } from "./leaderboard.js";
import type { BenchmarkTaskMethod } from "./benchmark.js";
import type { IPipelineComparisonRunOption } from "./pipelineComparison.js";
import type {
    ICancelSetupComparisonRequest,
    ICancelSetupComparisonResponse,
    ICreateSetupComparisonRequest,
    ICreateSetupComparisonResponse,
    ISetupComparison,
    ISetupComparisonPipelineOption,
} from "./setupComparison.js";
import type {
    IClearWorkflowLlmProjectDefaultRequest,
    ICreateWorkflowLlmRouteForModelRequest,
    ICreateWorkflowLlmRouteVersionRequest,
    IDisableWorkflowLlmRouteRequest,
    IRefreshWorkflowLlmCapabilitiesRequest,
    ISetWorkflowLlmProjectDefaultRequest,
    IWorkflowLlmCapability,
    IWorkflowLlmProjectDefaultMutation,
    IWorkflowLlmProjectDefaultResponse,
    IWorkflowLlmRoute,
    IWorkflowLlmRouteCandidatesResponse,
    IWorkflowLlmRouteHistoryResponse,
} from "./llm-routing.js";
import type {
    ICancelWorkflowRunRequest,
    ICancelWorkflowRunResponse,
    ICreateWorkflowRequest,
    ICreateWorkflowRunRequest,
    ICreateWorkflowRunResponse,
    IRetryWorkflowRunRequest,
    IRetryWorkflowRunResponse,
    IWorkflowRunSummary,
    IDeleteWorkflowRequest,
    IPromptWorkflow,
    IUpdateWorkflowRequest,
    IWorkflowRunDetailResponse,
    IWorkflowRunProgressResponse,
    IWorkflowSummary,
    WorkflowKind,
    WorkflowLlmTransport,
} from "./workflows.js";

export type {
    IClearWorkflowLlmProjectDefaultRequest,
    ICreateWorkflowLlmRouteForModelRequest,
    ICreateWorkflowLlmRouteVersionRequest,
    IDisableWorkflowLlmRouteRequest,
    IRefreshWorkflowLlmCapabilitiesRequest,
    ISetWorkflowLlmProjectDefaultRequest,
    IWorkflowLlmCapability,
    IWorkflowLlmProjectDefaultMutation,
    IWorkflowLlmProjectDefaultResponse,
    IWorkflowLlmProjectDefaultState,
    IWorkflowLlmRoute,
    IWorkflowLlmRouteCandidate,
    IWorkflowLlmRouteCandidateSupport,
    IWorkflowLlmRouteCandidatesResponse,
    IWorkflowLlmRouteHistoryResponse,
    IWorkflowLlmRouteVersion,
    WorkflowLlmModelProvider,
} from "./llm-routing.js";

export {
    canonicalJsonObject,
    canonicalJsonString,
    canonicalJsonValue,
} from "./canonical-json.js";
export {
    benchmarkPathSegments,
    benchmarkTaskSource,
    benchmarkUsesSource,
    isJudgedTask,
    isRulesTask,
    isSelfScoredTask,
    pickClosestReplacement,
    proposeTaskMapFromSchema,
    RUBRIC_MAX_SCORE,
    RUBRIC_MIN_SCORE,
    rubricScoreToAgreement,
    RULE_PATTERN_MAX_LENGTH,
    summarizeBenchmarkComparison,
    taskMapNeedsJudge,
    taskPaths,
    validateTaskMap,
    valueAtBenchmarkPath,
    type BenchmarkSource,
    type BenchmarkTaskMethod,
    type BenchmarkVerdict,
    type IBenchmarkAgreementField,
    type IBenchmarkAgreementTask,
    type IBenchmarkCellDetails,
    type BenchmarkJudgeCostCovers,
    type IBenchmarkCellInput,
    type IBenchmarkClassResult,
    type IBenchmarkCriterion,
    type IBenchmarkCriterionScore,
    type IBenchmarkCriterionSummary,
    type IBenchmarkFieldAgreement,
    type IBenchmarkJudgeSpec,
    type IBenchmarkHeadToHeadTask,
    type IBenchmarkModelInput,
    type IBenchmarkModelSummary,
    type IBenchmarkRule,
    type IBenchmarkRuleResult,
    type IBenchmarkRulesTask,
    type IBenchmarkRubricTask,
    type IBenchmarkTask,
    type IBenchmarkTaskResult,
    type IBenchmarkTaskSummary,
    type IBenchmarkTextMatching,
    type IBenchmarkWordCount,
    type IRunBenchmarkConfig,
    type ITaskMap,
} from "./benchmark.js";
export { countWords, wordCountProblem, wordLimitText } from "./wordCount.js";
export {
    canonicalizePair,
    normalizeText,
    textSimilarity,
} from "./textMatching.js";
export {
    BENCHMARK_CONFIDENT_ITEMS,
    BENCHMARK_MIN_ITEMS,
    DEFAULT_BENCHMARK_POLICY,
    agreementInterval,
    assessModel,
    assessTask,
    differenceInterval,
    meanInterval,
    points,
    sampleSizeFor,
    wilsonInterval,
    type BenchmarkModelVerdict,
    type BenchmarkSampleSize,
    type BenchmarkTaskVerdict,
    type IBenchmarkModelAssessment,
    type IBenchmarkPolicy,
    type IBenchmarkTaskAssessment,
    type IBenchmarkTaskThreshold,
    type IRateInterval,
    type IReferenceComparison,
} from "./benchmarkVerdict.js";
import type {
    IBenchmarkModelSummary,
    IRunBenchmarkConfig,
    ITaskMap,
} from "./benchmark.js";
export {
    isEmailAllowedForDomain,
    isValidEmailAddress,
    normalizeEmailAddress,
} from "./email.js";
export {
    buildLeaderboardRows,
    pickBestModel,
    type IBestModelCandidate,
    type IRunBestModel,
    type ILeaderboardCell,
    type ILeaderboardModel,
    type ILeaderboardRow,
    type ILeaderboardScore,
} from "./leaderboard.js";

export interface IDashboardStats {
    datasetCount: number;
    promptCount: number;
    runCount: number;
    runningCount: number;
    hasDatasetWithSchema: boolean;
    hasGoldenLabels?: boolean;
    hasDatasetWithItems: boolean;
    hasPrompt: boolean;
}

export interface IClerkPrincipalIdentity {
    clerkUserId: string;
    email?: string;
    emailVerified: boolean;
    name?: string;
}

export interface IResolvePrincipalRequest {
    identity: IClerkPrincipalIdentity;
}

export interface IPrincipalResponse {
    userId: string;
    teamId: string;
    defaultWorkspaceId?: string;
}

export interface IDatasetListRow {
    id: string;
    name: string;
    purpose: "golden" | "evaluation";
    modality: "audio" | "image" | "text";
    createdAt: string;
    itemCount: number;
    labeledItemCount: number;
    isRunnable: boolean;
    archived: boolean;
}

export interface IPromptListRow {
    id: string;
    name: string;
    description: string | null;
    kind: "eval" | "judge";
    latest?: {
        version: number;
        status: "legacy" | "runnable";
        createdAt: string;
        optimizedWithAi: boolean;
        /** See IPromptDetailVersion.modelCheck. */
        modelCheck?: PromptModelCheck;
    };
}

/**
 * Whether a runnable version's output was checked on a model when it was
 * saved: "checked" when Flash Evals ran it on sample input and it passed;
 * "not_checked" when it was saved runnable without that (for example
 * through the direct save endpoint).
 */
export type PromptModelCheck = "checked" | "not_checked";

export interface IPromptDetailResponse {
    prompt: {
        id: string;
        name: string;
        description: string | null;
        kind: "eval" | "judge";
    };
    latestVersion?: IPromptDetailVersion;
    schemaVersion?: {
        jsonSchema: unknown;
    };
    versions: IPromptDetailVersion[];
}

export interface IPromptDetailVersion {
    id: string;
    version: number;
    status: "legacy" | "runnable";
    content: string;
    createdAt: string;
    schemaVersionId: string | null;
    optimizerAttemptId: string | null;
    /** Runnable eval versions: whether a model check passed when saved. */
    modelCheck?: PromptModelCheck;
}

export type RunStatus =
    "pending" | "running" | "completed" | "partial" | "failed" | "cancelled";

/**
 * Why an eval or pipeline run stopped before running every cell: someone
 * cancelled it, or its spend reached the run's `maxCostUsd`. The run ends
 * `cancelled` once the worker has stopped.
 */
export type RunStopReason = "cancelled" | "spend_cap";

/** The largest per-run spend limit the API accepts, in USD. */
export const MAX_RUN_COST_LIMIT_USD = 100_000;

/**
 * "skipped": a pipeline step whose run condition did not hold (or that
 * follows one) for this item. It made no model call and cost nothing.
 */
export type CellStatus =
    "pending" | "running" | "succeeded" | "failed" | "cached" | "skipped";

export {
    applyTemplateFilters,
    inputPart,
    inputTemplateErrors,
    parsePlaceholder,
    placeholderValue,
    renderTemplate,
    templatePlaceholderList,
    templateStepKey,
    templateStepNamed,
    templateText,
    type ITemplateFilter,
    type ITemplatePlaceholder,
    type ITemplateStep,
} from "./stepTemplates.js";
export {
    assembleFinalAnswer,
    finalAnswerErrors,
    formatFinalValue,
    isEmptyFinalValue,
    parseFinalValue,
    resolveFallback,
    templatePlaceholders,
    type FinalAnswerFallback,
    type IFinalAnswerValueMapping,
    type IFinalAnswerRule,
    type IFinalAnswerStepResult,
    type IPipelineFinalAnswer,
    type IPipelineFinalAnswerField,
    type IWorkflowRunAnswer,
    describeRunCondition,
    describeStepCondition,
    formatConditionValues,
    parseConditionValues,
    stepAnswerValue,
    stepConditionErrors,
    stepConditionHolds,
    runConditionErrors,
    runConditionFrom,
    runConditionList,
    STEP_INPUT_TEMPLATE_MAX_LENGTH,
    STEP_MAX_OUTPUT_TOKENS,
    stepSettingsErrors,
    type IWorkflowStepCondition,
    type IWorkflowStepConditionGroup,
    type WorkflowRunCondition,
    type WorkflowConditionValue,
} from "./pipelineSteps.js";
export {
    combineDataPolicies,
    PIPELINE_COMPARABLE_RUN_STATUSES,
    PIPELINE_COMPARISON_MODEL_ID,
    summarizePipelineComparison,
    type IPipelineAnswerScore,
    type IPipelineComparison,
    type IPipelineComparisonConfig,
    type IPipelineComparisonRunOption,
    type IPipelineReferenceCell,
} from "./pipelineComparison.js";
export {
    MAX_SETUP_COMPARISON_PIPELINES,
    markNotBeaten,
    pipelineRankingId,
    pipelineSetupLabel,
    pipelineStepOrder,
    setupAccuracy,
    setupComparisonStatus,
    summarizeSetupComparison,
    type ISetupRanking,
    type ISetupRankingCell,
    type ISetupRankingPipeline,
    type ISetupRankingRow,
    type ICancelSetupComparisonRequest,
    type ICancelSetupComparisonResponse,
    type ICreateSetupComparisonRequest,
    type ICreateSetupComparisonResponse,
    type ISetupComparison,
    type ISetupComparisonConfig,
    type ISetupComparisonMember,
    type ISetupComparisonPipelineOption,
    type ISetupComparisonPipelineStep,
} from "./setupComparison.js";

export type {
    ICancelWorkflowRunRequest,
    ICancelWorkflowRunResponse,
    ICreateMultiWorkflowSeedInput,
    ICreateWorkflowRequest,
    ICreateWorkflowRunRequest,
    ICreateWorkflowRunResponse,
    IDeleteWorkflowRequest,
    IMultiWorkflowSeed,
    IRetryWorkflowRunRequest,
    IRetryWorkflowRunResponse,
    IPromptWorkflow,
    IUpdateWorkflowRequest,
    IWorkflowEdge,
    IWorkflowEdgeInput,
    IWorkflowNode,
    IWorkflowNodePosition,
    IWorkflowNodeAggregate,
    IWorkflowNodeEvalConfig,
    IWorkflowNodeInput,
    IWorkflowStepSettings,
    WorkflowStepOutputMode,
    IWorkflowNodeScore,
    IWorkflowSnapshot,
    IWorkflowRunCell,
    IWorkflowRunCellLlmExecution,
    IWorkflowRunDetailResponse,
    IWorkflowRunNote,
    IWorkflowRunConfig,
    IWorkflowRunProgressResponse,
    IWorkflowRunSummary,
    IWorkflowSttAggregate,
    IWorkflowSttPreparation,
    IWorkflowSttScore,
    IWorkflowSummary,
    MultiWorkflowModality,
    WorkflowSttEvaluationStatus,
    WorkflowSttPreparationStatus,
    WorkflowSttReferenceKind,
    WorkflowSttScorerType,
    WorkflowSttScoreStatus,
    WorkflowSttTranscriptVariant,
    WorkflowRunTarget,
    WorkflowKind,
    WorkflowMetricReferenceField,
    WorkflowNodeType,
    IWorkflowNodeArtifact,
    IWorkflowNodeConfig,
    IWorkflowLlmActualRoute,
    IWorkflowLlmAttempt,
    IWorkflowLlmCachePolicy,
    IWorkflowLlmCacheProvenance,
    IWorkflowLlmCapabilitySnapshot,
    IWorkflowLlmCost,
    IWorkflowEnvKeySource,
    IWorkflowLlmCredentialReference,
    IWorkflowLlmExecutionProvenance,
    IWorkflowLlmGenerationConfig,
    IWorkflowLlmProjectDefault,
    IWorkflowLlmResolvedExecution,
    IWorkflowLlmRetryPolicy,
    IWorkflowLlmRouteConfig,
    IWorkflowLlmRouteIdentity,
    IWorkflowLlmSelection,
    IWorkflowLlmStructuredOutputConfig,
    IWorkflowLlmTransportCapability,
    IWorkflowLlmTransportConfig,
    IWorkflowLlmUsage,
    IWorkflowOpenRouterProviderPolicy,
    WorkflowLlmActualRouteStatus,
    WorkflowLlmCostSource,
    WorkflowLlmGenerationControl,
    WorkflowDirectMakerTransport,
    WorkflowLlmRetryableErrorClass,
    WorkflowLlmTransport,
} from "./workflows.js";
export {
    createMultiWorkflowSeed,
    isWorkflowLlmTransport,
    isWorkflowModelBackedNodeType,
    isWorkflowEnvCredential,
    providerKeyForWorkflowTransport,
    WORKFLOW_ENV_CREDENTIAL,
    WORKFLOW_ENV_KEYS,
    describeWorkflowEnvKey,
    workflowEnvKeySource,
    workflowTransportAcceptsEnvKey,
    WORKFLOW_LLM_TRANSPORTS,
    WORKFLOW_STEP_OUTPUT_MODES,
    WORKFLOW_MODEL_BACKED_NODE_TYPES,
    WORKFLOW_JUDGE_SCHEMA_DIGEST,
    WORKFLOW_JUDGE_SCHEMA_NAME,
    WORKFLOW_LLM_EXECUTION_CONTRACT_VERSION,
    WORKFLOW_LLM_FINGERPRINT_VERSION,
} from "./workflows.js";

export type ReviewVerdict =
    "unreviewed" | "approved" | "needs_review" | "issue";

export interface IRunProgress {
    total: number;
    done: number;
    failed: number;
    pending: number;
}

export interface IDashboardRun {
    id: string;
    status: RunStatus;
    /** Why a cancelled eval run stopped. */
    stopReason?: RunStopReason;
    createdAt: string;
    datasetId: string;
    datasetName: string;
    models: string[];
    progress: IRunProgress;
    /** Captured workflow identity for navigation to pipeline results. */
    workflow?: { id: string; kind: WorkflowKind };
    /** First line of the run note, used as the run's name. */
    noteTitle?: string;
}

export interface IRunListRow extends IDashboardRun {
    /** Average pipeline judge score; does not rank its sequential models. */
    workflowScore?: number;
    /** Top model by judge score (transcript score for STT runs), if scored. */
    best?: IRunBestModel;
}

export type ReasoningEffort =
    "none" | "minimal" | "low" | "medium" | "high" | "xhigh";

export interface IJsonSchemaObject {
    type?: unknown;
    properties?: unknown;
    required?: unknown;
    additionalProperties?: unknown;
    [key: string]: unknown;
}

export type FieldMatcherSpec =
    | { matcher: "exact" }
    | { matcher: "numeric_tolerance"; tolerance: number; relative?: boolean }
    | { matcher: "set_overlap" };

export type IPipelineFieldConfig =
    | { field: string; kind: "factual"; spec?: FieldMatcherSpec }
    | { field: string; kind: "generative"; rubric: string; modelId: string };

export interface IReasoningConfig {
    effort: ReasoningEffort;
}

export interface IRunModelPromptSnapshot {
    promptId: string;
    promptName: string;
    promptVersionId: string;
    promptVersion: number;
    schemaVersionId?: string;
    schemaVersion?: number;
    schemaHash?: string;
    fitTags: string[];
}

export interface IRunModelSpec {
    modelId: string;
    transport?: ProviderTransport;
    /**
     * The id sent to the provider when it isn't the registry's: a Bifrost
     * id from Bifrost's own model list (e.g. openrouter/openai/gpt-4o).
     */
    transportModelId?: string;
    promptVersionId?: string | null;
    schemaVersionId?: string;
    promptSnapshot?: IRunModelPromptSnapshot;
    reasoningConfig?: IReasoningConfig;
    /**
     * Sampling temperature sent on every call of this model (0 to 2).
     * Unset: the provider's default. A model that can't take it (OpenAI
     * reasoning models, Claude with thinking on) refuses the run.
     */
    temperature?: number;
    isReference: boolean;
}

/** Lowest and highest temperature an eval run's model may be given. */
export const RUN_TEMPERATURE_MIN = 0;
export const RUN_TEMPERATURE_MAX = 2;

/** Whether `value` is a temperature an eval run's model may be given. */
export function isRunTemperature(value: unknown): value is number {
    return (
        typeof value === "number" &&
        Number.isFinite(value) &&
        value >= RUN_TEMPERATURE_MIN &&
        value <= RUN_TEMPERATURE_MAX
    );
}

export type AudioRunMode = "stt_metrics" | "prompt_eval";

export const STT_METRICS_MODEL_PREFIX = "stt:";

/**
 * Marks `audio_transcripts.storage_key` rows that hold one chunk of a prepared
 * recording. Only the assembled row (the plain storage key) is a transcript of
 * the item; readers that list an item's transcripts exclude marked keys.
 */
export const TRANSCRIPT_CHUNK_KEY_MARKER = "#chunk/";

export function sttMetricsModelId(
    sttModelId: string,
    variantKey?: string,
): string {
    return `${STT_METRICS_MODEL_PREFIX}${sttModelId}${variantKey ? `#${variantKey}` : ""}`;
}

export function isSttMetricsModelId(modelId: string): boolean {
    return modelId.startsWith(STT_METRICS_MODEL_PREFIX);
}

export interface IParsedSttMetricsModelId {
    modelId: string;
    variantKey?: string;
}

export function parseSttMetricsModelId(
    syntheticId: string,
): IParsedSttMetricsModelId | undefined {
    if (!isSttMetricsModelId(syntheticId)) return undefined;
    const value = syntheticId.slice(STT_METRICS_MODEL_PREFIX.length);
    const separatorIndex = value.lastIndexOf("#");
    if (separatorIndex === -1) return { modelId: value };
    return {
        modelId: value.slice(0, separatorIndex),
        variantKey: value.slice(separatorIndex + 1) || undefined,
    };
}

/**
 * Only items whose stored answer has a given label, e.g. only the items
 * labelled "sales": the field is a benchmark task's (`taskKey`, a task with
 * one field) or a path into the stored answer (`path`). Every model in the
 * run, and every comparison built on it, uses the same items. Speech-to-text
 * metrics runs have no tasks, so they take `path` only.
 */
export interface IRunItemFilter {
    taskKey?: string;
    /** `$.a.b` notation; resolved from `taskKey` when only that is given. */
    path?: string;
    /** Compared as text, trimmed and ignoring case ("Sales" = "sales", true = "true"). */
    equals: string | number | boolean;
}

/** Whether a stored answer value matches an item filter's `equals`. */
export function itemFilterMatches(
    value: unknown,
    equals: IRunItemFilter["equals"],
): boolean {
    if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
    )
        return false;
    const text = (input: string | number | boolean) =>
        String(input).trim().toLowerCase();
    return text(value) === text(equals);
}

/** How many of a dataset's items an item filter's `path` and `equals` keep. */
export interface ICountItemFilterMatchesRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    path: string;
    equals: IRunItemFilter["equals"];
}

export interface ICountItemFilterMatchesResponse {
    /** Items whose stored answer matches, by `itemFilterMatches`. */
    matching: number;
    /** All the dataset's items. */
    total: number;
}

export interface ICreateRunRequest {
    /** Stable retry key, scoped to team/project/creator. Omit for a new run each time. */
    idempotencyKey?: string;
    teamId: string;
    projectId: string;
    datasetId: string;
    pipelineId?: string;
    models: IRunModelSpec[];
    maxTokens: number;
    judgeConfigId?: string;
    runJudge?: {
        modelId: string;
        transport?: ProviderTransport;
        rubricPrompt: string;
        reasoningConfig?: IReasoningConfig;
    };
    fieldConfigs: IPipelineFieldConfig[];
    createdBy: string;
    judgePromptVersionId?: string;
    sourceRunId?: string;
    sttConfig?: ISttRunConfig;
    sttVariants?: ISttRunVariant[];
    sttEvaluation?: ISttRunEvaluation;
    audioRunMode?: AudioRunMode;
    benchmark?: IRunBenchmarkConfig;
    dataPolicy?: IRunDataPolicy;
    /** Run on only the dataset's first N items (a pilot). */
    itemLimit?: number;
    /** Run only on items whose stored answer has one label; before itemLimit. */
    itemFilter?: IRunItemFilter;
    /**
     * Stop the run once its recorded spend (model and judge calls) reaches
     * this many USD. Calls already sent finish, so spend can go a little over.
     */
    maxCostUsd?: number;
}

/** A change to a stored answer made by reviewing a disagreement. */
export interface IAnswerDecision {
    path: string;
    /** "candidate": the model was right; "benchmark": the yardstick was. */
    choice: "candidate" | "benchmark";
    newValue: unknown;
    decidedAt: string;
    /** Set when the decision came from this run's answer. */
    fromThisRun: boolean;
}

/** One transcript where a model and its yardstick differ on a task. */
export interface IRunDisagreement {
    cellId: string;
    itemId: string;
    /** The item's source name, when it has one. */
    itemName?: string;
    inputText?: string;
    /** The model returned no usable answer; it counts as a miss. */
    failed?: boolean;
    error?: string;
    /** Rule-check tasks: the checks this answer broke and what broke them. */
    brokenRules?: Array<{ key: string; name: string; offending: string[] }>;
    /**
     * Rubric tasks: each criterion's 1–5 score, the reference model's on the
     * same transcript, and the judge's reason.
     */
    criterionScores?: Array<{
        key: string;
        name: string;
        score?: number;
        referenceScore?: number;
        reasoning?: string;
    }>;
    /** Agreement tasks: the fields that differ. */
    fields: Array<{
        path: string;
        matcher: string;
        score: number;
        candidate: unknown;
        benchmark: unknown;
        /** The dataset's stored answer at this path now, if any. */
        storedNow?: unknown;
    }>;
    /** Judged tasks: the judge's reasons, and both answers at the task's paths. */
    rationale?: string;
    /** Which letter the judge's notes use for the model's answer. */
    candidateLetter?: "A" | "B";
    candidateAnswer?: Record<string, unknown>;
    benchmarkAnswer?: Record<string, unknown>;
    /** Latest decision per path for this transcript. */
    decisions: IAnswerDecision[];
}

export interface IRunDisagreementsResponse {
    runModelId: string;
    modelId: string;
    taskKey: string;
    taskName: string;
    method: BenchmarkTaskMethod;
    /** What the model was compared with on this task. */
    yardstick: "model" | "labels";
    /** The reference model's ID, when the yardstick is its answers. */
    referenceModelId?: string;
    /** Transcripts compared on this task. */
    compared: number;
    disagreements: IRunDisagreement[];
}

export interface IDecideDisagreementRequest {
    teamId: string;
    projectId: string;
    runId: string;
    cellId: string;
    taskKey: string;
    path: string;
    choice: "candidate" | "benchmark";
    decidedBy: string;
}

export interface IDecideDisagreementResponse {
    itemId: string;
    path: string;
    newValue: unknown;
}

export interface ICreateRunResponse {
    runId: string;
    /** A durable run is recoverable even if queue publication is deferred. */
    enqueueStatus?: "pending_enqueue" | "queued";
}

export interface IPromptAssignment {
    modelId: string;
    promptVersionId: string;
}

export interface IReasoningConfigAssignment {
    modelId: string;
    reasoningConfig?: IReasoningConfig;
}

/** A temperature (0 to 2) for one selected model; see IRunModelSpec.temperature. */
export interface ITemperatureAssignment {
    modelId: string;
    temperature: number;
}

export type ProviderTransport =
    "openai" | "gateway" | "openrouter" | "bifrost" | "anthropic" | "google";

/**
 * Who may serve a run's model and judge calls and what they may keep.
 * Vercel AI Gateway and OpenRouter follow all of these rules. Direct Anthropic
 * and Google calls follow an `onlyHosts` list that names the maker
 * ("anthropic", "google") and nothing else.
 */
export interface IRunDataPolicy {
    /** Hosting companies allowed to serve calls, in the gateway's own names. */
    onlyHosts?: string[];
    /** Only hosts with a zero-data-retention agreement. */
    zeroDataRetention?: boolean;
    /** Only hosts that don't train on prompts. */
    disallowPromptTraining?: boolean;
}

export const PROVIDER_TRANSPORTS: readonly ProviderTransport[] = [
    "gateway",
    "openrouter",
    "openai",
    "anthropic",
    "google",
    "bifrost",
];

export function isProviderTransport(
    value: unknown,
): value is ProviderTransport {
    return (
        typeof value === "string" &&
        (PROVIDER_TRANSPORTS as readonly string[]).includes(value)
    );
}

/** One provider's offer for a model: its ID there, its list price and key status. */
export interface IModelProviderOffer {
    transport: ProviderTransport;
    /** The model's ID on this provider's list. */
    modelId: string;
    /** Published price in USD per 1M input tokens, when the provider lists one. */
    inputPerMillion?: number;
    /** Published price in USD per 1M output tokens, when the provider lists one. */
    outputPerMillion?: number;
    /** This provider has a key, from Settings or the repo's .env files. */
    keySaved: boolean;
}

/** Where a provider's key comes from: the server's .env, or Settings. */
export interface IProviderKeyStatus {
    provider: ProviderTransport;
    /** Settings wins when both are set. */
    source: "env" | "settings";
}

export interface IProviderStatusResponse {
    /**
     * The provider runs start each model on, from FLASH_EVALS_LLM_PROVIDER
     * in the API's .env; undefined for "auto".
     */
    defaultProvider?: ProviderTransport;
    /** Providers that have a key, and where it comes from. */
    keys: IProviderKeyStatus[];
    /** Set when Bifrost has a key and an address. */
    bifrost?: {
        /** The host of its address (never the key). */
        baseUrlHost?: string;
        /** How many models Bifrost lists, when its list was fetched. */
        modelCount?: number;
        /** Why its model list couldn't be fetched. */
        modelListError?: string;
    };
}

export interface IModelPriceListSource {
    provider: "gateway" | "openrouter";
    /** When this price list was last fetched, if it ever was. */
    fetchedAt?: string;
    modelCount: number;
}

export interface IModelPriceRow {
    id: string;
    label: string;
    /** Who makes the model, e.g. "Claude", "Z.ai". */
    vendor: string;
    providers: IModelProviderOffer[];
}

export interface IModelPriceListResponse {
    lists: IModelPriceListSource[];
    models: IModelPriceRow[];
    savedKeyProviders: ProviderTransport[];
    /** From FLASH_EVALS_LLM_PROVIDER in the API's .env. */
    preferredProvider?: ProviderTransport;
}

export interface ITransportAssignment {
    modelId: string;
    transport: ProviderTransport;
    /** See IRunModelSpec.transportModelId (Bifrost only). */
    transportModelId?: string;
}

export interface ICreateRunFromSelectionRequest {
    /** Stable retry key, scoped to team/project/creator. Omit for a new run each time. */
    idempotencyKey?: string;
    teamId: string;
    projectId: string;
    datasetId: string;
    pipelineId?: string;
    promptVersionId?: string;
    maxTokens: number;
    judgeConfigId?: string;
    judgePromptVersionId?: string;
    judgeRubric?: string;
    judgeModelId: string;
    judgeTransport?: ProviderTransport;
    judgeReasoningEffort?: ReasoningEffort;
    referenceModel?: string;
    modelIds: string[];
    promptAssignments: IPromptAssignment[];
    reasoningConfigs: IReasoningConfigAssignment[];
    /** Models not listed run at their provider's default temperature. */
    temperatureAssignments?: ITemperatureAssignment[];
    transportAssignments?: ITransportAssignment[];
    fieldConfigs: IPipelineFieldConfig[];
    sourceRunId?: string;
    sttConfig?: ISttRunConfig;
    sttVariants?: ISttRunVariant[];
    sttEvaluation?: ISttRunEvaluation;
    audioRunMode?: AudioRunMode;
    /** Score every model against `referenceModel`, task by task. */
    benchmark?: IRunBenchmarkConfig;
    /** Who may serve the run's calls and what they may keep. */
    dataPolicy?: IRunDataPolicy;
    /** Run on only the dataset's first N items (a pilot). */
    itemLimit?: number;
    /** Run only on items whose stored answer has one label; before itemLimit. */
    itemFilter?: IRunItemFilter;
    createdBy: string;
    /** See ICreateRunRequest.maxCostUsd. */
    maxCostUsd?: number;
}

export type SttProviderId =
    | "openai"
    | "vercel-gateway"
    | "soniox"
    | "elevenlabs"
    | "openrouter"
    | "bifrost"
    | "gemini";

export interface ISttModelIdentity {
    providerId: SttProviderId | "unknown";
    routeId: string;
    canonicalModelId: string;
}

// Speech-to-text is billed per hour of audio rather than per token, so it needs
// its own rate table. These are published list prices as of July 2026; a
// negotiated plan will differ, which is why anything derived from them is
// reported as `costSource: "computed"` rather than as an invoice figure.
//
// Only models with a rate that genuinely maps to audio duration appear here.
// Deliberately absent:
//   - openrouter:* and bifrost:* — billed per token, not per audio hour, and
//     the audio-to-token ratio is not published, so any per-hour figure would
//     be invented.
//   - vercel:* — the gateway supplies live pricing metadata; a hardcoded rate
//     here would silently compete with it.
//   - openai:gpt-4o-transcribe-diarize — no separately published rate.
// A missing rate yields no cost, which is the intended outcome: a wrong number
// would quietly skew the model comparison this exists to inform.
const STT_AUDIO_HOUR_PRICE_USD: Readonly<Record<string, number>> = {
    // soniox.com/pricing — $0.10/hour async file transcription.
    "soniox:stt-async-v5": 0.1,
    // elevenlabs.io/pricing/api — Scribe v2 $0.22/hour on every plan.
    // Keyterm prompting adds $0.05/hour (STT_KEYTERM_SURCHARGE_USD below).
    "elevenlabs:scribe_v2": 0.22,
    // OpenAI publishes these per minute: $0.006 for whisper-1 and
    // gpt-4o-transcribe, $0.003 for the mini variant.
    "whisper-1": 0.36,
    "gpt-4o-transcribe": 0.36,
    "gpt-4o-mini-transcribe": 0.18,
};

// Per-hour add-on charged when a request sends keyterms (boost words).
// elevenlabs.io/pricing/api — "Keyterm prompting" $0.050/hour.
const STT_KEYTERM_SURCHARGE_USD: Readonly<Record<string, number>> = {
    "elevenlabs:scribe_v2": 0.05,
};

export function sttAudioHourPriceUsdForId(
    modelId: string,
    config?: Record<string, unknown>,
): number | undefined {
    const base = STT_AUDIO_HOUR_PRICE_USD[modelId];
    if (base === undefined) return undefined;
    const surcharge = STT_KEYTERM_SURCHARGE_USD[modelId];
    if (
        surcharge !== undefined &&
        modelId.startsWith("elevenlabs:") &&
        elevenLabsKeyterms(config?.keywords).terms.length > 0
    )
        return base + surcharge;
    return base;
}

export function sttCostUsdForDuration(
    modelId: string,
    durationMs: number | undefined,
    config?: Record<string, unknown>,
): number | undefined {
    const perHour = sttAudioHourPriceUsdForId(modelId, config);
    if (perHour === undefined || durationMs === undefined || durationMs <= 0)
        return undefined;
    return (durationMs / 3_600_000) * perHour;
}

/** ElevenLabs keyterm limits from its speech-to-text API reference. */
export const ELEVENLABS_KEYTERM_LIMITS = {
    maxTerms: 1000,
    maxChars: 50,
    maxWords: 5,
} as const;

/**
 * Splits the comma-separated keyword boost into terms ElevenLabs accepts:
 * at most 1000 terms, each at most 50 characters and 5 words, none with
 * `< > { } [ ] \`. Rejected terms are returned so the run can warn about them
 * instead of failing the whole request.
 */
export function elevenLabsKeyterms(value: unknown): {
    terms: string[];
    rejected: string[];
} {
    if (typeof value !== "string") return { terms: [], rejected: [] };
    const terms: string[] = [];
    const rejected: string[] = [];
    const seen = new Set<string>();
    for (const entry of value.split(",")) {
        const term = entry.trim().replace(/\s+/g, " ");
        if (!term || seen.has(term)) continue;
        seen.add(term);
        const ok =
            term.length <= ELEVENLABS_KEYTERM_LIMITS.maxChars &&
            term.split(" ").length <= ELEVENLABS_KEYTERM_LIMITS.maxWords &&
            !/[<>{}[\]\\]/.test(term) &&
            terms.length < ELEVENLABS_KEYTERM_LIMITS.maxTerms;
        (ok ? terms : rejected).push(term);
    }
    return { terms, rejected };
}

export function sttModelIdentityForId(modelId: string): ISttModelIdentity {
    if (modelId.startsWith("vercel:")) {
        return {
            providerId: "vercel-gateway",
            routeId: "vercel-ai-gateway-stt",
            canonicalModelId: modelId.replace(/^vercel:/, ""),
        };
    }
    if (modelId.startsWith("soniox:")) {
        return {
            providerId: "soniox",
            routeId: "soniox-async-file-transcription",
            canonicalModelId: modelId.replace(/^soniox:/, ""),
        };
    }
    if (modelId.startsWith("elevenlabs:")) {
        return {
            providerId: "elevenlabs",
            routeId: "elevenlabs-speech-to-text",
            canonicalModelId: modelId.replace(/^elevenlabs:/, ""),
        };
    }
    if (modelId.startsWith("gemini:")) {
        return {
            providerId: "gemini",
            routeId: "gemini-generate-content-audio",
            canonicalModelId: modelId.replace(/^gemini:/, ""),
        };
    }
    if (modelId.startsWith("openrouter:google/gemini")) {
        return {
            providerId: "openrouter",
            routeId:
                modelId === "openrouter:google/gemini-3.8-flash"
                    ? "openrouter-gemini-audio"
                    : "openrouter-audio-understanding-unverified",
            canonicalModelId: modelId.replace(/^openrouter:/, ""),
        };
    }
    if (modelId.startsWith("openrouter:")) {
        return {
            providerId: "openrouter",
            routeId: "openrouter-audio-transcriptions",
            canonicalModelId: modelId.replace(/^openrouter:/, ""),
        };
    }
    if (modelId.startsWith("bifrost:")) {
        return {
            providerId: "bifrost",
            routeId: "bifrost-stt-unverified",
            canonicalModelId: modelId.replace(/^bifrost:/, ""),
        };
    }
    return {
        providerId: "openai",
        routeId: "openai-audio-transcriptions",
        canonicalModelId: modelId.replace(/^openai:/, ""),
    };
}

export type SttOutputKind =
    | "plain_transcript"
    | "diarized_transcript"
    | "audio_understanding_transcript";

export type SttModelAvailabilityStatus =
    | "available"
    | "missing_key"
    | "unverified_route"
    | "unsupported_input"
    | "provider_error";

export type SttModelConfigFieldKind =
    "text" | "textarea" | "select" | "boolean" | "number";

export interface ISttModelConfigFieldOption {
    label: string;
    value: string;
}

export interface ISttModelConfigField {
    key: string;
    label: string;
    kind: SttModelConfigFieldKind;
    required?: boolean;
    placeholder?: string;
    helpText?: string;
    defaultValue?: string | number | boolean;
    options?: ISttModelConfigFieldOption[];
}

export const STT_LANGUAGE_FIELD: ISttModelConfigField = {
    key: "language",
    label: "Audio language",
    kind: "text",
    placeholder: "auto",
    helpText: "Optional ISO code such as en, hi, or ta.",
};

export const STT_INITIAL_PROMPT_FIELD: ISttModelConfigField = {
    key: "prompt",
    label: "Initial prompt",
    kind: "textarea",
    helpText:
        "Optional vocabulary, spelling, or formatting guidance for the transcription model.",
};

export const STT_DIARIZATION_FIELD: ISttModelConfigField = {
    key: "diarization",
    label: "Diarization",
    kind: "boolean",
    helpText:
        "Request speaker-separated transcript output when the provider supports it.",
    defaultValue: false,
};

export const STT_CONTEXT_FIELD: ISttModelConfigField = {
    key: "context",
    label: "Context",
    kind: "textarea",
    helpText:
        "Optional domain terms, names, and formatting hints for this audio.",
};

export const STT_TIMESTAMP_GRANULARITY_FIELD: ISttModelConfigField = {
    key: "timestampGranularity",
    label: "Timestamp granularity",
    kind: "select",
    placeholder: "No timestamp detail",
    helpText:
        "Request timestamp detail when the transcription provider supports it.",
    options: [
        { label: "Segment timestamps", value: "segment" },
        { label: "Word timestamps", value: "word" },
    ],
};

export const STT_GEMINI_TRANSCRIPTION_PROMPT_FIELD: ISttModelConfigField = {
    key: "transcriptionPrompt",
    label: "Transcription prompt",
    kind: "textarea",
    helpText:
        "Prompt used for audio-understanding models that are not dedicated STT endpoints.",
};

export const STT_TEMPERATURE_FIELD: ISttModelConfigField = {
    key: "temperature",
    label: "Temperature",
    kind: "number",
    placeholder: "provider default",
    helpText:
        "Sampling temperature for prompt-driven audio-understanding transcription.",
};

export const STT_THINKING_FIELD: ISttModelConfigField = {
    key: "thinking",
    label: "Thinking effort",
    kind: "select",
    placeholder: "provider default",
    helpText:
        "Optional reasoning budget for audio-understanding transcription routes when supported.",
    options: [
        { label: "Low", value: "low" },
        { label: "Medium", value: "medium" },
        { label: "High", value: "high" },
    ],
};

export const STT_KEYWORDS_FIELD: ISttModelConfigField = {
    key: "keywords",
    label: "Keyword boost",
    kind: "text",
    placeholder: "Avalon, Brightwater",
    helpText:
        "Comma-separated names or domain terms to emphasize during transcription.",
};

export const STT_THINKING_BUDGET_FIELD: ISttModelConfigField = {
    key: "thinkingBudgetTokens",
    label: "Thinking budget (tokens)",
    kind: "number",
    placeholder: "provider default",
    helpText:
        "Optional maximum reasoning-token budget for supported audio-understanding routes.",
};

/**
 * Run-level option (ISttRunConfig.levelVolume), not a provider payload field:
 * it applies to every provider route.
 */
export const STT_LEVEL_VOLUME_FIELD: ISttModelConfigField = {
    key: "levelVolume",
    label: "Level volume first",
    kind: "boolean",
    helpText:
        "Raises quiet recordings to a standard loudness before transcription. Try it if transcripts come back empty.",
    defaultValue: false,
};

export const STT_STANDARD_CONFIG_FIELDS: readonly ISttModelConfigField[] = [
    STT_LANGUAGE_FIELD,
    STT_INITIAL_PROMPT_FIELD,
    STT_CONTEXT_FIELD,
    STT_KEYWORDS_FIELD,
    STT_DIARIZATION_FIELD,
    STT_TIMESTAMP_GRANULARITY_FIELD,
    STT_TEMPERATURE_FIELD,
    STT_THINKING_FIELD,
    STT_THINKING_BUDGET_FIELD,
];

function extendSttConfigFields(
    fields: ISttModelConfigField[],
): ISttModelConfigField[] {
    const supportsKeywordBoost = fields.some(
        (field) =>
            field.key === STT_CONTEXT_FIELD.key ||
            field.key === STT_INITIAL_PROMPT_FIELD.key,
    );
    const supportsThinking = fields.some(
        (field) => field.key === STT_THINKING_FIELD.key,
    );
    return [
        ...fields,
        ...(supportsKeywordBoost ? [STT_KEYWORDS_FIELD] : []),
        ...(supportsThinking ? [STT_THINKING_BUDGET_FIELD] : []),
    ];
}

export function sttConfigFieldsForModelId(
    modelId: string,
): ISttModelConfigField[] {
    if (modelId === "openrouter:google/gemini-3.8-flash")
        return [STT_LANGUAGE_FIELD, STT_INITIAL_PROMPT_FIELD];
    if (modelId === "openai:gpt-4o-transcribe-diarize") {
        return [STT_LANGUAGE_FIELD, STT_TEMPERATURE_FIELD];
    }
    if (modelId.startsWith("soniox:")) {
        return extendSttConfigFields([
            STT_LANGUAGE_FIELD,
            STT_CONTEXT_FIELD,
            STT_DIARIZATION_FIELD,
        ]);
    }
    if (modelId.startsWith("elevenlabs:")) {
        return [STT_LANGUAGE_FIELD, STT_KEYWORDS_FIELD, STT_DIARIZATION_FIELD];
    }
    if (modelId.startsWith("gemini:")) {
        return [
            STT_LANGUAGE_FIELD,
            STT_INITIAL_PROMPT_FIELD,
            STT_DIARIZATION_FIELD,
            STT_TIMESTAMP_GRANULARITY_FIELD,
            STT_TEMPERATURE_FIELD,
            STT_THINKING_FIELD,
            STT_THINKING_BUDGET_FIELD,
        ];
    }
    if (modelId === "vercel:openai/whisper-1") {
        return [STT_TIMESTAMP_GRANULARITY_FIELD];
    }
    if (modelId.startsWith("vercel:")) return [];
    if (modelId === "openrouter:whisper-large-v3-turbo") {
        return [
            STT_LANGUAGE_FIELD,
            STT_TIMESTAMP_GRANULARITY_FIELD,
            STT_TEMPERATURE_FIELD,
        ];
    }
    if (modelId === "bifrost:whisper-large-v3-turbo") {
        return [STT_LANGUAGE_FIELD];
    }
    if (modelId === "whisper-1" || modelId === "openai:whisper-1") {
        return extendSttConfigFields([
            STT_LANGUAGE_FIELD,
            STT_INITIAL_PROMPT_FIELD,
            STT_TIMESTAMP_GRANULARITY_FIELD,
        ]);
    }
    if (
        modelId.startsWith("openai:") ||
        modelId === "gpt-4o-transcribe" ||
        modelId === "gpt-4o-mini-transcribe"
    ) {
        return extendSttConfigFields([
            STT_LANGUAGE_FIELD,
            STT_INITIAL_PROMPT_FIELD,
        ]);
    }
    return [];
}

export function sttModelSupportsLanguage(modelId: string): boolean {
    return sttConfigFieldsForModelId(modelId).some(
        (field) => field.key === "language",
    );
}

export function sttPayloadConfigFieldsForModelId(
    modelId: string,
): ISttModelConfigField[] {
    return sttConfigFieldsForModelId(modelId).filter(
        (field) => field.key !== "language",
    );
}

export function unsupportedSttConfigKeysForFields(
    fields: ISttModelConfigField[],
    config: Record<string, unknown> | undefined,
): string[] {
    if (!config) return [];
    const supported = new Set(fields.map((field) => field.key));
    return Object.keys(config).filter((key) => !supported.has(key));
}

export function invalidSttConfigMessagesForFields(
    fields: ISttModelConfigField[],
    config: Record<string, unknown> | undefined,
): string[] {
    if (!config) return [];
    const fieldByKey = new Map(fields.map((field) => [field.key, field]));
    const messages: string[] = [];
    for (const [key, value] of Object.entries(config)) {
        const field = fieldByKey.get(key);
        if (!field || value === undefined || value === null) continue;
        if (field.kind === "boolean") {
            if (typeof value !== "boolean") {
                messages.push(`${field.label} must be true or false.`);
            }
            continue;
        }
        if (field.kind === "number") {
            if (typeof value !== "number" || !Number.isFinite(value)) {
                messages.push(`${field.label} must be a finite number.`);
            }
            continue;
        }
        if (typeof value !== "string") {
            messages.push(`${field.label} must be text.`);
            continue;
        }
        if (
            field.kind === "select" &&
            field.options?.length &&
            !field.options.some((option) => option.value === value)
        ) {
            messages.push(
                `${field.label} must be one of the supported options.`,
            );
        }
    }
    return messages;
}

export function invalidSttConfigMessagesForModelId(
    modelId: string,
    config: Record<string, unknown> | undefined,
): string[] {
    const messages = invalidSttConfigMessagesForFields(
        sttPayloadConfigFieldsForModelId(modelId),
        config,
    );
    const budget = config?.thinkingBudgetTokens;
    if (
        budget === undefined ||
        typeof budget !== "number" ||
        !Number.isFinite(budget)
    ) {
        return messages;
    }
    if (!Number.isInteger(budget)) {
        return [...messages, "Thinking budget (tokens) must be an integer."];
    }
    if (
        modelId === "gemini:gemini-2.5-flash" &&
        budget !== -1 &&
        (budget < 0 || budget > 24_576)
    ) {
        return [
            ...messages,
            "Thinking budget (tokens) must be -1, 0, or between 1 and 24576.",
        ];
    }
    if (
        modelId === "gemini:gemini-2.5-flash-lite" &&
        (budget < 512 || budget > 24_576)
    ) {
        return [
            ...messages,
            "Thinking budget (tokens) must be between 512 and 24576.",
        ];
    }
    return messages;
}

export interface ISttRunConfig {
    modelId: string;
    providerId?: SttProviderId;
    routeId?: string;
    canonicalModelId?: string;
    language?: string;
    config?: Record<string, unknown>;
    /**
     * Level each recording to a standard loudness with FFmpeg before it is
     * sent to the provider. Off when absent; part of the transcript cache key.
     */
    levelVolume?: boolean;
    transcriptVariant?: "raw" | "latin";
    transliteration?: ISttTransliterationConfig;
    evaluator?: ISttEvaluatorConfig;
}

export const MAX_STT_VARIANTS = 6;

export interface ISttRunVariant {
    variantKey: string;
    label: string;
    config: ISttRunConfig;
}

export interface ISttRunEvaluation {
    transcriptVariant?: ISttRunConfig["transcriptVariant"];
    transliteration?: ISttTransliterationConfig;
    evaluator?: ISttEvaluatorConfig;
}

export interface IRunConfigSnapshot extends Record<string, unknown> {
    sttConfig?: ISttRunConfig;
    sttVariants?: Record<string, ISttRunVariant>;
    benchmark?: IRunBenchmarkConfig;
    dataPolicy?: IRunDataPolicy;
    /** Set when the run used only the dataset's first N items. */
    itemLimit?: number;
    /**
     * Set when the run used only items with one stored label; `path` is
     * resolved from `taskKey` when the request named a task.
     */
    itemFilter?: IRunItemFilter;
    /** The run's spend limit in USD, when one was set. */
    maxCostUsd?: number;
}

export interface ISttTransliterationConfig {
    enabled: boolean;
    targetScript: "latin";
    targetLanguage?: string;
    modelId: string;
    providerMode?: EvalProviderMode;
    providerBaseUrl?: string;
    prompt?: string;
    temperature?: number;
}

export type EvalProviderMode =
    "auto" | "vercel-ai" | "openai" | "gateway" | "openrouter" | "bifrost";

export interface ISttEvaluatorConfig {
    enabled: boolean;
    modelId: string;
    rubricPrompt: string;
    reasoningEffort?: ReasoningEffort;
}

export interface IProposeBenchmarkTaskMapRequest {
    teamId: string;
    projectId: string;
    promptVersionId: string;
    /** Model that reads the prompt; the prompt optimizer model by default. */
    generatorModelId?: string;
}

export interface IProposeBenchmarkTaskMapResponse {
    /** A draft for a person to review, never applied automatically. */
    taskMap: ITaskMap;
    /** "model" when the model's draft was valid; "schema" for the fallback. */
    source: "model" | "schema";
    /** One line per task: why it is scored this way. */
    notes: string[];
    /** Problems with the model's draft that caused the fallback. */
    rejected: string[];
}

export interface IGenerateJudgeForRunRequest {
    teamId: string;
    projectId: string;
    promptVersionId: string;
    datasetId: string;
    generatorModelId?: string;
}

export interface IGenerateJudgeForRunResponse {
    rubricPrompt: string;
}

export type SchemaFieldType = "string" | "number" | "string[]";

export interface ISchemaFieldDescriptor {
    name: string;
    type: SchemaFieldType;
    required: boolean;
}

export interface IParsedSchemaDescriptor {
    fields: ISchemaFieldDescriptor[];
    additionalProperties: boolean;
}

export type LabelJson = Record<string, unknown>;

export type DatasetLabelMode =
    "evaluation" | "independent" | "pipeline" | "legacySchema";

export interface IDatasetDetailResponse {
    dataset: {
        id: string;
        teamId: string;
        name: string;
        purpose: "golden" | "evaluation";
        modality: "audio" | "image" | "text";
        pipelineId: string | null;
        description: string | null;
        archivedAt: string | null;
    };
    items: Array<{
        id: string;
        type: "audio" | "image" | "text" | "mixed";
        inputText: string | null;
        sourceName: string | null;
        storageKey: string | null;
        mimeType: string | null;
    }>;
    labels: Array<LabelJson | undefined>;
    itemCount: number;
    labeledItemCount: number;
    labelMode: DatasetLabelMode;
    answerSchema?: IParsedSchemaDescriptor;
    freeformLabel: boolean;
    isRunnable: boolean;
}

export interface ICreateDatasetRequest {
    teamId: string;
    projectId: string;
    name: string;
    purpose: "golden" | "evaluation";
    modality: "audio" | "image" | "text";
    createdBy: string;
}

export interface ICreateDatasetResponse {
    id: string;
}

export interface IUpdateDatasetNameRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    name: string;
}

export interface IUpdateDatasetDescriptionRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    description: string | null;
}

export interface ISetDatasetArchivedRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    archived: boolean;
}

export interface IDuplicateDatasetRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    createdBy: string;
}

export interface IDuplicateDatasetResponse {
    sourceDatasetId: string;
    createdDatasetId: string;
}

export interface IDeleteDatasetRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
}

export interface IDeleteLabelRequest {
    teamId: string;
    projectId: string;
    itemId: string;
}

export interface IDeleteDatasetItemRequest {
    teamId: string;
    projectId: string;
    itemId: string;
}

export interface ICreateDatasetItemRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    inputText: string;
    label?: LabelJson;
    audio?: {
        storageKey: string;
        mimeType: string;
        sourceName?: string;
    };
    image?: {
        storageKey: string;
        mimeType: string;
        sourceName?: string;
    };
}

export interface ICreateDatasetItemFromFormRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    inputText: string;
    rawLabel: string;
    audio?: IApiAudioImportFile;
    image?: IApiImageImportFile;
}

export interface IUpdateDatasetItemRequest {
    teamId: string;
    projectId: string;
    itemId: string;
    inputText: string;
    label?: LabelJson;
    clearLabel?: boolean;
    audio?: {
        storageKey: string;
        mimeType: string;
        sourceName?: string;
    };
    image?: {
        storageKey: string;
        mimeType: string;
        sourceName?: string;
    };
}

export interface IUpdateDatasetItemFromFormRequest {
    teamId: string;
    projectId: string;
    itemId: string;
    inputText: string;
    rawLabel: string;
    audio?: IApiAudioImportFile;
    image?: IApiImageImportFile;
}

export interface IDatasetItemMutationResponse {
    datasetId: string;
}

export type ImportFormat = "csv" | "jsonl" | "images";

export const DUPLICATE_ITEM_SOURCE_NAME_MESSAGE =
    "An item with this filename already exists in the dataset.";

// Media batch caps bound the direct-to-Supabase upload (signed-URL PUT); media
// bytes no longer flow through Server Actions, so these are not coupled to
// next.config serverActions.bodySizeLimit. Kept in sync with
// apps/web/server/datasets/import/shared.ts.
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_IMAGE_IMPORT_BYTES = 24 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_IMPORT_BYTES = 250 * 1024 * 1024;
export const MAX_IMPORT_FILE_COUNT = 100;
export const ALLOWED_IMAGE_TYPES = [
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
];
export const ALLOWED_AUDIO_TYPES = [
    "audio/mpeg",
    "audio/mp3",
    "audio/mp4",
    "audio/aac",
    "audio/wav",
    "audio/x-wav",
    "audio/webm",
    "audio/ogg",
    "audio/flac",
];
// Bounds the INLINE text/answer/CSV path, whose bytes POST through a Server Action
// (UTF-8) — must stay under next.config serverActions.bodySizeLimit.
export const MAX_TEXT_IMPORT_BYTES = 2 * 1024 * 1024;

export interface IImportFailure {
    row?: number;
    fileName?: string;
    reason: string;
}

export interface IImportSummary {
    importedCount: number;
    failures: IImportFailure[];
    rejected?: boolean;
}

export interface IApiImageImportFile {
    name: string;
    mimeType: string;
    size: number;
    // Direct-upload path (preferred): a pre-uploaded, server-authoritative
    // storage key the API verifies instead of re-uploading bytes.
    storageKey?: string;
    // Legacy path: inline base64 bytes uploaded through the API. Optional so a
    // storageKey-only client can omit it; retained for backward compatibility.
    base64Data?: string;
}

export interface IApiAudioImportFile {
    name: string;
    mimeType: string;
    size: number;
    storageKey?: string;
    base64Data?: string;
}

export interface IImportAudioRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    audio: IApiAudioImportFile[];
}

export interface IImportImagesRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    images: IApiImageImportFile[];
}

export interface IImportImageAnswersRequest extends IImportImagesRequest {
    answersContent: string;
}

export interface IImportAudioAnswersRequest extends IImportAudioRequest {
    answersContent: string;
}

/** One file the browser intends to upload directly to storage. */
export interface ISignedUploadFileRequest {
    fileName: string;
    byteSize: number;
    contentType: string;
}

/** Request a batch of short-lived signed upload URLs for a dataset import. */
export interface ICreateSignedUploadRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    modality: "audio" | "image";
    files: ISignedUploadFileRequest[];
}

/**
 * A single signable target: the server-authoritative `storageKey` the object
 * must be written under and the `signedUrl` the browser PUTs bytes to.
 */
export interface ISignedUploadTarget {
    storageKey: string;
    signedUrl: string;
    /** Additional headers required when PUTing to this signed URL. */
    headers?: Record<string, string>;
    expiresAt?: string;
}

/** Response carrying one signed upload target per requested file, in order. */
export interface ICreateSignedUploadResponse {
    targets: ISignedUploadTarget[];
}

export interface IImportTextItemsRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    format: Exclude<ImportFormat, "images">;
    content: string;
}

export interface IImportGoldenAnswersRequest {
    teamId: string;
    projectId: string;
    datasetId: string;
    answersContent: string;
    answerFiles?: IAnswerImportFile[];
}

export type AnswerImportInterpretation = "single_record" | "keyed_map";

export interface IAnswerImportFile {
    fileName: string;
    content: string;
    interpretation?: AnswerImportInterpretation;
    itemId?: string;
    allowOverwrite?: boolean;
}

export type AnswerImportTargetField =
    | "expectedTranscript"
    | "expectedTranscriptLatin"
    | "expectedLanguage"
    | "expectedSpeakerTurns"
    | "domainTerms"
    | "expectedNumbers"
    | "referenceKind"
    | "latencySlaMs"
    | "costOutlierUsd"
    | "ignore";

export type IAnswerImportMapping = Record<string, AnswerImportTargetField>;

export interface IPreviewGoldenAnswersRequest extends IImportGoldenAnswersRequest {
    mapping?: IAnswerImportMapping;
}

export interface IAnswerImportPreviewRow {
    row: number;
    fileName?: string;
    key?: string;
    itemId?: string;
    itemSourceName?: string;
    interpretation?: AnswerImportInterpretation;
    interpretationAmbiguous?: boolean;
    requiresItemSelection?: boolean;
    requiresOverwriteConfirmation?: boolean;
    matchReason?: "filename_stem" | "only_unlabeled" | "selected";
    status: "importable" | "warning" | "failing";
    messages: string[];
    label?: LabelJson;
}

export interface IAnswerImportPreview {
    fields: Array<{
        name: string;
        sample: unknown;
        shape?: "speaker_turn_transcript" | "mixed_transcript";
        derivedFrom?: string;
    }>;
    proposedMapping: IAnswerImportMapping;
    rows: IAnswerImportPreviewRow[];
    importableCount: number;
    warningCount: number;
    failingCount: number;
    itemOptions?: Array<{ itemId: string; sourceName: string }>;
}

export interface ICommitGoldenAnswersRequest extends IImportGoldenAnswersRequest {
    mapping: IAnswerImportMapping;
}

export interface IImportPairedItemsRequest extends IImportImagesRequest {
    csvContent: string;
}

export interface IRunSetupDatasetOption {
    id: string;
    name: string;
    itemCount: number;
    labeledItemCount: number;
    purpose: "golden" | "evaluation";
    modality: "audio" | "image" | "text";
    /** Average input text length in characters, for cost estimates. */
    avgInputChars?: number;
}

export interface IRunSetupBundleOption {
    id: string;
    name: string;
    fieldCount: number;
    fieldConfigs: IPipelineFieldConfig[];
}

export interface IRunSetupVersionOption {
    id: string;
    label: string;
    fieldConfigs: IPipelineFieldConfig[];
    reasoningConfig?: IReasoningConfig;
    /** The version's output schema; New run proposes a benchmark Task Map from it. */
    outputSchema?: IJsonSchemaObject;
    /** The prompt's length in characters, for cost estimates. */
    promptChars?: number;
}

export interface IRunSetupModelOption {
    id: string;
    label: string;
    family: string;
    provider: string;
    providerLabel: string;
    reasoning: boolean;
    vision: boolean;
    structuredOutput: boolean;
    judgeSuitable: boolean;
    costAvailable: boolean;
    available: boolean;
    /**
     * The authenticated provider returned this exact model ID during the
     * current discovery pass. Static catalog metadata may enrich the option,
     * but must not prevent selecting it.
     */
    providerListed?: boolean;
    /** Providers with a key that can run it; the first is the default. */
    transports: ProviderTransport[];
    /** Every provider that lists the model, with its price and whether a key is saved. */
    providers?: IModelProviderOffer[];
    unavailableReason?: string;
    disabledReason?: string;
    reasoningEffort?: {
        supportedLevels: readonly ReasoningEffort[];
        defaultLevel: ReasoningEffort;
    };
}

export type IPromptWorkbenchModelOption = IRunSetupModelOption;

export interface IRunSetupJudgePromptOption {
    promptVersionId: string;
    label: string;
}

export interface IRunSetupSttModelOption {
    id: string;
    label: string;
    providerId?: SttProviderId;
    providerLabel: string;
    routeId?: string;
    outputKind?: SttOutputKind;
    availabilityStatus?: SttModelAvailabilityStatus;
    available: boolean;
    unavailableReason?: string;
    configFields?: ISttModelConfigField[];
    aliases?: string[];
}

export interface IRunSetupResponse {
    datasets: IRunSetupDatasetOption[];
    bundles: IRunSetupBundleOption[];
    versionOptions: IRunSetupVersionOption[];
    availableModels: IRunSetupModelOption[];
    modelsDegraded: boolean;
    hasPrompt: boolean;
    judgePrompts: IRunSetupJudgePromptOption[];
    sttModels: IRunSetupSttModelOption[];
    /** Providers with a key, from Settings or the repo's .env files. */
    savedKeyProviders?: ProviderTransport[];
    /** The provider runs start each model on, from the API's .env. */
    preferredProvider?: ProviderTransport;
    /**
     * Set when a Bifrost key and address are configured but Bifrost's model
     * list couldn't be fetched: no model is offered on Bifrost meanwhile.
     */
    bifrostModelListError?: string;
}

export interface IPromptWorkbenchInitialPrompt {
    promptId: string;
    name: string;
    description: string;
    kind: "eval" | "judge";
    content: string;
    jsonSchema: string;
    targetModelId?: string;
    reasoningEffort?: ReasoningEffort;
    fitTags: string[];
}

export interface IPromptWorkbenchSetupResponse {
    tagSuggestions: string[];
    availableModels: IPromptWorkbenchModelOption[];
    modelsDegraded: boolean;
    initialPrompt?: IPromptWorkbenchInitialPrompt;
}

export interface IDeletePromptRequest {
    teamId: string;
    projectId: string;
    promptId: string;
}

export interface IDuplicatePromptVersionRequest {
    teamId: string;
    projectId: string;
    sourcePromptVersionId: string;
    createdBy: string;
}

export interface IDuplicatePromptVersionResponse {
    sourcePromptVersionId: string;
    promptId: string;
    promptVersionId: string;
}

export interface ICreateJudgePromptRequest {
    teamId: string;
    projectId: string;
    /**
     * An existing judge prompt in this team and project: the save adds a new
     * version to it instead of creating a prompt. Omit to create one.
     */
    promptId?: string;
    name: string;
    modelId: string;
    rubricPrompt: string;
    judgeSpec?: IJudgeSpec;
    reasoningConfig?: IReasoningConfig;
    createdBy: string;
}

export interface ICreateJudgePromptResponse {
    promptId: string;
    promptVersionId: string;
}

export interface IRecordPromptValidationAttemptRequest {
    teamId: string;
    projectId: string;
    promptId?: string;
    schemaVersionId?: string;
    targetModelId: string;
    status: "running" | "passed" | "failed" | "provider_error" | "cancelled";
    schemaHash?: string;
    evidence?: unknown;
    rawOutput?: string;
    parsedOutput?: unknown;
    error?: string;
    latencyMs?: number;
    createdBy: string;
}

export interface ISaveRunnablePromptRequest {
    teamId: string;
    projectId: string;
    promptId?: string;
    name: string;
    description?: string;
    targetModelId: string;
    content: string;
    jsonSchema: Record<string, unknown>;
    fieldConfigs: IPipelineFieldConfig[];
    validationEvidence: unknown;
    /**
     * The passed check from validate (IValidateRunnablePromptResponse
     * .validationAttemptId) for this content, schema and model. Without it
     * the version is saved runnable but marked "not checked on a model".
     */
    validationAttemptId?: string;
    optimizerAttemptId?: string;
    reasoningConfig?: IReasoningConfig;
    fitTags: string[];
    createdBy: string;
}

export interface ISaveRunnablePromptResponse {
    promptId: string;
    promptVersionId: string;
    promptVersion: number;
    schemaVersionId: string;
}

export interface IPromptOptimizerGuidanceSource {
    title: string;
    url: string;
    retrievedAt: string;
}

export interface IOptimizePromptRequest {
    teamId: string;
    projectId: string;
    content: string;
    targetModelId: string;
    optimizerModelId: string;
    jsonSchema: Record<string, unknown>;
    createdBy: string;
}

export interface IOptimizePromptResponse {
    originalPrompt: string;
    optimizedPrompt: string;
    optimizationRationale: string;
    optimizationGuidanceSource: IPromptOptimizerGuidanceSource;
    optimizerModelId: string;
    optimizationTargetModelId: string;
    structuredOutputNotes: string[];
    fitTags: string[];
    validationSummary: string;
    optimizerAttemptId: string;
}

export interface ISchemaCompatibilityIssue {
    path: string;
    code: string;
    message: string;
}

export interface ISchemaValidationResult {
    localValid: boolean;
    openaiCompatible: boolean;
    errors: ISchemaCompatibilityIssue[];
}

export interface IPromptSampleInput {
    name: string;
    inputText?: string;
    imageStorageKey?: string;
    imageMimeType?: string;
}

export interface IPromptValidationEvidence {
    staticChecks: ISchemaCompatibilityIssue[];
    schemaValidation: ISchemaValidationResult;
    sampleResults: Array<{
        sampleName: string;
        status: "passed" | "failed" | "provider_error" | "cancelled";
        rawOutput?: string;
        parsedOutput?: unknown;
        errors: ISchemaCompatibilityIssue[];
    }>;
}

export interface IEvalImage {
    mimeType: string;
    base64Data: string;
}

export interface IUsageData {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
}

export type PromptTestRunResultStatus =
    | "success"
    | "failed_validation"
    | "provider_error"
    | "timeout"
    | "cancelled";

export interface IPromptTestRunResult {
    sampleName: string;
    inputText: string;
    status: PromptTestRunResultStatus;
    rawOutput?: string;
    parsedOutput?: unknown;
    validation: {
        valid: boolean;
        errors: ISchemaCompatibilityIssue[];
    };
    usage?: IUsageData;
    latencyMs?: number;
    costUsd?: number;
    costSource: "computed" | "unavailable";
    error?: string;
}

export interface IPromptTestRunResponse {
    status: "success" | "partial" | "failed";
    targetModelId: string;
    reasoningEffort?: ReasoningEffort;
    results: IPromptTestRunResult[];
}

export interface IGeneratePromptSchemaRequest {
    teamId: string;
    projectId: string;
    content: string;
    targetModelId: string;
    generatorModelId: string;
    createdBy: string;
}

export interface IGeneratePromptSchemaResponse {
    schema: Record<string, unknown>;
    openaiCompatible: boolean;
    compatibilityErrors: ISchemaCompatibilityIssue[];
}

export interface ITestPromptDraftRequest {
    teamId: string;
    prompt: string;
    jsonSchema: IJsonSchemaObject;
    targetModelId: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    samples: IPromptSampleInput[];
    image?: IEvalImage;
    timeoutMs?: number;
}

export type ITestPromptDraftResponse = IPromptTestRunResponse;

export interface IValidateRunnablePromptRequest {
    teamId: string;
    projectId: string;
    prompt: string;
    jsonSchema: IJsonSchemaObject;
    samples: IPromptSampleInput[];
    targetModelId: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    createdBy: string;
}

export interface IValidateRunnablePromptResponse {
    passed: boolean;
    evidence: IPromptValidationEvidence;
    failureMessage?: string;
    /** When passed: the recorded check, to pass to the runnable save. */
    validationAttemptId?: string;
}

export type JudgeDeclaredInput =
    "task_input" | "candidate_output" | "reference";

export interface IJudgeSpec {
    modelId: string;
    transport?: ProviderTransport;
    declaredInputs: JudgeDeclaredInput[];
}

export interface ITestJudgeDraftRequest {
    teamId: string;
    content: string;
    targetModelId: string;
    transport?: ProviderTransport;
    reasoningEffort?: ReasoningEffort;
    declaredInputs: JudgeDeclaredInput[];
    taskInput?: string;
    candidateOutput: unknown;
    reference?: unknown;
}

export interface ITestJudgeDraftResponse {
    score: number;
    rationale: string;
}

export interface IDashboardResponse {
    stats: IDashboardStats;
    recentRuns: IDashboardRun[];
}

export interface IRunProgressResponse extends IRunProgress {
    status: RunStatus;
    enqueueStatus?: "pending_enqueue" | "queued";
    /** Set once a stop was asked for, while the run is still winding down too. */
    stopReason?: RunStopReason;
    /** Why the run failed before any cell started. */
    error?: string;
    /** For a pending run: when it was last queued (or created). */
    pendingSince?: string;
}

export interface IRetryRunResponse {
    runId: string;
    enqueueStatus: "pending_enqueue" | "queued";
    /** False when there was nothing to retry (running, or still queued). */
    requeued?: boolean;
}

export interface ICancelRunResponse {
    runId: string;
    /** `cancelled` at once for a run no worker had started; otherwise unchanged until the worker stops. */
    status: RunStatus;
    stopReason?: RunStopReason;
}

export type ScorerType =
    | "field_diff"
    | "judge"
    | "transcript_metric"
    | "transcript_judge"
    | "benchmark";

export interface IMatrixCellScore {
    scorerType: ScorerType;
    score: number | null;
    rationale: string | null;
    detailsJson: unknown;
}

export interface IRunDetailModel {
    id: string;
    modelId: string;
    promptVersionId: string | null;
    isReference: boolean;
    /** The temperature the run sent; absent: the provider's default. */
    temperature?: number;
}

export interface IRunDetailItem {
    id: string;
    type: "audio" | "image" | "text" | "mixed";
    inputText: string | null;
    storageKey: string | null;
    mimeType: string | null;
}

export interface ICellAnnotation {
    verdict: ReviewVerdict;
    comment: string;
    updatedAt: string;
    updatedBy: string | null;
}

export interface IRunDetailCell {
    id: string;
    datasetItemId: string;
    runModelId: string;
    status: CellStatus;
    outputJson: unknown;
    latencyMs: number | null;
    costUsd: number | null;
    /** What judging this cell cost, when any judge call reported a cost. */
    judgeCostUsd?: number;
    promptTokens: number | null;
    completionTokens: number | null;
    /** Thinking (reasoning) tokens, part of completionTokens, when reported. */
    reasoningTokens?: number;
    /** Whether the run's thinking level was sent with this call. */
    thinking?: IThinkingOutcome;
    annotation?: ICellAnnotation;
    error: string | null;
    /** The hosting company that served this answer, when the gateway said. */
    servedBy?: string;
}

/**
 * What happened to a requested thinking (reasoning) level on one call:
 * sent, with the request field that carried it, or not sent and why.
 */
export interface IThinkingOutcome {
    requested: ReasoningEffort;
    sent: boolean;
    /** The request field(s) that carried it, e.g. `anthropic.effort=high`. */
    via?: string;
    /** Why it was not sent. */
    reason?: string;
}

export interface IRunTranscriptSegment {
    text: string;
    startMs?: number;
    endMs?: number;
    speaker?: string;
    language?: string;
}

export interface IRunTranscriptSpeaker {
    id: string;
    label?: string;
}

export interface IRunAudioTranscriptVariantSummary {
    id: string;
    datasetItemId: string;
    storageKey: string;
    sourceTranscriptHash: string;
    variantKind: string;
    targetScript: string;
    targetLanguage: string;
    modelId: string;
    transcript: string;
    providerMetadata: unknown;
    status: string;
    error: string | null;
    createdAt: string;
}

export interface IRunAudioTranscriptSummary {
    id: string;
    datasetItemId: string;
    storageKey: string;
    providerId: string;
    routeId: string;
    sttModelId: string;
    canonicalModelId: string;
    language: string;
    configJson: Record<string, unknown>;
    transcript: string;
    rawText: string | null;
    normalizedText: string | null;
    detectedLanguage: string | null;
    segments: IRunTranscriptSegment[];
    speakers: IRunTranscriptSpeaker[];
    providerMetadata: unknown;
    warnings: string[];
    status: string;
    error: string | null;
    createdAt: string;
    variants: IRunAudioTranscriptVariantSummary[];
}

export interface IRunNote {
    body: string;
    updatedAt: string;
    updatedBy: string | null;
}

export interface IComparableRun {
    id: string;
    createdAt: string;
    models: string[];
}

export type QualitySource = "judge" | "field";

export interface IQualityScores {
    avgJudgeScore?: number;
    avgFieldScore?: number;
}

/** The scorer both runs share: judge first, else golden field score. */
export function sharedQualitySource(
    baseline: IQualityScores,
    current: IQualityScores,
): QualitySource | undefined {
    if (
        baseline.avgJudgeScore !== undefined &&
        current.avgJudgeScore !== undefined
    )
        return "judge";
    if (
        baseline.avgFieldScore !== undefined &&
        current.avgFieldScore !== undefined
    )
        return "field";
    return undefined;
}

/** One side's quality score, on the shared scorer when the runs have one. */
export function sideQuality(
    row: IQualityScores,
    preferred?: QualitySource,
): { quality: number | undefined; qualitySource: QualitySource | undefined } {
    const qualitySource: QualitySource | undefined =
        preferred ??
        (row.avgJudgeScore !== undefined
            ? "judge"
            : row.avgFieldScore !== undefined
              ? "field"
              : undefined);
    const quality =
        qualitySource === "judge"
            ? row.avgJudgeScore
            : qualitySource === "field"
              ? row.avgFieldScore
              : undefined;
    return { quality, qualitySource };
}

export type SttShipGateStatus = "pass" | "fail" | "insufficient_data";

export interface ISttShipGateCheck {
    key:
        | "hard_failures"
        | "wer_delta"
        | "cp_wer_delta"
        | "p95_latency"
        | "judge_drop"
        | "cost_or_wer";
    label: string;
    passed: boolean | undefined;
    baseline: number | undefined;
    current: number | undefined;
    threshold: number | undefined;
    reason?: string;
}

export interface ISttShipGate {
    status: SttShipGateStatus;
    summary: string;
    checks: ISttShipGateCheck[];
}

export interface ISideMetrics {
    quality: number | undefined;
    qualitySource: QualitySource | undefined;
    cost: number | undefined;
    latency: number | undefined;
    p95Latency: number | undefined;
    sttCost: number | undefined;
    sttP95Latency: number | undefined;
    wer: number | undefined;
    cpWer: number | undefined;
    transcriptJudgeScore: number | undefined;
    hardFailureCount: number;
    effort: ReasoningEffort | undefined;
    n: number;
}

export interface IModelComparison {
    modelId: string;
    isReference: boolean;
    baseline: ISideMetrics | undefined;
    current: ISideMetrics | undefined;
    delta:
        | {
              quality: number | undefined;
              cost: number | undefined;
              latency: number | undefined;
              qualityComparable: boolean;
          }
        | undefined;
    sttShipGate: ISttShipGate | undefined;
}

export function buildSttShipGate(input: {
    baseline: ISideMetrics | undefined;
    current: ISideMetrics | undefined;
}): ISttShipGate | undefined {
    if (!input.baseline || !input.current) return undefined;
    const hasSttMetrics = [input.baseline, input.current].some(
        (side) =>
            side.wer !== undefined ||
            side.cpWer !== undefined ||
            side.transcriptJudgeScore !== undefined ||
            side.sttCost !== undefined ||
            side.sttP95Latency !== undefined ||
            side.hardFailureCount > 0,
    );
    if (!hasSttMetrics) return undefined;

    const checks: ISttShipGateCheck[] = [
        hardFailureCheck(input.baseline, input.current),
        deltaCheck({
            key: "wer_delta",
            label: "Mean WER within +2 pp",
            baseline: input.baseline.wer,
            current: input.current.wer,
            maxDelta: 0.02,
        }),
        deltaCheck({
            key: "cp_wer_delta",
            label: "Mean cpWER within +3 pp",
            baseline: input.baseline.cpWer,
            current: input.current.cpWer,
            maxDelta: 0.03,
        }),
        p95LatencyCheck(input.baseline, input.current),
        deltaCheck({
            key: "judge_drop",
            label: "Transcript judge drop no worse than 0.5",
            baseline: input.baseline.transcriptJudgeScore,
            current: input.current.transcriptJudgeScore,
            minDelta: -0.5,
        }),
        costOrWerCheck(input.baseline, input.current),
    ];

    const applicable = checks.filter((check) => check.passed !== undefined);
    if (applicable.length === 0) {
        return {
            status: "insufficient_data",
            summary: "No comparable STT methodology metrics are available.",
            checks,
        };
    }
    const failed = applicable.filter((check) => check.passed === false);
    return {
        status: failed.length > 0 ? "fail" : "pass",
        summary:
            failed.length > 0
                ? `${failed.length} STT ship gate${failed.length === 1 ? "" : "s"} failed.`
                : "All applicable STT ship gates passed.",
        checks,
    };
}

function hardFailureCheck(
    baseline: ISideMetrics,
    current: ISideMetrics,
): ISttShipGateCheck {
    const baselineCount = baseline.hardFailureCount;
    const currentCount = current.hardFailureCount;
    return {
        key: "hard_failures",
        label: "No new hard failures",
        baseline: baselineCount,
        current: currentCount,
        threshold: baselineCount,
        passed: currentCount <= baselineCount,
    };
}

function deltaCheck(input: {
    key: "wer_delta" | "cp_wer_delta" | "judge_drop";
    label: string;
    baseline: number | undefined;
    current: number | undefined;
    maxDelta?: number;
    minDelta?: number;
}): ISttShipGateCheck {
    if (input.baseline === undefined || input.current === undefined) {
        return {
            key: input.key,
            label: input.label,
            baseline: input.baseline,
            current: input.current,
            threshold: input.maxDelta ?? input.minDelta,
            passed: undefined,
            reason: "No comparable metric on both runs.",
        };
    }
    const delta = input.current - input.baseline;
    const passed =
        input.maxDelta !== undefined
            ? delta <= input.maxDelta
            : delta >= (input.minDelta ?? 0);
    return {
        key: input.key,
        label: input.label,
        baseline: input.baseline,
        current: input.current,
        threshold: input.maxDelta ?? input.minDelta,
        passed,
    };
}

function p95LatencyCheck(
    baseline: ISideMetrics,
    current: ISideMetrics,
): ISttShipGateCheck {
    const baselineLatency = baseline.sttP95Latency ?? baseline.p95Latency;
    const currentLatency = current.sttP95Latency ?? current.p95Latency;
    if (baselineLatency === undefined || currentLatency === undefined) {
        return {
            key: "p95_latency",
            label: "P95 latency <= baseline x 1.5",
            baseline: baselineLatency,
            current: currentLatency,
            threshold: undefined,
            passed: undefined,
            reason: "No comparable p95 latency on both runs.",
        };
    }
    const threshold = baselineLatency * 1.5;
    return {
        key: "p95_latency",
        label: "P95 latency <= baseline x 1.5",
        baseline: baselineLatency,
        current: currentLatency,
        threshold,
        passed: currentLatency <= threshold,
    };
}

function costOrWerCheck(
    baseline: ISideMetrics,
    current: ISideMetrics,
): ISttShipGateCheck {
    const baselineCost = preferredSttCost(baseline);
    const currentCost = preferredSttCost(current);
    const costBetter =
        baselineCost !== undefined &&
        currentCost !== undefined &&
        currentCost < baselineCost;
    const werBetter =
        baseline.wer !== undefined &&
        current.wer !== undefined &&
        current.wer < baseline.wer;
    const comparable =
        comparablePair(baselineCost, currentCost) ||
        comparablePair(baseline.wer, current.wer);
    return {
        key: "cost_or_wer",
        label: "Cheaper than baseline or lower mean WER",
        baseline: baselineCost ?? baseline.wer,
        current: currentCost ?? current.wer,
        threshold: undefined,
        passed: comparable ? costBetter || werBetter : undefined,
        ...(comparable
            ? {}
            : { reason: "No comparable cost or WER on both runs." }),
    };
}

function preferredSttCost(side: ISideMetrics): number | undefined {
    return side.sttCost ?? side.cost;
}

function comparablePair(
    baseline: number | undefined,
    current: number | undefined,
): boolean {
    return baseline !== undefined && current !== undefined;
}

/** Where a run came from: names for the ids in its config snapshot. */
export interface IRunContext {
    datasetName: string;
    /** Distinct prompt versions the run's models used. */
    prompts: Array<{
        promptId: string;
        name: string;
        version: number;
    }>;
    judge?: {
        modelId?: string;
        /** Saved judge prompt, when the judge came from one. */
        promptId?: string;
        promptName?: string;
        promptVersion?: number;
    };
}

export interface IRunDetailResponse {
    run: {
        id: string;
        teamId: string;
        datasetId: string;
        status: RunStatus;
        /** Set once a stop was asked for; see RunStopReason. */
        stopReason?: RunStopReason;
        /** Why the run failed before any cell started. */
        error?: string;
        createdAt: string;
        configSnapshot: IRunConfigSnapshot;
    };
    progress: IRunProgress;
    context?: IRunContext;
    leaderboard: ILeaderboardRow[];
    models: IRunDetailModel[];
    items: IRunDetailItem[];
    cells: IRunDetailCell[];
    scoresByCell: Record<string, IMatrixCellScore[]>;
    audioTranscripts: IRunAudioTranscriptSummary[];
    note?: IRunNote;
    comparableRuns: IComparableRun[];
    baselineRunId?: string;
    comparison?: IModelComparison[];
    /** Per-model comparison with the benchmark; set on benchmark runs. */
    benchmarkComparison?: IBenchmarkModelSummary[];
}

export interface ISaveRunNoteRequest {
    teamId: string;
    projectId: string;
    runId: string;
    body: string;
    updatedBy: string;
}

export interface ISaveCellAnnotationRequest {
    teamId: string;
    projectId: string;
    runCellId: string;
    verdict: ReviewVerdict;
    comment: string;
    updatedBy: string;
}

export interface IRunLifecycleRequest {
    teamId: string;
    projectId: string;
    runId: string;
}

export interface IApiErrorResponse {
    error: string;
    message: string;
    path?: string;
    remediation?: string;
}

export interface IProject {
    id: string;
    teamId: string;
    workspaceId: string;
    name: string;
    createdBy?: string;
    createdAt: string;
}

export type IListProjectsResponse = IProject[];

export interface IWorkspace {
    id: string;
    teamId: string;
    name: string;
    ownerUserId?: string;
    createdAt: string;
}

export type IListWorkspacesResponse = IWorkspace[];

export interface ICreateWorkspaceRequest {
    teamId: string;
    name: string;
    createdBy: string;
}

export interface IUpdateWorkspaceRequest {
    teamId: string;
    workspaceId: string;
    name: string;
    updatedBy: string;
}

export interface ICreateProjectRequest {
    teamId: string;
    workspaceId: string;
    name: string;
    createdBy: string;
}

export interface IUpdateProjectRequest {
    teamId: string;
    workspaceId: string;
    projectId: string;
    name: string;
    updatedBy: string;
}

export const PROVIDER_KEY_PROVIDERS = [
    "openai",
    "gateway",
    "soniox",
    "elevenlabs",
    "openrouter",
    "bifrost",
    "gemini",
    "anthropic",
] as const;

export type ProviderKeyProvider = (typeof PROVIDER_KEY_PROVIDERS)[number];

export function isProviderKeyProvider(
    value: string,
): value is ProviderKeyProvider {
    return (PROVIDER_KEY_PROVIDERS as readonly string[]).includes(value);
}

export interface ISetProviderKeyRequest {
    teamId: string;
    provider: ProviderKeyProvider;
    key: string;
    baseUrl?: string;
}

export interface IProviderKeyMetadata {
    /** Safe scoped record identifier; never derived from secret material. */
    id?: string;
    provider: ProviderKeyProvider;
    hint: string;
    baseUrl?: string;
}

export type IListProviderKeysResponse = IProviderKeyMetadata[];

export interface IClearProviderKeyRequest {
    teamId: string;
    provider: ProviderKeyProvider;
}

export type SttRouteProbeStatus = "available" | "failed" | "unsupported_input";

export interface ISttRouteProbeModel {
    modelId: string;
    label: string;
    providerId: SttProviderId;
    providerLabel: string;
    routeId: string;
    availabilityStatus: SttModelAvailabilityStatus;
    unavailableReason?: string;
    probe?: {
        status: SttRouteProbeStatus;
        reason?: string;
        probedAt: string;
    };
}

export interface ICreateSttRouteProbeRequest {
    teamId: string;
    projectId: string;
    modelId: string;
    probedBy: string;
}

export interface ISttRouteProbeResponse {
    modelId: string;
    routeId: string;
    status: SttRouteProbeStatus;
    transcript?: string;
    error?: string;
    probedAt: string;
}

export interface IApiClientResult<T> {
    data: T;
    requestId?: string;
}

/**
 * Server-authenticated routing identity. This is transported in internal
 * headers and is never serialized into public route-authoring JSON.
 */
export interface IWorkflowLlmTrustedContext {
    teamId: string;
    actorId: string;
}

export class FlashEvalsApiError extends Error {
    constructor(
        message: string,
        readonly status: number,
        readonly code?: string,
        readonly path?: string,
        readonly remediation?: string,
        /** Seconds to wait before retrying, from a 429 Retry-After header. */
        readonly retryAfterSeconds?: number,
    ) {
        super(message);
        this.name = "FlashEvalsApiError";
    }
}

async function apiErrorFromResponse(
    response: Response,
): Promise<FlashEvalsApiError> {
    const payload = (await response.json().catch(() => undefined)) as
        IApiErrorResponse | undefined;
    const retryAfter = Number(response.headers.get("retry-after"));
    return new FlashEvalsApiError(
        payload?.message ??
            `Flash Evals API request failed (${response.status})`,
        response.status,
        payload?.error,
        payload?.path,
        payload?.remediation,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    );
}

export class FlashEvalsApiClient {
    private readonly baseUrl: string;
    private readonly internalToken?: string;
    private readonly fetcher: typeof fetch;

    constructor(options: {
        baseUrl: string;
        internalToken?: string;
        fetcher?: typeof fetch;
    }) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.internalToken = options.internalToken;
        this.fetcher = options.fetcher ?? fetch;
    }

    async resolvePrincipal(
        input: IResolvePrincipalRequest,
    ): Promise<IPrincipalResponse> {
        return this.postJson<IPrincipalResponse>("/api/auth/principal", input);
    }

    async getDashboard(
        teamId: string,
        projectId: string,
    ): Promise<IDashboardResponse> {
        const url = new URL("/api/dashboard", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IDashboardResponse>(url);
    }

    async listWorkspaces(teamId: string): Promise<IListWorkspacesResponse> {
        const url = new URL("/api/workspaces", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        return this.getJson<IListWorkspacesResponse>(url);
    }

    async createWorkspace(input: ICreateWorkspaceRequest): Promise<IWorkspace> {
        return this.postJson<IWorkspace>("/api/workspaces", input);
    }

    async updateWorkspace(input: IUpdateWorkspaceRequest): Promise<IWorkspace> {
        return this.postJson<IWorkspace>("/api/workspaces/update", input);
    }

    async listProjects(
        teamId: string,
        workspaceId?: string,
    ): Promise<IListProjectsResponse> {
        const url = new URL("/api/projects", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        if (workspaceId) url.searchParams.set("workspaceId", workspaceId);
        return this.getJson<IListProjectsResponse>(url);
    }

    async createProject(input: ICreateProjectRequest): Promise<IProject> {
        return this.postJson<IProject>("/api/projects", input);
    }

    async updateProject(input: IUpdateProjectRequest): Promise<IProject> {
        return this.postJson<IProject>("/api/projects/update", input);
    }

    async listProviderKeys(teamId: string): Promise<IListProviderKeysResponse> {
        const url = new URL("/api/provider-keys", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        return this.getJson<IListProviderKeysResponse>(url);
    }

    async setProviderKey(input: ISetProviderKeyRequest): Promise<void> {
        await this.postJson("/api/provider-keys", input);
    }

    async clearProviderKey(input: IClearProviderKeyRequest): Promise<void> {
        await this.postJson("/api/provider-keys/clear", input);
    }

    async getProviderStatus(teamId: string): Promise<IProviderStatusResponse> {
        const url = new URL("/api/provider-status", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        return this.getJson<IProviderStatusResponse>(url);
    }

    async listModelPrices(teamId: string): Promise<IModelPriceListResponse> {
        const url = new URL("/api/model-prices", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        return this.getJson<IModelPriceListResponse>(url);
    }

    async refreshModelPrices(): Promise<void> {
        await this.postJson("/api/model-prices/refresh", {});
    }

    async listWorkflowLlmCapabilities(
        teamId: string,
        projectId: string,
    ): Promise<IWorkflowLlmCapability[]> {
        const url = new URL("/api/llm-routing/capabilities", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IWorkflowLlmCapability[]>(url);
    }

    async refreshWorkflowLlmCapabilities(
        input: IRefreshWorkflowLlmCapabilitiesRequest,
    ): Promise<IWorkflowLlmCapability[]> {
        return this.postJson<IWorkflowLlmCapability[]>(
            "/api/llm-routing/capabilities/refresh",
            input,
        );
    }

    async listWorkflowLlmRoutes(
        teamId: string,
        projectId: string,
    ): Promise<IWorkflowLlmRoute[]> {
        const url = new URL("/api/llm-routing/routes", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IWorkflowLlmRoute[]>(url);
    }

    async listWorkflowLlmRouteHistory(
        teamId: string,
        projectId: string,
        routeId: string,
        beforeVersion?: number,
        limit = 50,
    ): Promise<IWorkflowLlmRouteHistoryResponse> {
        const url = new URL(
            `/api/llm-routing/routes/${encodeURIComponent(routeId)}/history`,
            this.baseUrl,
        );
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        url.searchParams.set("limit", String(limit));
        if (beforeVersion !== undefined)
            url.searchParams.set("before", String(beforeVersion));
        return this.getJson<IWorkflowLlmRouteHistoryResponse>(url);
    }

    async createWorkflowLlmRouteVersion(
        input: ICreateWorkflowLlmRouteVersionRequest,
        context: IWorkflowLlmTrustedContext,
    ): Promise<IWorkflowLlmRoute> {
        return this.postJson<IWorkflowLlmRoute>(
            "/api/llm-routing/routes",
            input,
            context,
        );
    }

    async listWorkflowLlmRouteCandidates(
        projectId: string,
        transport: WorkflowLlmTransport,
        context: IWorkflowLlmTrustedContext,
    ): Promise<IWorkflowLlmRouteCandidatesResponse> {
        const url = new URL("/api/llm-routing/route-candidates", this.baseUrl);
        url.searchParams.set("projectId", projectId);
        url.searchParams.set("transport", transport);
        return this.getJson<IWorkflowLlmRouteCandidatesResponse>(url, context);
    }

    /** @deprecated Use createWorkflowLlmRouteVersion. */
    async createWorkflowLlmRouteForModel(
        input: ICreateWorkflowLlmRouteForModelRequest,
        context: IWorkflowLlmTrustedContext,
    ): Promise<IWorkflowLlmRoute> {
        return this.postJson<IWorkflowLlmRoute>(
            "/api/llm-routing/routes/from-provider",
            input,
            context,
        );
    }

    async disableWorkflowLlmRoute(
        input: IDisableWorkflowLlmRouteRequest,
    ): Promise<IWorkflowLlmRoute> {
        return this.postJson<IWorkflowLlmRoute>(
            `/api/llm-routing/routes/${encodeURIComponent(input.routeId)}/disable`,
            input,
        );
    }

    async getWorkflowLlmProjectDefault(
        teamId: string,
        projectId: string,
    ): Promise<IWorkflowLlmProjectDefaultResponse> {
        const url = new URL("/api/llm-routing/default", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IWorkflowLlmProjectDefaultResponse>(url);
    }

    async setWorkflowLlmProjectDefault(
        input: ISetWorkflowLlmProjectDefaultRequest,
    ): Promise<IWorkflowLlmProjectDefaultMutation> {
        return this.postJson<IWorkflowLlmProjectDefaultMutation>(
            "/api/llm-routing/default",
            input,
        );
    }

    async clearWorkflowLlmProjectDefault(
        input: IClearWorkflowLlmProjectDefaultRequest,
    ): Promise<IWorkflowLlmProjectDefaultMutation> {
        return this.postJson<IWorkflowLlmProjectDefaultMutation>(
            "/api/llm-routing/default/clear",
            input,
        );
    }

    async listSttRouteProbes(
        teamId: string,
        projectId: string,
    ): Promise<ISttRouteProbeModel[]> {
        const url = new URL("/api/stt/probes", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<ISttRouteProbeModel[]>(url);
    }

    async createSttRouteProbe(
        input: ICreateSttRouteProbeRequest,
    ): Promise<ISttRouteProbeResponse> {
        return this.postJson<ISttRouteProbeResponse>("/api/stt/probes", input);
    }

    async listDatasets(
        teamId: string,
        projectId: string,
        options: { includeArchived?: boolean; archivedOnly?: boolean } = {},
    ): Promise<IDatasetListRow[]> {
        const url = new URL("/api/datasets", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        if (options.includeArchived)
            url.searchParams.set("includeArchived", "true");
        if (options.archivedOnly) url.searchParams.set("archivedOnly", "true");
        return this.getJson<IDatasetListRow[]>(url);
    }

    async getDatasetDetail(
        teamId: string,
        projectId: string,
        datasetId: string,
    ): Promise<IDatasetDetailResponse> {
        const url = new URL(`/api/datasets/${datasetId}`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IDatasetDetailResponse>(url);
    }

    async createDataset(
        input: ICreateDatasetRequest,
    ): Promise<ICreateDatasetResponse> {
        return this.postJson<ICreateDatasetResponse>("/api/datasets", input);
    }

    async createSignedUpload(
        input: ICreateSignedUploadRequest,
    ): Promise<ICreateSignedUploadResponse> {
        return this.postJson<ICreateSignedUploadResponse>(
            "/api/datasets/upload/sign",
            input,
        );
    }

    async createDatasetItem(
        input: ICreateDatasetItemRequest,
    ): Promise<IDatasetItemMutationResponse> {
        return this.postJson<IDatasetItemMutationResponse>(
            "/api/datasets/item",
            input,
        );
    }

    async createDatasetItemFromForm(
        input: ICreateDatasetItemFromFormRequest,
    ): Promise<IDatasetItemMutationResponse> {
        return this.postJson<IDatasetItemMutationResponse>(
            "/api/datasets/item/from-form",
            input,
        );
    }

    async updateDatasetItem(
        input: IUpdateDatasetItemRequest,
    ): Promise<IDatasetItemMutationResponse> {
        return this.postJson<IDatasetItemMutationResponse>(
            "/api/datasets/item/update",
            input,
        );
    }

    async updateDatasetItemFromForm(
        input: IUpdateDatasetItemFromFormRequest,
    ): Promise<IDatasetItemMutationResponse> {
        return this.postJson<IDatasetItemMutationResponse>(
            "/api/datasets/item/update-from-form",
            input,
        );
    }

    async importImages(input: IImportImagesRequest): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/images",
            input,
        );
    }

    async importAudio(input: IImportAudioRequest): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/audio",
            input,
        );
    }

    async importImageAnswers(
        input: IImportImageAnswersRequest,
    ): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/image-answers",
            input,
        );
    }

    async importAudioAnswers(
        input: IImportAudioAnswersRequest,
    ): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/audio-answers",
            input,
        );
    }

    async importTextItems(
        input: IImportTextItemsRequest,
    ): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/text",
            input,
        );
    }

    async importGoldenAnswers(
        input: IImportGoldenAnswersRequest,
    ): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/golden-answers",
            input,
        );
    }

    async previewGoldenAnswers(
        input: IPreviewGoldenAnswersRequest,
    ): Promise<IAnswerImportPreview> {
        return this.postJson<IAnswerImportPreview>(
            "/api/datasets/import/golden-answers/preview",
            input,
        );
    }

    async commitGoldenAnswers(
        input: ICommitGoldenAnswersRequest,
    ): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/golden-answers/commit",
            input,
        );
    }

    async importPairedItems(
        input: IImportPairedItemsRequest,
    ): Promise<IImportSummary> {
        return this.postJson<IImportSummary>(
            "/api/datasets/import/paired",
            input,
        );
    }

    async updateDatasetName(input: IUpdateDatasetNameRequest): Promise<void> {
        await this.postJson("/api/datasets/name", input);
    }

    async updateDatasetDescription(
        input: IUpdateDatasetDescriptionRequest,
    ): Promise<void> {
        await this.postJson("/api/datasets/description", input);
    }

    async setDatasetArchived(input: ISetDatasetArchivedRequest): Promise<void> {
        await this.postJson("/api/datasets/archive", input);
    }

    async duplicateDataset(
        input: IDuplicateDatasetRequest,
    ): Promise<IDuplicateDatasetResponse> {
        return this.postJson<IDuplicateDatasetResponse>(
            "/api/datasets/duplicate",
            input,
        );
    }

    async deleteDataset(input: IDeleteDatasetRequest): Promise<void> {
        await this.postJson("/api/datasets/delete", input);
    }

    async deleteLabel(
        input: IDeleteLabelRequest,
    ): Promise<{ datasetId: string }> {
        return this.postJson<{ datasetId: string }>(
            "/api/datasets/label/delete",
            input,
        );
    }

    async deleteDatasetItem(
        input: IDeleteDatasetItemRequest,
    ): Promise<{ datasetId: string }> {
        return this.postJson<{ datasetId: string }>(
            "/api/datasets/item/delete",
            input,
        );
    }

    async listPrompts(
        teamId: string,
        projectId: string,
    ): Promise<IPromptListRow[]> {
        const url = new URL("/api/prompts", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IPromptListRow[]>(url);
    }

    async getPromptDetail(
        teamId: string,
        projectId: string,
        promptId: string,
    ): Promise<IPromptDetailResponse> {
        const url = new URL(`/api/prompts/${promptId}`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IPromptDetailResponse>(url);
    }

    async getNewPromptWorkbench(
        teamId: string,
        projectId: string,
    ): Promise<IPromptWorkbenchSetupResponse> {
        const url = new URL("/api/prompts/workbench", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IPromptWorkbenchSetupResponse>(url);
    }

    async getEditPromptWorkbench(
        teamId: string,
        projectId: string,
        promptId: string,
    ): Promise<IPromptWorkbenchSetupResponse> {
        const url = new URL(`/api/prompts/${promptId}/workbench`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IPromptWorkbenchSetupResponse>(url);
    }

    async deletePrompt(input: IDeletePromptRequest): Promise<void> {
        await this.postJson("/api/prompts/delete", input);
    }

    async duplicatePromptVersion(
        input: IDuplicatePromptVersionRequest,
    ): Promise<IDuplicatePromptVersionResponse> {
        return this.postJson<IDuplicatePromptVersionResponse>(
            "/api/prompts/duplicate-version",
            input,
        );
    }

    async createJudgePrompt(
        input: ICreateJudgePromptRequest,
    ): Promise<ICreateJudgePromptResponse> {
        return this.postJson<ICreateJudgePromptResponse>(
            "/api/prompts/judge",
            input,
        );
    }

    async recordPromptValidationAttempt(
        input: IRecordPromptValidationAttemptRequest,
    ): Promise<void> {
        await this.postJson("/api/prompts/validation-attempt", input);
    }

    async saveRunnablePrompt(
        input: ISaveRunnablePromptRequest,
    ): Promise<ISaveRunnablePromptResponse> {
        return this.postJson<ISaveRunnablePromptResponse>(
            "/api/prompts/runnable",
            input,
        );
    }

    async optimizePrompt(
        input: IOptimizePromptRequest,
    ): Promise<IOptimizePromptResponse> {
        return this.postJson<IOptimizePromptResponse>(
            "/api/prompts/optimize",
            input,
        );
    }

    async generatePromptSchema(
        input: IGeneratePromptSchemaRequest,
    ): Promise<IGeneratePromptSchemaResponse> {
        return this.postJson<IGeneratePromptSchemaResponse>(
            "/api/prompts/generate-schema",
            input,
        );
    }

    async testJudgeDraft(
        input: ITestJudgeDraftRequest,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<ITestJudgeDraftResponse> {
        return this.postJson<ITestJudgeDraftResponse>(
            "/api/prompts/test-judge",
            input,
            context,
        );
    }

    async testPromptDraft(
        input: ITestPromptDraftRequest,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<ITestPromptDraftResponse> {
        return this.postJson<ITestPromptDraftResponse>(
            "/api/prompts/test-draft",
            input,
            context,
        );
    }

    async validateRunnablePrompt(
        input: IValidateRunnablePromptRequest,
    ): Promise<IValidateRunnablePromptResponse> {
        return this.postJson<IValidateRunnablePromptResponse>(
            "/api/prompts/validate-runnable",
            input,
        );
    }

    async listRuns(teamId: string, projectId: string): Promise<IRunListRow[]> {
        const url = new URL("/api/runs", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IRunListRow[]>(url);
    }

    async listWorkflows(
        teamId: string,
        projectId: string,
        kind?: WorkflowKind,
    ): Promise<IWorkflowSummary[]> {
        const url = new URL("/api/workflows", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        if (kind) url.searchParams.set("kind", kind);
        return this.getJson<IWorkflowSummary[]>(url);
    }

    async getWorkflow(
        teamId: string,
        projectId: string,
        workflowId: string,
    ): Promise<IPromptWorkflow> {
        const url = new URL(`/api/workflows/${workflowId}`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IPromptWorkflow>(url);
    }

    async createWorkflow(
        input: ICreateWorkflowRequest,
    ): Promise<IPromptWorkflow> {
        return this.postJson<IPromptWorkflow>("/api/workflows", input);
    }

    async updateWorkflow(
        input: IUpdateWorkflowRequest,
    ): Promise<IPromptWorkflow> {
        return this.postJson<IPromptWorkflow>(
            `/api/workflows/${input.workflowId}`,
            input,
        );
    }

    async deleteWorkflow(input: IDeleteWorkflowRequest): Promise<void> {
        await this.postJson("/api/workflows/delete", input);
    }

    async createWorkflowRun(
        input: ICreateWorkflowRunRequest,
    ): Promise<ICreateWorkflowRunResponse> {
        return this.postJson<ICreateWorkflowRunResponse>(
            `/api/workflows/${input.workflowId}/runs`,
            input,
        );
    }

    async retryWorkflowRun(
        input: IRetryWorkflowRunRequest,
    ): Promise<IRetryWorkflowRunResponse> {
        return this.postJson<IRetryWorkflowRunResponse>(
            `/api/workflows/${input.workflowId}/runs/${input.workflowRunId}/retry`,
            input,
        );
    }

    async cancelWorkflowRun(
        input: ICancelWorkflowRunRequest,
    ): Promise<ICancelWorkflowRunResponse> {
        return this.postJson<ICancelWorkflowRunResponse>(
            `/api/workflows/${input.workflowId}/runs/${input.workflowRunId}/cancel`,
            input,
        );
    }

    async listWorkflowRuns(
        teamId: string,
        projectId: string,
        workflowId: string,
    ): Promise<IWorkflowRunSummary[]> {
        const url = new URL(`/api/workflows/${workflowId}/runs`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IWorkflowRunSummary[]>(url);
    }

    /**
     * Eval runs a pipeline run can be compared with: finished, with a
     * benchmark Task Map, newest first; on one dataset when given.
     */
    async listPipelineComparisonRuns(
        teamId: string,
        projectId: string,
        datasetId?: string,
    ): Promise<IPipelineComparisonRunOption[]> {
        const url = new URL("/api/workflow-comparison-runs", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        if (datasetId) url.searchParams.set("datasetId", datasetId);
        return this.getJson<IPipelineComparisonRunOption[]>(url);
    }

    /** Start a setup comparison: one eval run plus one pipeline run per pipeline. */
    async createSetupComparison(
        input: ICreateSetupComparisonRequest,
    ): Promise<ICreateSetupComparisonResponse> {
        return this.postJson<ICreateSetupComparisonResponse>(
            "/api/setup-comparisons",
            input,
        );
    }

    async getSetupComparison(
        teamId: string,
        projectId: string,
        setupComparisonId: string,
    ): Promise<ISetupComparison> {
        const url = new URL(
            `/api/setup-comparisons/${setupComparisonId}`,
            this.baseUrl,
        );
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<ISetupComparison>(url);
    }

    /** Cancel every member run of a setup comparison. */
    async cancelSetupComparison(
        input: ICancelSetupComparisonRequest,
    ): Promise<ICancelSetupComparisonResponse> {
        return this.postJson<ICancelSetupComparisonResponse>(
            `/api/setup-comparisons/${input.setupComparisonId}/cancel`,
            input,
        );
    }

    /** Saved pipelines the setup comparison launcher can offer. */
    async listSetupComparisonPipelines(
        teamId: string,
        projectId: string,
    ): Promise<ISetupComparisonPipelineOption[]> {
        const url = new URL("/api/setup-comparison-pipelines", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<ISetupComparisonPipelineOption[]>(url);
    }

    async getWorkflowRunDetail(
        teamId: string,
        projectId: string,
        workflowId: string,
        workflowRunId: string,
    ): Promise<IWorkflowRunDetailResponse> {
        const url = new URL(
            `/api/workflows/${workflowId}/runs/${workflowRunId}`,
            this.baseUrl,
        );
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IWorkflowRunDetailResponse>(url);
    }

    async getWorkflowRunProgress(
        teamId: string,
        projectId: string,
        workflowId: string,
        workflowRunId: string,
    ): Promise<IWorkflowRunProgressResponse> {
        const url = new URL(
            `/api/workflows/${workflowId}/runs/${workflowRunId}/progress`,
            this.baseUrl,
        );
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IWorkflowRunProgressResponse>(url);
    }

    async getRunSetup(
        teamId: string,
        projectId: string,
    ): Promise<IRunSetupResponse> {
        const url = new URL("/api/runs/setup", this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJson<IRunSetupResponse>(url);
    }

    async countItemFilterMatches(
        input: ICountItemFilterMatchesRequest,
    ): Promise<ICountItemFilterMatchesResponse> {
        return this.postJson<ICountItemFilterMatchesResponse>(
            "/api/runs/item-filter-count",
            input,
        );
    }

    async createRun(input: ICreateRunRequest): Promise<ICreateRunResponse> {
        return this.postJson<ICreateRunResponse>("/api/runs", input);
    }

    async createRunFromSelection(
        input: ICreateRunFromSelectionRequest,
    ): Promise<ICreateRunResponse> {
        return this.postJson<ICreateRunResponse>(
            "/api/runs/from-selection",
            input,
        );
    }

    async proposeBenchmarkTaskMap(
        input: IProposeBenchmarkTaskMapRequest,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<IProposeBenchmarkTaskMapResponse> {
        return this.postJson<IProposeBenchmarkTaskMapResponse>(
            "/api/runs/propose-benchmark-task-map",
            input,
            context,
        );
    }

    async generateJudgeForRun(
        input: IGenerateJudgeForRunRequest,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<IGenerateJudgeForRunResponse> {
        return this.postJson<IGenerateJudgeForRunResponse>(
            "/api/runs/generate-judge",
            input,
            context,
        );
    }

    async getRunProgress(
        teamId: string,
        projectId: string,
        runId: string,
    ): Promise<IRunProgressResponse> {
        return (await this.getRunProgressResult(teamId, projectId, runId)).data;
    }

    async getRunProgressResult(
        teamId: string,
        projectId: string,
        runId: string,
    ): Promise<IApiClientResult<IRunProgressResponse>> {
        const url = new URL(`/api/runs/${runId}/progress`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        return this.getJsonResult<IRunProgressResponse>(url);
    }

    async getRunDetail(
        teamId: string,
        projectId: string,
        runId: string,
        options: { compareWith?: string } = {},
    ): Promise<IRunDetailResponse> {
        const url = new URL(`/api/runs/${runId}`, this.baseUrl);
        url.searchParams.set("teamId", teamId);
        url.searchParams.set("projectId", projectId);
        if (options.compareWith)
            url.searchParams.set("compareWith", options.compareWith);
        return this.getJson<IRunDetailResponse>(url);
    }

    async saveRunNote(input: ISaveRunNoteRequest): Promise<void> {
        await this.postJson("/api/runs/note", input);
    }

    async listRunDisagreements(input: {
        teamId: string;
        projectId: string;
        runId: string;
        runModelId: string;
        taskKey: string;
    }): Promise<IRunDisagreementsResponse> {
        const url = new URL(
            `/api/runs/${encodeURIComponent(input.runId)}/disagreements`,
            this.baseUrl,
        );
        url.searchParams.set("teamId", input.teamId);
        url.searchParams.set("projectId", input.projectId);
        url.searchParams.set("runModelId", input.runModelId);
        url.searchParams.set("taskKey", input.taskKey);
        return this.getJson<IRunDisagreementsResponse>(url);
    }

    async decideDisagreement(
        input: IDecideDisagreementRequest,
    ): Promise<IDecideDisagreementResponse> {
        return this.postJson<IDecideDisagreementResponse>(
            "/api/runs/disagreements/decide",
            input,
        );
    }

    async saveCellAnnotation(input: ISaveCellAnnotationRequest): Promise<{
        runId: string;
    }> {
        return this.postJson<{ runId: string }>(
            "/api/runs/cell-annotation",
            input,
        );
    }

    async deleteRun(input: IRunLifecycleRequest): Promise<void> {
        await this.postJson("/api/runs/delete", input);
    }

    async retryRun(
        input: IRunLifecycleRequest,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<IRetryRunResponse | undefined> {
        return this.postJson<IRetryRunResponse | undefined>(
            "/api/runs/retry",
            input,
            context,
        );
    }

    async cancelRun(
        input: IRunLifecycleRequest,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<ICancelRunResponse> {
        return this.postJson<ICancelRunResponse>(
            "/api/runs/cancel",
            input,
            context,
        );
    }

    private async getJson<T>(
        url: URL,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<T> {
        return (await this.getJsonResult<T>(url, context)).data;
    }

    private async getJsonResult<T>(
        url: URL,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<IApiClientResult<T>> {
        const response = await this.fetcher(url, {
            method: "GET",
            headers: this.headers(context),
            cache: "no-store",
        });
        if (response.ok) {
            return {
                data: (await response.json()) as T,
                requestId: response.headers.get("x-request-id") ?? undefined,
            };
        }

        throw await apiErrorFromResponse(response);
    }

    private async postJson<T = void>(
        path: string,
        body: unknown,
        context?: IWorkflowLlmTrustedContext,
    ): Promise<T> {
        const response = await this.fetcher(new URL(path, this.baseUrl), {
            method: "POST",
            headers: {
                ...this.headers(context),
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
            cache: "no-store",
        });
        if (response.ok) {
            if (response.status === 204) return undefined as T;
            return response.json() as Promise<T>;
        }

        throw await apiErrorFromResponse(response);
    }

    private headers(
        context?: IWorkflowLlmTrustedContext,
    ): Record<string, string> {
        return {
            ...(this.internalToken
                ? { "X-Flash-Evals-Internal-Token": this.internalToken }
                : {}),
            ...(context
                ? {
                      "X-Flash-Evals-Team-Id": context.teamId,
                      "X-Flash-Evals-Actor-Id": context.actorId,
                  }
                : {}),
        };
    }
}

/** A saved placeholder object is not a golden answer. Zero, false and null field values are valid answers. */
export function hasGoldenLabel(
    label: LabelJson | null | undefined,
): label is LabelJson {
    return label != null && Object.keys(label).length > 0;
}
