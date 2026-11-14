import bundledCatalogs from "./catalog.snapshot.json" with { type: "json" };
import {
    mergeModelCatalogs,
    orderCatalogSnapshots,
    readCatalogSnapshot,
    type IModelCatalogSnapshot,
} from "./catalog.js";
import type { ReasoningEffort } from "../types.js";
import { claudeRejectsSampling } from "./claudeLimits.js";
import type { ICostPricing, ICostPricingTier } from "../cost.js";

export type KnownModelProvider =
    "openai" | "anthropic" | "google" | "xai" | "meta" | "mistral" | "alibaba";
/** Live provider catalog identifiers are intentionally open-ended. */
export type ModelProvider = KnownModelProvider | (string & {});

export type EvalProviderTransport =
    "openai" | "gateway" | "openrouter" | "bifrost" | "anthropic" | "google";

/** Transports that call the model's maker directly with a key from Settings. */
export type DirectMakerTransport = "anthropic" | "google";

export const DIRECT_MAKER_TRANSPORTS: readonly DirectMakerTransport[] = [
    "anthropic",
    "google",
];

export function isDirectMakerTransport(
    transport: string | undefined,
): transport is DirectMakerTransport {
    return transport === "anthropic" || transport === "google";
}

/**
 * Host names a run's data rules can use to allow a direct call. The first is
 * the name recorded as "served by"; it matches Vercel AI Gateway's name for the
 * maker, and the rest are OpenRouter's names for the same company.
 */
export const DIRECT_MAKER_HOSTS: Readonly<
    Record<DirectMakerTransport, readonly string[]>
> = {
    anthropic: ["anthropic"],
    google: ["google", "google-ai-studio"],
};
export type ModelTransports = Readonly<
    Partial<Record<EvalProviderTransport, string>>
>;

export type ModelGenerationControl =
    "maxOutputTokens" | "temperature" | "topP" | "seed" | "reasoningEffort";

export type UpstreamRoutingMode = "none" | "auto" | "preference" | "exact";

/**
 * Static registry facts only. Gateway-backed entries still require current
 * provider discovery before a route is activated or frozen into a run.
 */
export interface IModelTransportCapability {
    transport: EvalProviderTransport;
    transportModelId: string;
    upstreamRoutingModes: readonly UpstreamRoutingMode[];
    supportedGenerationControls: readonly ModelGenerationControl[];
    supportsStructuredOutput: boolean;
    requiresCurrentDiscovery: boolean;
}

export interface IReasoningEffortCapability {
    supportedLevels: readonly ReasoningEffort[];
    defaultLevel: ReasoningEffort;
}

export type IModelPricing = ICostPricing;
export type IModelPricingTier = ICostPricingTier;

export interface IModelRegistryEntry {
    id: string;
    gatewayModelId: string;
    label: string;
    family: string;
    provider: ModelProvider;
    providerLabel: string;
    reasoning: boolean;
    vision: boolean;
    structuredOutput: boolean;
    judgeSuitable: boolean;
    supportsOpenAI: boolean;
    supportsGateway: boolean;
    transports: ModelTransports;
    reasoningEffort?: IReasoningEffortCapability;
    pricing?: IModelPricing;
    pricingByTransport?: Partial<Record<EvalProviderTransport, IModelPricing>>;
}

const GPT_REASONING_EFFORTS = [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
] as const satisfies readonly ReasoningEffort[];

/*
 * Thinking levels for open-weight and non-OpenAI models, as OpenRouter's
 * `reasoning.effort` takes them (OpenRouter lists `reasoning` for each).
 * Where a maker documents only thinking on/off or a budget, the set is kept
 * to none/low/medium/high; OpenRouter turns the effort into on/off or a
 * budget. Checked 2026-11-07 against the makers' public docs.
 */
