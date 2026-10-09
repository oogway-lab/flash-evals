import type {
    ISttRunConfig,
    ISttRunVariant,
    IPromptOptimizerGuidanceSource as ContractPromptOptimizerGuidanceSource,
    ReasoningEffort,
    ProviderTransport,
    WorkflowKind,
    WorkflowNodeType,
    IWorkflowNodeConfig,
    IWorkflowNodeArtifact,
    IWorkflowLlmResolvedExecution,
} from "@mosaic/api-contract";

export type FieldMatcher = "exact" | "numeric_tolerance" | "set_overlap";

export type FieldRule =
    | { field: string; matcher: "exact" }
    | {
          field: string;
          matcher: "numeric_tolerance";
          tolerance: number;
          relative?: boolean;
      }
    | { field: string; matcher: "set_overlap" };

export interface JsonSchemaObject {
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

export type LabelFieldErrorCode = "required" | "unknown" | "type" | "reserved";

export interface ILabelFieldError {
    field: string;
    code: LabelFieldErrorCode;
    expected?: SchemaFieldType;
}

export type LabelJson = Record<string, unknown>;
export type OutputJson = Record<string, unknown>;

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

export type IPromptOptimizerGuidanceSource =
    ContractPromptOptimizerGuidanceSource;

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

export interface IReasoningConfig {
    effort: ReasoningEffort;
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

export interface IWorkflowSnapshotNode {
    id: string;
    nodeKey: string;
    label: string;
    nodeType?: WorkflowNodeType;
    nodeConfig?: IWorkflowNodeConfig;
    promptVersionId?: string;
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
        declaredInputs: JudgeDeclaredInput[];
        reasoningEffort?: ReasoningEffort;
    };
    resolvedLlmExecution?: IWorkflowLlmResolvedExecution;
    modelId?: string;
    reasoningConfig?: IReasoningConfig;
    evalConfig: IWorkflowNodeEvalConfig;
    position?: IWorkflowNodePosition;
}

export interface IWorkflowSnapshotEdge {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    carryOriginalInput: boolean;
}

export interface IWorkflowSnapshot {
    workflowId: string;
    name: string;
    kind?: WorkflowKind;
    nodes: IWorkflowSnapshotNode[];
    edges: IWorkflowSnapshotEdge[];
    sttConfig?: ISttRunConfig;
}

export type WorkflowNodeArtifact = IWorkflowNodeArtifact;
export type WorkflowNodeConfig = IWorkflowNodeConfig;

export interface ITranscriptSegment {
    text: string;
    startMs?: number;
    endMs?: number;
    speaker?: string;
    language?: string;
}

export interface ITranscriptSpeaker {
    id: string;
    label?: string;
}

export interface IAudioSpeakerTurn {
    speaker: string;
    text: string;
    startMs?: number;
    endMs?: number;
}

export type AudioReferenceKind = "human_gold" | "silver" | "prod_reference";

export interface IAudioReferenceLabel {
    referenceKind?: AudioReferenceKind;
    expectedTranscript?: string;
    expectedTranscriptLatin?: string;
    expectedLanguage?: string;
    expectedSpeakerTurns?: IAudioSpeakerTurn[];
    audioDurationMs?: number;
    domainTerms?: string[];
    expectedNumbers?: number[];
    latencySlaMs?: number;
    costOutlierUsd?: number;
}

export interface IAudioTranscriptMetadata {
    provider?: string;
    route?: string;
    model?: string;
    configHash?: string;
    latencyMsTotal?: number;
    costUsd?: number;
    costSource?: "computed" | "unavailable";
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
        thinkingTokens?: number;
        totalTokens?: number;
    };
    diarizationMode?: "native" | "prompt-derived";
    promptSupported?: boolean;
    raw?: unknown;
}

/** Provider metadata safe to expose with a workflow STT result. */
export interface IWorkflowSttProviderMetadata {
    requestId?: string;
    providerMode?: string;
    providerBaseUrl?: string;
}

export interface IWorkflowSttScoreDetails {
    metricKind?: "mechanical_stt" | "llm_judge";
    referenceKind?: AudioReferenceKind;
    referenceField?: string;
    [key: string]: unknown;
}

export interface IAudioTranscriptVariantMetadata {
    provider?: string;
    model?: string;
    providerMode?: string;
    providerBaseUrl?: string;
    sourceHash?: string;
}

export type PromptKind = "eval" | "judge";

export type JudgeDeclaredInput =
    "task_input" | "candidate_output" | "reference";

export interface IJudgeSpec {
    modelId: string;
    transport?: ProviderTransport;
    declaredInputs: JudgeDeclaredInput[];
}

export interface RunModelSpec {
    modelId: string;
    transport?: ProviderTransport;
    promptVersionId?: string | null;
    schemaVersionId?: string;
    promptSnapshot?: IRunModelPromptSnapshot;
    reasoningConfig?: IReasoningConfig;
    isReference: boolean;
}

export interface RunConfigSnapshot {
    datasetId: string;
    models: RunModelSpec[];
    judgeConfigId?: string;
    judgePromptVersionId?: string;
    judgeTransport?: ProviderTransport;
    maxTokens: number;
    pipelineId?: string;
    fieldConfigs?: IPipelineFieldConfig[];
    sourceRunId?: string;
    sttConfig?: ISttRunConfig;
    sttVariants?: Record<string, ISttRunVariant>;
    audioRunMode?: "stt_metrics" | "prompt_eval";
}

export interface FieldResult {
    field: string;
    matcher: FieldMatcher;
    score: number;
    expected: unknown;
    actual: unknown;
}

export interface FieldDiffDetails {
    fields: FieldResult[];
}

export interface IGenerativeFieldResult {
    field: string;
    score: number | null;
    rationale: string;
}

export interface IJudgeDetails {
    fields: IGenerativeFieldResult[];
    errorCount: number;
}

// Per-criterion breakdown for a rubric judge, stored in cell_scores.detailsJson
// as { criteria }. The overall judge score stays a separate model-emitted value.
export interface IJudgeCriterion {
    name: string;
    score: number;
    reasoning: string;
}
