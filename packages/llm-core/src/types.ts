export interface ApiKeys {
    openai?: string;
    gateway?: string;
    openrouter?: string;
    openrouterBaseUrl?: string;
    bifrost?: string;
    bifrostBaseUrl?: string;
    /** Anthropic API key, from Settings only. */
    anthropic?: string;
    /** Gemini API key (Google AI Studio), from Settings only. */
    google?: string;
    /**
     * Why a provider saved in Settings can't be used right now (its saved
     * base URL failed a re-check); its key is left out, and a call that
     * needs it fails with this reason.
     */
    unusable?: Partial<Record<"openrouter" | "bifrost", string>>;
}

export const REASONING_EFFORT_LEVELS = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
] as const;

export type ReasoningEffort = (typeof REASONING_EFFORT_LEVELS)[number];

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

export interface UsageData {
    promptTokens?: number;
    /** Total output tokens, including reasoning tokens. */
    completionTokens?: number;
    reasoningTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    totalTokens?: number;
}

export type CostSource = "computed" | "unavailable";

export type CompletionCostSource =
    | "provider_reported"
    | "gateway_reported"
    /** Priced at the price Bifrost's model list gives the id it was sent as. */
    | "bifrost_list_price"
    | "catalog_estimate"
    | "unavailable";

/**
 * Where a call's cost came from: the provider reported it, Bifrost's model
 * list priced it, or the model registry's list price did.
 */
export type CostBasis =
    "reported" | "bifrost_list_price" | "registry_list_price";

export type CompletionTransport =
    "openai" | "gateway" | "openrouter" | "bifrost" | "anthropic" | "google";

export type CompletionUpstreamPolicy =
    | { mode: "none" }
    | { mode: "auto" }
    | {
          mode: "preference";
          order: string[];
          allowFallbacks: boolean;
      }
    | { mode: "exact"; only: string[] };

export interface ICompletionRoute {
    transport: CompletionTransport;
    transportModelId: string;
    upstreamPolicy: CompletionUpstreamPolicy;
    requireParameters?: boolean;
}

export interface ICompletionCachePolicy {
    providerCaching: "allow";
    responseCache?: "allow" | "disable";
}

export type ICompletionActualRoute =
    | {
          status: "resolved";
          transport: CompletionTransport;
          modelId: string;
          upstreamProvider?: string;
          generationId?: string;
          evidenceCompleteness: "complete" | "partial";
      }
    | {
          status: "unresolved";
          transport?: CompletionTransport;
          modelId?: string;
          upstreamProvider?: string;
          generationId?: string;
          evidenceCompleteness: "partial" | "absent";
      }
    | {
          status: "unavailable";
          evidenceCompleteness: "absent";
      }
    | {
          status: "not_invoked";
          generationId?: string;
          evidenceCompleteness: "complete";
      };

export interface ICompletionAttempt {
    sequence: number;
    owner: "flash-evals" | "gateway";
    requested: ICompletionRoute;
    actual?: ICompletionActualRoute;
    outcome: "succeeded" | "failed";
    errorClass?: string;
    latencyMs?: number;
}

export type ICompletionCost =
    | {
          usd: number;
          source: Exclude<CompletionCostSource, "unavailable">;
      }
    | { source: "unavailable"; usd?: never };

export type CompletionCacheProvenance =
    | { status: "miss" | "disabled" }
    | {
          status: "provider_cache";
          kind: "prompt" | "response";
          hit: boolean;
      };

export interface ProviderMetadata {
    gateway?: {
        generationId?: string;
    };
    /**
     * The hosting company that actually served the call, as the gateway
     * reports it (Vercel's routing.finalProvider, OpenRouter's provider).
     */
    servedBy?: string;
    /** Whether a requested thinking level was sent (stored with eval cells). */
    thinking?: IThinkingOutcome;
    /** Thinking tokens the provider reported (stored with eval cells). */
    reasoningTokens?: number;
    /** Where the call's cost came from (stored with eval cells). */
    costBasis?: CostBasis;
    /**
     * The provider the call went over, as resolved when the run left it to
     * "auto" (stored with eval cells, so a saved answer is reused only for
     * the same provider). An `EvalProviderTransport`.
     */
    transport?: string;
}

/**
 * Rules on who may serve a call and what they may keep. Gateways that route
 * between hosting companies (Vercel AI Gateway, OpenRouter) follow all of
 * them. Direct Anthropic and Google calls are always served by the maker, so
 * they follow an `onlyHosts` list that names it and refuse the other rules;
 * other transports refuse a call that sets any.
 */
export interface ICompletionDataPolicy {
    /**
     * Hosting companies allowed to serve the call, in the gateway's own names
     * (Vercel: "vertex", "bedrock", "anthropic"; OpenRouter: "google-vertex",
     * "together", "fireworks").
     */
    onlyHosts?: string[];
    /** Only hosts with a zero-data-retention agreement. */
    zeroDataRetention?: boolean;
    /** Only hosts that don't train on prompts. */
    disallowPromptTraining?: boolean;
}

/** True when the policy sets any rule. */
export function hasDataPolicy(
    policy: ICompletionDataPolicy | undefined,
): boolean {
    return Boolean(
        policy &&
        ((policy.onlyHosts?.length ?? 0) > 0 ||
            policy.zeroDataRetention ||
            policy.disallowPromptTraining),
    );
}

export interface EvalImage {
    mimeType: string;
    base64Data: string;
}

export interface ResponseSchema {
    name: string;
    schema: Record<string, unknown>;
    strict?: boolean;
}

export interface CompletionRequest {
    model: string;
    system?: string;
    prompt: string;
    images?: EvalImage[];
    responseSchema?: ResponseSchema;
    /**
     * Ask for any JSON object (OpenAI's `json_object`), without a schema;
     * the caller parses and checks the reply. Ignored with `responseSchema`.
     */
    jsonMode?: boolean;
    maxTokens: number;
    temperature?: number;
    topP?: number;
    seed?: number;
    reasoningEffort?: ReasoningEffort;
    timeoutMs?: number;
    maxRetries?: number;
    retryOwner?: "flash-evals" | "gateway";
    route?: ICompletionRoute;
    cachePolicy?: ICompletionCachePolicy;
    /** Who may serve the call; see ICompletionDataPolicy. */
    dataPolicy?: ICompletionDataPolicy;
    signal?: AbortSignal;
}

export interface CompletionResult {
    text: string;
    parsed?: unknown;
    /** Set when structured output was requested but parsing failed. */
    schemaViolation?: boolean;
    usage: UsageData;
    latencyMs: number;
    actualRoute?: ICompletionActualRoute;
    attempts?: ICompletionAttempt[];
    cache?: CompletionCacheProvenance;
    cost?: ICompletionCost;
    providerMetadata?: ProviderMetadata;
    /** Set when a thinking level was requested: whether it was sent. */
    thinking?: IThinkingOutcome;
    /** Plain-words notes about the call, e.g. an output limit too high. */
    warnings?: string[];
}

export interface IEvalCompletionProvider {
    complete(req: CompletionRequest): Promise<CompletionResult>;
}

export function getBareModelName(modelId: string): string {
    const idx = modelId.indexOf("::");
    return idx === -1 ? modelId : modelId.slice(idx + 2);
}
