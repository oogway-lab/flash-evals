import type { ReasoningEffort } from "../types.js";

export type KnownModelProvider =
    "openai" | "anthropic" | "google" | "xai" | "meta" | "mistral" | "alibaba";
/** Live provider catalog identifiers are intentionally open-ended. */
export type ModelProvider = KnownModelProvider | (string & {});

export type EvalProviderTransport =
    "openai" | "gateway" | "openrouter" | "bifrost";
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

export interface IModelPricing {
    promptPricePerToken: number;
    completionPricePerToken: number;
    promptTiers?: readonly IModelPricingTier[];
    completionTiers?: readonly IModelPricingTier[];
}

export interface IModelPricingTier {
    minTokens: number;
    maxTokens?: number;
    pricePerToken: number;
}

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
}

const GPT_REASONING_EFFORTS = [
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
] as const satisfies readonly ReasoningEffort[];

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

// Static token prices, in USD per 1M tokens, for the OpenAI entries below
// (`promptPerM` / `completionPerM`). These are published list prices as of
// 2026-07-08, the last time they were updated; source:
// https://openai.com/api/pricing/
// Non-OpenAI entries carry no static price; when Vercel AI Gateway exposes
// token pricing, it arrives through live model metadata instead.
function price(promptPerM: number, completionPerM: number): IModelPricing {
    return {
        promptPricePerToken: promptPerM / M,
        completionPricePerToken: completionPerM / M,
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
}): IModelRegistryEntry {
    return {
        id: input.id,
        gatewayModelId: input.id,
        label: input.label,
        family: input.family,
        provider: input.provider,
        providerLabel: input.providerLabel,
        reasoning: false,
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
    };
}

export const MODEL_REGISTRY: readonly IModelRegistryEntry[] = [
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
        reasoning: false,
        vision: false,
        structuredOutput: false,
        judgeSuitable: false,
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
        reasoning: false,
        vision: false,
        structuredOutput: false,
        judgeSuitable: false,
        supportsOpenAI: false,
        supportsGateway: false,
        transports: { bifrost: "openrouter/minimax/minimax-m3" },
    },
    gatewayEntry({
        id: "zai/glm-5.2",
        label: "GLM 5.2",
        family: "glm",
        provider: "zai",
        providerLabel: "Z.ai",
        vision: false,
        structuredOutput: false,
        judgeSuitable: false,
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

const BY_ID_LENGTH_DESC = [...MODEL_REGISTRY].sort(
    (a, b) => b.id.length - a.id.length,
);

export function registryEntryFor(
    modelId: string,
): IModelRegistryEntry | undefined {
    return BY_ID_LENGTH_DESC.find((entry) => {
        if (modelId === entry.id || modelId === entry.gatewayModelId)
            return true;
        if (entry.provider !== "openai" && entry.id.includes("/")) {
            return false;
        }
        return modelId.startsWith(`${entry.id}-`);
    });
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

export function transportCapabilityForModel(
    modelId: string,
    transport: EvalProviderTransport,
): IModelTransportCapability | undefined {
    const entry = registryEntryFor(modelId);
    const transportModelId = entry?.transports[transport];
    if (!entry || !transportModelId) return undefined;

    const supportedGenerationControls: ModelGenerationControl[] = [
        "maxOutputTokens",
        ...(entry.reasoning
            ? (["reasoningEffort"] as const)
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
