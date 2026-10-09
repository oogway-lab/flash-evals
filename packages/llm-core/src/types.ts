export interface ApiKeys {
    openai?: string;
    gateway?: string;
    openrouter?: string;
    openrouterBaseUrl?: string;
    bifrost?: string;
    bifrostBaseUrl?: string;
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
    | "catalog_estimate"
    | "unavailable";

export type CompletionTransport =
    "openai" | "gateway" | "openrouter" | "bifrost";

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
    owner: "mosaic" | "gateway";
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
    maxTokens: number;
    temperature?: number;
    topP?: number;
    seed?: number;
    reasoningEffort?: ReasoningEffort;
    timeoutMs?: number;
    maxRetries?: number;
    retryOwner?: "mosaic" | "gateway";
    route?: ICompletionRoute;
    cachePolicy?: ICompletionCachePolicy;
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
}

export interface IEvalCompletionProvider {
    complete(req: CompletionRequest): Promise<CompletionResult>;
}

export function getBareModelName(modelId: string): string {
    const idx = modelId.indexOf("::");
    return idx === -1 ? modelId : modelId.slice(idx + 2);
}
