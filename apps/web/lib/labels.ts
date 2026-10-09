import type {
    CellStatus,
    IDatasetListRow,
    IPipelineFieldConfig,
    IPromptDetailVersion,
    IPromptListRow,
    IWorkflowLlmCachePolicy,
    IWorkflowLlmRetryPolicy,
    IWorkflowLlmRouteCandidate,
    ReasoningEffort,
    RunStatus,
    WorkflowLlmTransport,
    WorkflowNodeType,
} from "@mosaic/api-contract";

// Display labels for enum values. Every raw enum a user can see goes through
// here, so the same value reads the same way everywhere (sentence case, per
// the DESIGN.md Copy rules; proper nouns keep their case).

export type PromptVersionStatus = IPromptDetailVersion["status"];

export type { CellStatus, RunStatus };

// Map keys come from the contract, so a new enum value is a type error here
// rather than a silently humanized label.
type UpstreamMode = Exclude<
    IWorkflowLlmRouteCandidate["support"]["upstreamRoutingModes"][number],
    "none"
>;

export const RUN_STATUS_LABELS: Record<RunStatus, string> = {
    pending: "Pending",
    running: "Running",
    completed: "Completed",
    partial: "Partial",
    failed: "Failed",
};

export const CELL_STATUS_LABELS: Record<CellStatus, string> = {
    pending: "Pending",
    running: "Running",
    succeeded: "Succeeded",
    failed: "Failed",
    cached: "Cached",
};

export const NODE_TYPE_LABELS: Record<WorkflowNodeType, string> = {
    input: "Input",
    prompt: "Prompt",
    stt: "Speech to text",
    llm_text: "LLM text",
    transliterate: "Transliterate",
    judge: "Judge",
    metric_compare: "Metric compare",
};

export const TRANSPORT_LABELS: Record<WorkflowLlmTransport, string> = {
    openai: "OpenAI",
    gateway: "Vercel AI Gateway",
    openrouter: "OpenRouter",
    bifrost: "Bifrost",
};

export const REASONING_EFFORT_LABELS: Record<ReasoningEffort, string> = {
    none: "None",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra high",
};

export const UPSTREAM_MODE_LABELS: Record<UpstreamMode, string> = {
    auto: "Automatic",
    preference: "Preferred providers",
    exact: "Exact providers",
};

export const MOSAIC_REUSE_LABELS: Record<
    IWorkflowLlmCachePolicy["mosaicReuse"],
    string
> = {
    allow: "Allowed",
    force_fresh: "Force fresh",
};

export const RETRY_OWNER_LABELS: Record<
    IWorkflowLlmRetryPolicy["owner"],
    string
> = {
    mosaic: "Flash Evals",
    gateway: "Gateway",
};

export const PROMPT_KIND_LABELS: Record<IPromptListRow["kind"], string> = {
    eval: "Eval",
    judge: "Judge",
};

export const PROMPT_STATUS_LABELS: Record<PromptVersionStatus, string> = {
    legacy: "Legacy",
    runnable: "Runnable",
};

export const SCORING_KIND_LABELS: Record<IPipelineFieldConfig["kind"], string> =
    {
        factual: "Factual",
        generative: "Generative",
    };

/** Item `type` arrives as a plain string; known values are the modalities. */
export const ITEM_TYPE_LABELS: Record<IDatasetListRow["modality"], string> = {
    text: "Text",
    image: "Image",
    audio: "Audio",
};

/**
 * "force_fresh" → "Force fresh": the sentence-case fallback for values with
 * no entry (they are shown as labels and badges).
 */
export function humanize(value: string): string {
    const words = value.replace(/[_-]+/g, " ").trim().replace(/\s+/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The mapped label, or a humanized form of an unknown value. */
export function labelFor<K extends string>(
    labels: Partial<Record<K, string>>,
    value: K | undefined,
): string {
    if (value === undefined) return "";
    return labels[value] ?? humanize(value);
}