// Gemini 3 Flash: thinking_level minimal, low, medium or high; it can't be
// turned off, and high is Google's default
// (https://ai.google.dev/gemini-api/docs/thinking).
const GEMINI_3_FLASH_THINKING: IReasoningEffortCapability = {
    supportedLevels: ["minimal", "low", "medium", "high"],
    defaultLevel: "high",
};
// Gemma 4: thinking is a switch, off unless turned on.
const GEMMA_4_THINKING: IReasoningEffortCapability = {
    supportedLevels: ["none", "low", "medium", "high"],
    defaultLevel: "none",
};
// GLM 5.2: thinking on by default, can be turned off.
const GLM_5_THINKING: IReasoningEffortCapability = {
    supportedLevels: ["none", "low", "medium", "high"],
    defaultLevel: "medium",
};
// MiniMax M3: a thinking model; MiniMax documents no way to turn thinking
// off for its M series, so "none" is left out.
const MINIMAX_M3_THINKING: IReasoningEffortCapability = {
    supportedLevels: ["low", "medium", "high"],
    defaultLevel: "medium",
};

// Muse Ember: Meta says it reasons, but no thinking levels are documented
// for it, and Vercel AI Gateway documents no thinking option for Meta models
// (a requested level is not sent there, with a warning). Kept to
// low/medium/high, without "none", until Meta documents its levels.
const MUSE_EMBER_THINKING: IReasoningEffortCapability = {
    supportedLevels: ["low", "medium", "high"],
    defaultLevel: "medium",
};

const M = 1_000_000;

const OPENROUTER_MODEL_IDS: Readonly<Record<string, string>> = {
    "gpt-4o": "openai/gpt-4o",
    "gpt-4o-mini": "openai/gpt-4o-mini",
    "gpt-4.1": "openai/gpt-4.1",
    "gpt-4.1-mini": "openai/gpt-4.1-mini",
    "gpt-4.1-nano": "openai/gpt-4.1-nano",
    "anthropic/claude-sonnet-4.5": "anthropic/claude-sonnet-4.5",
    "anthropic/claude-sonnet-4": "anthropic/claude-sonnet-4",
    "anthropic/claude-haiku-4.5": "anthropic/claude-haiku-4.5",
    "google/gemini-2.5-pro": "google/gemini-2.5-pro",
    "google/gemini-2.5-flash": "google/gemini-2.5-flash",
    "google/gemini-2.5-flash-lite": "google/gemini-2.5-flash-lite",
    "google/gemma-4-26b-a4b-it": "google/gemma-4-26b-a4b-it",
    "google/gemma-4-31b-it": "google/gemma-4-31b-it",
    "google/gemma-3n-e4b-it": "google/gemma-3n-e4b-it",
    "google/gemma-3-4b-it": "google/gemma-3-4b-it",
    "google/gemma-3-12b-it": "google/gemma-3-12b-it",
    "google/gemma-3-27b-it": "google/gemma-3-27b-it",
    "google/gemma-2-27b-it": "google/gemma-2-27b-it",
    "meta/llama-4-maverick": "meta-llama/llama-4-maverick",
    "meta/llama-4-scout": "meta-llama/llama-4-scout",
    "mistral/magistral-medium": "mistralai/magistral-medium-2506",
};

interface IDirectMakerModel {
    transport: DirectMakerTransport;
    transportModelId: string;
    pricing: IModelPricing;
}

/**
 * Models that can be called on their maker's own API, keyed by registry id.
 * Only models whose direct id is confirmed in the maker's docs are listed.
 * Prices are the makers' list prices in USD per 1M tokens, checked 2026-11-06:
 * - Anthropic: https://platform.claude.com/docs/en/about-claude/pricing
 *   (input, output, cache hits, 5-minute cache writes).
 * - Google: https://ai.google.dev/gemini-api/docs/pricing (paid tier, text
 *   input). Gemma 4 has no paid-tier price there: it is free of charge, so
 *   direct Gemma calls record $0.
 */
const DIRECT_MAKER_MODELS: Readonly<Record<string, IDirectMakerModel>> = {
    "anthropic/claude-opus-5.5": {
        transport: "anthropic",
        transportModelId: "claude-opus-5-5",
        pricing: cachedPrice(4, 20, 0.2, 5),
    },
    "anthropic/claude-sonnet-5.5": {
        transport: "anthropic",
        transportModelId: "claude-sonnet-5-5",
        pricing: cachedPrice(2, 10, 0.1, 2.5),
    },
    "anthropic/claude-haiku-5.5": {
        transport: "anthropic",
        transportModelId: "claude-haiku-5-5",
        // Prompts over 100,000 tokens pay $0.50 input; only the input tier
        // is recorded, since cost tiers apply per token kind.
        pricing: {
            ...cachedPrice(0.1, 0.5, 0.01, 0.125),
            promptTiers: [
                { minTokens: 0, maxTokens: 100_001, pricePerToken: 0.1 / M },
                { minTokens: 100_001, pricePerToken: 0.5 / M },
            ],
        },
    },
    "anthropic/claude-sonnet-4.6": {
        transport: "anthropic",
        transportModelId: "claude-sonnet-4-6",
        pricing: cachedPrice(3, 15, 0.3, 3.75),
    },
    "google/gemini-3-flash": {
        transport: "google",
        transportModelId: "gemini-3-flash-preview",
        pricing: cachedPrice(0.5, 3, 0.05),
    },
    "google/gemini-3.5-flash-lite": {
        transport: "google",
        transportModelId: "gemini-3.5-flash-lite",
        pricing: cachedPrice(0.3, 2.5, 0.03),
    },
    "google/gemma-4-31b-it": {
        transport: "google",
        transportModelId: "gemma-4-31b-it",
        pricing: price(0, 0),
    },
};

/** Registry ids that can run on the given maker's own API. */
export function directMakerModelIds(transport: DirectMakerTransport): string[] {
    return Object.entries(DIRECT_MAKER_MODELS).flatMap(([id, model]) =>
        model.transport === transport ? [id] : [],
    );
}

function withDirectMakerTransport(
    entry: IModelRegistryEntry,
): IModelRegistryEntry {
    const direct = DIRECT_MAKER_MODELS[entry.id];
    if (!direct) return entry;
    return {
        ...entry,
        transports: {
            ...entry.transports,
            [direct.transport]: direct.transportModelId,
        },
        pricingByTransport: {
            ...entry.pricingByTransport,
            [direct.transport]: direct.pricing,
        },
    };
}

// Static token prices, in USD per 1M tokens, for the OpenAI entries below
// (`promptPerM` / `completionPerM`). These are published list prices as of
// 2026-07-08, the last time they were updated; source:
// https://openai.com/api/pricing/
// These stay the entry's default price; public catalog snapshots add
// per-transport prices (`pricingByTransport`) that win when a transport is known.
function price(promptPerM: number, completionPerM: number): IModelPricing {
    return {
        promptPricePerToken: promptPerM / M,
        completionPricePerToken: completionPerM / M,
    };
}

function cachedPrice(
    promptPerM: number,
    completionPerM: number,
    cacheReadPerM: number,
    cacheWritePerM?: number,
): IModelPricing {
    return {
        ...price(promptPerM, completionPerM),
        cacheReadPricePerToken: cacheReadPerM / M,
        ...(cacheWritePerM === undefined
            ? {}
            : { cacheWritePricePerToken: cacheWritePerM / M }),
    };
}

function openAiEntry(input: {
    id: string;
    label: string;
    family: string;
    reasoning?: boolean;
    vision: boolean;
    promptPerM: number;
    completionPerM: number;
}): IModelRegistryEntry {
    const gatewayModelId = `openai/${input.id}`;
    return {
        id: input.id,
        gatewayModelId,
        label: input.label,
        family: input.family,
        provider: "openai",
        providerLabel: "OpenAI",
        reasoning: Boolean(input.reasoning),
        vision: input.vision,
        structuredOutput: true,
        judgeSuitable: true,
        supportsOpenAI: true,
        supportsGateway: true,
        transports: {
            openai: input.id,
            gateway: gatewayModelId,
            bifrost: gatewayModelId,
            ...optionalOpenRouterTransport(input.id),
        },
        ...(input.reasoning
            ? {
                  reasoningEffort: {
                      supportedLevels: GPT_REASONING_EFFORTS,
                      defaultLevel: "medium",
                  },
              }
            : {}),
        pricing: price(input.promptPerM, input.completionPerM),
    };
}

function gatewayEntry(input: {
    id: string;
    label: string;
    family: string;
    provider: Exclude<ModelProvider, "openai">;
    providerLabel: string;
    vision: boolean;
    structuredOutput: boolean;
    judgeSuitable: boolean;
    reasoningEffort?: IReasoningEffortCapability;
    pricing?: IModelPricing;
}): IModelRegistryEntry {
    return {
        id: input.id,
        gatewayModelId: input.id,
        label: input.label,
        family: input.family,
        provider: input.provider,
        providerLabel: input.providerLabel,
        reasoning: input.reasoningEffort !== undefined,
        ...(input.reasoningEffort
            ? { reasoningEffort: input.reasoningEffort }
            : {}),
        vision: input.vision,
        structuredOutput: input.structuredOutput,
        judgeSuitable: input.judgeSuitable,
        supportsOpenAI: false,
        supportsGateway: true,
        transports: {
            gateway: input.id,
            bifrost: input.id,
            ...optionalOpenRouterTransport(input.id),
        },
        ...(input.pricing ? { pricing: input.pricing } : {}),
    };
}

const STATIC_MODEL_REGISTRY: readonly IModelRegistryEntry[] = [
    {
        id: "google/gemini-3.8-flash",
        gatewayModelId: "google/gemini-3.8-flash",
        label: "Gemini 3.8 Flash",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        reasoning: true,
        reasoningEffort: {
            supportedLevels: ["low", "medium", "high"],
            defaultLevel: "low",
        },
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
        supportsOpenAI: false,
        supportsGateway: false,
        transports: { openrouter: "google/gemini-3.8-flash" },
        // OpenRouter list prices verified 2026-09-27:
        // https://openrouter.ai/google/gemini-3.8-flash
        pricing: price(0.75, 3.75),
    },
    openAiEntry({
        id: "gpt-4o",
        label: "GPT-4o",
        family: "gpt-4o",
        vision: true,
        promptPerM: 2.5,
        completionPerM: 10,
    }),
    openAiEntry({
        id: "gpt-4o-mini",
        label: "GPT-4o mini",
        family: "gpt-4o",
        vision: true,
        promptPerM: 0.15,
        completionPerM: 0.6,
    }),
    openAiEntry({
        id: "gpt-4.1",
        label: "GPT-4.1",
        family: "gpt-4.1",
        vision: true,
        promptPerM: 2,
        completionPerM: 8,
    }),
    openAiEntry({
        id: "gpt-4.1-mini",
        label: "GPT-4.1 mini",
        family: "gpt-4.1",
        vision: true,
        promptPerM: 0.4,
        completionPerM: 1.6,
    }),
    openAiEntry({
        id: "gpt-4.1-nano",
        label: "GPT-4.1 nano",
        family: "gpt-4.1",
        vision: true,
        promptPerM: 0.1,
        completionPerM: 0.4,
    }),
    openAiEntry({
        id: "gpt-5.5",
        label: "GPT-5.5",
        family: "gpt-5",
        reasoning: true,
        vision: true,
        promptPerM: 5,
        completionPerM: 30,
    }),
    openAiEntry({
        id: "gpt-5.4",
        label: "GPT-5.4",
        family: "gpt-5",
        reasoning: true,
        vision: true,
        promptPerM: 2.5,
        completionPerM: 15,
    }),
    openAiEntry({
        id: "gpt-5.4-mini",
        label: "GPT-5.4 mini",
        family: "gpt-5",
        reasoning: true,
        vision: true,
        promptPerM: 0.75,
        completionPerM: 4.5,
    }),
    openAiEntry({
        id: "gpt-5.4-nano",
        label: "GPT-5.4 nano",
        family: "gpt-5",
        reasoning: true,
        vision: true,
        promptPerM: 0.2,
        completionPerM: 1.25,
    }),
    // OpenAI list price, checked 2026-11-06:
    // https://developers.openai.com/api/docs/models/gpt-6-luna
    openAiEntry({
        id: "gpt-6-luna",
        label: "GPT-6 Luna",
        family: "gpt-6",
        reasoning: true,
        vision: true,
        promptPerM: 0.1,
        completionPerM: 0.5,
    }),
    gatewayEntry({
        id: "anthropic/claude-opus-4.8",
        label: "Claude Opus 4.8",
        family: "claude-opus",
        provider: "anthropic",
        providerLabel: "Claude",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "anthropic/claude-opus-4.7",
        label: "Claude Opus 4.7",
        family: "claude-opus",
        provider: "anthropic",
        providerLabel: "Claude",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "anthropic/claude-opus-4.6",
        label: "Claude Opus 4.6",
        family: "claude-opus",
        provider: "anthropic",
        providerLabel: "Claude",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "anthropic/claude-sonnet-4.5",
        label: "Claude Sonnet 4.5",
        family: "claude-sonnet",
        provider: "anthropic",
        providerLabel: "Claude",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "anthropic/claude-sonnet-4",
        label: "Claude Sonnet 4",
        family: "claude-sonnet",
        provider: "anthropic",
        providerLabel: "Claude",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "anthropic/claude-haiku-4.5",
        label: "Claude Haiku 4.5",
        family: "claude-haiku",
        provider: "anthropic",
        providerLabel: "Claude",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemini-3-pro-preview",
        label: "Gemini 3 Pro Preview",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemini-3-flash",
        label: "Gemini 3 Flash",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
        reasoningEffort: GEMINI_3_FLASH_THINKING,
    }),
    gatewayEntry({
        id: "google/gemini-3.1-flash-lite",
        label: "Gemini 3.1 Flash Lite",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemini-2.5-pro",
        label: "Gemini 2.5 Pro",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemini-2.5-flash",
        label: "Gemini 2.5 Flash",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemini-2.5-flash-lite",
        label: "Gemini 2.5 Flash Lite",
        family: "gemini",
        provider: "google",
        providerLabel: "Gemini",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemma-4-26b-a4b-it",
        label: "Gemma 4 26B A4B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemma-4-31b-it",
        label: "Gemma 4 31B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
        reasoningEffort: GEMMA_4_THINKING,
    }),
    gatewayEntry({
        id: "google/gemma-3n-e4b-it",
        label: "Gemma 3n E4B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemma-3-4b-it",
        label: "Gemma 3 4B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemma-3-12b-it",
        label: "Gemma 3 12B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemma-3-27b-it",
        label: "Gemma 3 27B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "google/gemma-2-27b-it",
        label: "Gemma 2 27B IT",
        family: "gemma",
        provider: "google",
        providerLabel: "Gemma",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "xai/grok-4.3",
        label: "Grok 4.3",
        family: "grok",
        provider: "xai",
        providerLabel: "Grok",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "xai/grok-4.1-fast-reasoning",
        label: "Grok 4.1 Fast Reasoning",
        family: "grok",
        provider: "xai",
        providerLabel: "Grok",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "xai/grok-4.1-fast-non-reasoning",
        label: "Grok 4.1 Fast Non-Reasoning",
        family: "grok",
        provider: "xai",
        providerLabel: "Grok",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "meta/llama-4-maverick",
        label: "Llama 4 Maverick",
        family: "llama",
        provider: "meta",
        providerLabel: "Llama",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "meta/llama-4-scout",
        label: "Llama 4 Scout",
        family: "llama",
        provider: "meta",
        providerLabel: "Llama",
        vision: true,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    // Served by Meta itself on Vercel AI Gateway (host "meta", which a run's
    // allowed-host rule can name). Context window 1,048,576 tokens; takes
    // response_format (structured output), reasoning and temperature.
    // Unverified: price from launch coverage, not a Meta or Vercel price
    // page ($0.10 input, $0.50 output, $0.004 cached input per 1M tokens).
    gatewayEntry({
        id: "meta/muse-ember",
        label: "Muse Ember",
        family: "muse",
        provider: "meta",
        providerLabel: "Meta",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
        reasoningEffort: MUSE_EMBER_THINKING,
        pricing: cachedPrice(0.1, 0.5, 0.004),
    }),
    gatewayEntry({
        id: "mistral/mistral-large-3",
        label: "Mistral Large 3",
        family: "mistral",
        provider: "mistral",
        providerLabel: "Mistral",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "mistral/mistral-medium-3.5",
        label: "Mistral Medium 3.5",
        family: "mistral",
        provider: "mistral",
        providerLabel: "Mistral",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "mistral/magistral-medium",
        label: "Magistral Medium",
        family: "magistral",
        provider: "mistral",
        providerLabel: "Mistral",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    {
        id: "openrouter/z-ai/glm-5.2",
        gatewayModelId: "openrouter/z-ai/glm-5.2",
        label: "GLM 5.2",
        family: "glm",
        provider: "zai",
        providerLabel: "Z.ai",
        reasoning: true,
        reasoningEffort: GLM_5_THINKING,
        vision: false,
        // OpenRouter lists structured_outputs and response_format for it.
        structuredOutput: true,
        judgeSuitable: true,
        supportsOpenAI: false,
        supportsGateway: false,
        transports: { bifrost: "openrouter/z-ai/glm-5.2" },
    },
    {
        id: "openrouter/minimax/minimax-m3",
        gatewayModelId: "openrouter/minimax/minimax-m3",
        label: "MiniMax M3",
        family: "minimax",
        provider: "minimax",
        providerLabel: "MiniMax",
        reasoning: true,
        reasoningEffort: MINIMAX_M3_THINKING,
        vision: false,
        // OpenRouter lists structured_outputs and response_format for it.
        structuredOutput: true,
        judgeSuitable: true,
        supportsOpenAI: false,
        supportsGateway: false,
        transports: { bifrost: "openrouter/minimax/minimax-m3" },
    },
    // Structured output stays off on Vercel AI Gateway: only OpenRouter's
    // listing says these two take it. Vercel documents no thinking option
    // for Z.ai or MiniMax, so a level is not sent there (with a warning).
    gatewayEntry({
        id: "zai/glm-5.2",
        label: "GLM 5.2",
        family: "glm",
        provider: "zai",
        providerLabel: "Z.ai",
        vision: false,
        structuredOutput: false,
        judgeSuitable: false,
        reasoningEffort: GLM_5_THINKING,
    }),
    gatewayEntry({
        id: "minimax/minimax-m3",
        label: "MiniMax M3",
        family: "minimax",
        provider: "minimax",
        providerLabel: "MiniMax",
        vision: false,
        structuredOutput: false,
        judgeSuitable: false,
        reasoningEffort: MINIMAX_M3_THINKING,
    }),
    gatewayEntry({
        id: "alibaba/qwen3-max",
        label: "Qwen3 Max",
        family: "qwen",
        provider: "alibaba",
        providerLabel: "Qwen",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
    gatewayEntry({
        id: "alibaba/qwen3-coder-plus",
        label: "Qwen3 Coder Plus",
        family: "qwen",
        provider: "alibaba",
        providerLabel: "Qwen",
        vision: false,
        structuredOutput: true,
        judgeSuitable: true,
    }),
];

const catalogSnapshots = new Map(
    bundledCatalogs.flatMap((value) => {
        const snapshot = readCatalogSnapshot(value);
        return snapshot ? [[snapshot.source, snapshot] as const] : [];
    }),
);
export let MODEL_REGISTRY: IModelRegistryEntry[] = [];
let BY_ID_LENGTH_DESC: IModelRegistryEntry[] = [];
// Exact id, gateway id and transport id lookups; the merged catalog is large.
let BY_ALIAS = new Map<string, IModelRegistryEntry>();
rebuildRegistry();

function rebuildRegistry(): void {
    MODEL_REGISTRY = mergeModelCatalogs(
        STATIC_MODEL_REGISTRY,
        orderCatalogSnapshots(catalogSnapshots.values()),
    ).map(withDirectMakerTransport);
    BY_ID_LENGTH_DESC = [...MODEL_REGISTRY].sort(
        (a, b) => b.id.length - a.id.length,
    );
    const byAlias = new Map<string, IModelRegistryEntry>();
    for (const entry of BY_ID_LENGTH_DESC) {
        for (const alias of [
            entry.id,
            entry.gatewayModelId,
            ...Object.values(entry.transports),
        ]) {
            if (alias && !byAlias.has(alias)) byAlias.set(alias, entry);
        }
    }
    BY_ALIAS = byAlias;
}

/**
 * Install public metadata only; account-specific availability stays in provider
 * discovery. Snapshots no newer than the installed one are skipped, and the
 * registry is rebuilt at most once per call.
 */
export function installModelCatalogs(
    snapshots: readonly IModelCatalogSnapshot[],
): void {
    let changed = false;
    for (const snapshot of snapshots) {
        const current = catalogSnapshots.get(snapshot.source);
        if (
            current &&
            Date.parse(current.fetchedAt) >= Date.parse(snapshot.fetchedAt)
        )
            continue;
        catalogSnapshots.set(snapshot.source, snapshot);
        changed = true;
    }
    if (changed) rebuildRegistry();
}

export function installModelCatalog(snapshot: IModelCatalogSnapshot): void {
    installModelCatalogs([snapshot]);
}

export function registryEntryFor(
    modelId: string,
): IModelRegistryEntry | undefined {
    return (
        BY_ALIAS.get(modelId) ??
        BY_ID_LENGTH_DESC.find((entry) => {
            if (entry.provider !== "openai" && entry.id.includes("/")) {
                return false;
            }
            return modelId.startsWith(`${entry.id}-`);
        })
    );
}

export function gatewayModelIdFor(modelId: string): string | undefined {
    if (modelId.includes("/")) return modelId;
    return registryEntryFor(modelId)?.gatewayModelId;
}

export function transportsForModel(
    modelId: string,
): ModelTransports | undefined {
    return registryEntryFor(modelId)?.transports;
}

/**
 * The id `transport` calls a model by, when the registry knows it. The same
 * model can have a different id per provider (Vercel "zai/glm-5.2",
 * OpenRouter "z-ai/glm-5.2"); any of its ids finds the entry.
 */
export function transportModelIdFor(
    modelId: string,
    transport: EvalProviderTransport,
): string | undefined {
    return registryEntryFor(modelId)?.transports[transport];
}

export function transportCapabilityForModel(
    modelId: string,
    transport: EvalProviderTransport,
): IModelTransportCapability | undefined {
    const entry = registryEntryFor(modelId);
    const transportModelId = entry?.transports[transport];
    if (!entry || !transportModelId) return undefined;

    const supportedGenerationControls: ModelGenerationControl[] = [
        "maxOutputTokens",
        ...(entry.reasoningEffort ? (["reasoningEffort"] as const) : []),
        // OpenAI and Claude thinking models refuse or limit sampling
        // settings; other thinking models (Gemini, Gemma, GLM, MiniMax)
        // take them.
        ...((entry.reasoning &&
            (entry.provider === "openai" || entry.provider === "anthropic")) ||
        claudeRejectsSampling(entry.id)
            ? []
            : (["temperature", "topP", "seed"] as const)),
    ];
    const upstreamRoutingModes: readonly UpstreamRoutingMode[] =
        transport === "openrouter"
            ? ["auto", "preference", "exact"]
            : transport === "gateway" || transport === "bifrost"
              ? ["auto"]
              : ["none"];

    return {
        transport,
        transportModelId,
        upstreamRoutingModes,
        supportedGenerationControls,
        supportsStructuredOutput: entry.structuredOutput,
        requiresCurrentDiscovery:
            transport === "gateway" ||
            transport === "openrouter" ||
            transport === "bifrost",
    };
}

export function registryEntriesForProvider(
    provider: "openai" | "gateway",
    liveModels: readonly { id: string; pricing?: IModelPricing }[] = [],
): IModelRegistryEntry[] {
    const entries = MODEL_REGISTRY.filter((entry) =>
        provider === "gateway" ? entry.supportsGateway : entry.supportsOpenAI,
    );
    const knownIds = new Set(
        entries.map((entry) =>
            provider === "gateway" ? entry.gatewayModelId : entry.id,
        ),
    );
    for (const model of liveModels) {
        if (knownIds.has(model.id)) continue;
        const entry = registryEntryForLiveModel(
            model.id,
            provider,
            model.pricing,
        );
        if (!entry) continue;
        entries.push(entry);
        knownIds.add(model.id);
    }
    return entries;
}

export function registryEntryForLiveGatewayModel(
    gatewayModelId: string,
    pricing?: IModelPricing,
): IModelRegistryEntry | undefined {
    const existing = registryEntryFor(gatewayModelId);
    if (existing) {
        return existing.pricing || !pricing
            ? existing
            : { ...existing, pricing };
    }

    return registryEntryForLiveModel(gatewayModelId, "gateway", pricing);
}

function registryEntryForLiveModel(
    modelId: string,
    transport: "openai" | "gateway",
    pricing?: IModelPricing,
): IModelRegistryEntry | undefined {
    const existing = registryEntryFor(modelId);
    if (existing) {
        return existing.pricing || !pricing
            ? existing
            : { ...existing, pricing };
    }

    const [providerId, modelName] = modelId.includes("/")
        ? modelId.split("/", 2)
        : ["openai", modelId];
    if (!modelName) return undefined;
    const provider = providerForGatewayId(providerId) ?? providerId;

    const id = provider === "openai" ? modelName : modelId;
    const capabilities = providerCapabilitiesFor(provider);
    return {
        id,
        gatewayModelId: transport === "gateway" ? modelId : `openai/${modelId}`,
        label: labelForModelName(modelName),
        family: familyForModelName(modelName),
        provider,
        providerLabel: providerLabelFor(provider),
        reasoning: false,
        vision: false,
        structuredOutput: capabilities.structuredOutput,
        judgeSuitable: capabilities.judgeSuitable,
        supportsOpenAI: transport === "openai",
        supportsGateway: transport === "gateway",
        transports: { [transport]: modelId },
        ...(pricing ? { pricing } : {}),
    };
}

function optionalOpenRouterTransport(modelId: string): { openrouter?: string } {
    const openrouter = OPENROUTER_MODEL_IDS[modelId];
    return openrouter ? { openrouter } : {};
}

function providerCapabilitiesFor(
    provider: ModelProvider,
): Pick<IModelRegistryEntry, "structuredOutput" | "judgeSuitable"> {
    if (
        provider === "openai" ||
        provider === "anthropic" ||
        provider === "google" ||
        provider === "xai" ||
        provider === "meta" ||
        provider === "mistral" ||
        provider === "alibaba"
    ) {
        return { structuredOutput: true, judgeSuitable: true };
    }

    return { structuredOutput: false, judgeSuitable: false };
}

function providerForGatewayId(
    providerId: string | undefined,
): KnownModelProvider | undefined {
    if (!providerId) return undefined;
    if (
        providerId === "openai" ||
        providerId === "anthropic" ||
        providerId === "google" ||
        providerId === "xai" ||
        providerId === "meta" ||
        providerId === "mistral" ||
        providerId === "alibaba"
    ) {
        return providerId;
    }
    return undefined;
}

function providerLabelFor(provider: ModelProvider): string {
    if (provider === "openai") return "OpenAI";
    if (provider === "anthropic") return "Claude";
    if (provider === "google") return "Gemini";
    if (provider === "xai") return "Grok";
    if (provider === "meta") return "Llama";
    if (provider === "alibaba") return "Qwen";
    return provider[0]!.toUpperCase() + provider.slice(1);
}

function labelForModelName(modelName: string): string {
    return modelName
        .split(/[-_]/)
        .filter(Boolean)
        .map((part) => part[0]!.toUpperCase() + part.slice(1))
        .join(" ");
}

function familyForModelName(modelName: string): string {
    return modelName.split(/[-_]/).slice(0, 2).join("-") || modelName;
}
