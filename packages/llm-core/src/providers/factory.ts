import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import {
    isDirectMakerTransport,
    transportsForModel,
    type DirectMakerTransport,
    type EvalProviderTransport,
} from "../models/registry.js";
import {
    hasDataPolicy,
    type ApiKeys,
    type CompletionRequest,
    type IEvalCompletionProvider,
} from "../types.js";
import {
    GatewayEvalProvider,
    type IGatewayEvalProviderDeps,
} from "./gateway.js";
import { bifrostApiBaseUrl, bifrostModelIdFor } from "./bifrost.js";
import { ANTHROPIC_API_BASE_URL } from "./endpoints.js";
import { OpenAIEvalProvider } from "./openai.js";
import { VercelAIEvalProvider } from "./vercelAi.js";

export type EvalProviderMode =
    "auto" | "vercel-ai" | "openai" | "gateway" | "openrouter" | "bifrost";

export interface IEvalProviderOptions {
    provider?: EvalProviderMode;
    transport?: EvalProviderTransport;
    createOpenAIProvider?: (apiKey: string) => IEvalCompletionProvider;
    createOpenAICompatibleProvider?: (
        apiKey: string,
        options: {
            baseURL?: string;
            providerLabel: string;
            transport?: "openrouter" | "bifrost";
        },
    ) => IEvalCompletionProvider;
    createGatewayProvider?: (
        apiKey: string,
        deps: IGatewayEvalProviderDeps,
    ) => IEvalCompletionProvider;
    createVercelAIProvider?: (apiKey: string) => IEvalCompletionProvider;
    /** Builds the provider for a direct Anthropic or Google call. */
    createDirectMakerProvider?: (
        transport: DirectMakerTransport,
        apiKey: string,
    ) => IEvalCompletionProvider;
    gatewayFallbackModels?: string[];
    exactTransportModelId?: string;
}

const PROVIDER_ENV_KEY = "FLASH_EVALS_LLM_PROVIDER";
const GATEWAY_FALLBACK_MODELS_ENV_KEY = "FLASH_EVALS_GATEWAY_FALLBACK_MODELS";

export function getEvalProvider(
    apiKeys: ApiKeys,
    options: IEvalProviderOptions = {},
): IEvalCompletionProvider {
    const mode =
        options.transport ??
        options.provider ??
        providerModeFromEnv() ??
        "auto";
    if (mode === "gateway") {
        if (!apiKeys.gateway) {
            throw new Error("Please add your AI Gateway API key to run evals.");
        }
        const fallbackModels =
            options.gatewayFallbackModels ?? gatewayFallbackModelsFromEnv();
        if (fallbackModels.length > 0) {
            throw new Error(
                "Gateway fallback models are not supported for eval runs until Flash Evals records the actual served model.",
            );
        }
        const createGatewayProvider =
            options.createGatewayProvider ??
            ((apiKey, deps) => new GatewayEvalProvider(apiKey, deps));
        return routeForExplicitTransport(
            createGatewayProvider(apiKeys.gateway, { fallbackModels }),
            options.transport,
            options.exactTransportModelId,
        );
    }

    if (mode === "openrouter") {
        if (!apiKeys.openrouter) {
            throw new Error(
                apiKeys.unusable?.openrouter ??
                    "Please add your OpenRouter API key to run evals.",
            );
        }
        return routeForExplicitTransport(
            openAICompatibleProvider(
                apiKeys.openrouter,
                {
                    baseURL:
                        apiKeys.openrouterBaseUrl ??
                        "https://openrouter.ai/api/v1",
                    providerLabel: "OpenRouter",
                    transport: "openrouter",
                },
                options,
            ),
            options.transport,
            options.exactTransportModelId,
        );
    }

    if (mode === "bifrost") {
        if (!apiKeys.bifrost) {
            throw new Error(
                apiKeys.unusable?.bifrost ??
                    "Please add your Bifrost API key to run evals.",
            );
        }
        if (!apiKeys.bifrostBaseUrl) {
            throw new Error(
                "Please add BIFROST_BASE_URL to run Bifrost evals.",
            );
        }
        // Every Bifrost call, chosen per call or as the default provider,
        // sends the model's Bifrost id (see bifrostModelIdFor).
        return routeForExplicitTransport(
            openAICompatibleProvider(
                apiKeys.bifrost,
                {
                    baseURL: bifrostApiBaseUrl(apiKeys.bifrostBaseUrl),
                    providerLabel: "Bifrost",
                    transport: "bifrost",
                },
                options,
            ),
            "bifrost",
            options.exactTransportModelId,
        );
    }

    if (isDirectMakerTransport(mode)) {
        return directMakerTransportProvider(mode, apiKeys, options);
    }

    if (mode === "auto") {
        return autoProvider(apiKeys, options);
    }
    if (!apiKeys.openai) {
        throw new Error("Please add your OpenAI API key to run evals.");
    }

    const createOpenAI =
        options.createOpenAIProvider ??
        ((apiKey) => new OpenAIEvalProvider(apiKey));
    const createVercelAI =
        options.createVercelAIProvider ??
        ((apiKey) => new VercelAIEvalProvider(apiKey));

    if (mode === "openai") {
        return routeForExplicitTransport(
            createOpenAI(apiKeys.openai),
            options.transport,
            options.exactTransportModelId,
        );
    }
    if (mode === "vercel-ai") return createVercelAI(apiKeys.openai);

    try {
        return createVercelAI(apiKeys.openai);
    } catch {
        return createOpenAI(apiKeys.openai);
    }
}

const DIRECT_MAKER_KEY_NAMES: Record<DirectMakerTransport, string> = {
    anthropic: "Anthropic",
    google: "Gemini",
};

function directMakerTransportProvider(
    transport: DirectMakerTransport,
    apiKeys: ApiKeys,
    options: IEvalProviderOptions,
): IEvalCompletionProvider {
    const apiKey = apiKeys[transport];
    if (!apiKey) {
        throw new Error(
            `Please add your ${DIRECT_MAKER_KEY_NAMES[transport]} API key in Settings to run evals.`,
        );
    }
    const createProvider =
        options.createDirectMakerProvider ?? directMakerProvider;
    return routeForExplicitTransport(
        createProvider(transport, apiKey),
        transport,
        options.exactTransportModelId,
    );
}

function directMakerProvider(
    transport: DirectMakerTransport,
    apiKey: string,
): IEvalCompletionProvider {
    return new VercelAIEvalProvider(apiKey, {
        directMaker: transport,
        providerLabel: transport === "anthropic" ? "Anthropic" : "Gemini API",
        modelFor:
            transport === "anthropic"
                ? createAnthropic({ apiKey, baseURL: ANTHROPIC_API_BASE_URL })
                : createGoogleGenerativeAI({ apiKey }),
    });
}

function autoProvider(
    apiKeys: ApiKeys,
    options: IEvalProviderOptions,
): IEvalCompletionProvider {
    return {
        complete(req: CompletionRequest) {
            const transport = transportForAutoRequest(
                req.model,
                apiKeys,
                req.dataPolicy,
            );
            return getEvalProvider(apiKeys, { ...options, transport }).complete(
                req,
            );
        },
    };
}

/**
 * The transport a call through `getEvalProvider(apiKeys, options)` for
 * `modelId` goes over, so callers can limit calls per provider. "auto" picks
 * as the auto provider would; "vercel-ai" is the OpenAI key. Undefined when
 * no transport can be chosen (the call itself then fails).
 */
export function evalTransportFor(
    modelId: string,
    apiKeys: ApiKeys,
    options: Pick<IEvalProviderOptions, "provider" | "transport"> = {},
    dataPolicy?: CompletionRequest["dataPolicy"],
): EvalProviderTransport | undefined {
    const mode =
        options.transport ??
        options.provider ??
        providerModeFromEnv() ??
        "auto";
    if (mode === "vercel-ai") return "openai";
    if (mode !== "auto") return mode;
    try {
        return transportForAutoRequest(modelId, apiKeys, dataPolicy);
    } catch {
        return undefined;
    }
}

function transportForAutoRequest(
    modelId: string,
    apiKeys: ApiKeys,
    dataPolicy?: CompletionRequest["dataPolicy"],
): EvalProviderTransport {
    // Data rules (hosts, retention, training) can be passed on only through
    // Vercel AI Gateway or OpenRouter; OpenAI and the makers' own APIs refuse
    // such a call, so prefer a route that can follow them.
    if (hasDataPolicy(dataPolicy)) {
        const routed = modelId.includes("/");
        const transports = transportsForModel(modelId);
        for (const transport of ["gateway", "openrouter"] as const)
            if (apiKeys[transport] && (routed || transports?.[transport]))
                return transport;
    }
    // Provider-qualified model ids cannot be submitted to OpenAI directly.
    if (modelId.includes("/")) {
        if (apiKeys.gateway) return "gateway";
        if (apiKeys.openrouter) return "openrouter";
        if (apiKeys.bifrost && apiKeys.bifrostBaseUrl) return "bifrost";
    }
    // Only a maker's key is saved: call the maker when it serves the model.
    const transports = transportsForModel(modelId);
    for (const maker of ["anthropic", "google"] as const) {
        if (apiKeys[maker] && transports?.[maker]) return maker;
    }
    if (apiKeys.openai) return "openai";
    if (apiKeys.gateway) return "gateway";
    if (apiKeys.openrouter) return "openrouter";
    if (apiKeys.bifrost && apiKeys.bifrostBaseUrl) return "bifrost";
    throw new Error("Please add an API key to run evals.");
}

function routeForExplicitTransport(
    provider: IEvalCompletionProvider,
    transport: EvalProviderTransport | undefined,
    exactTransportModelId?: string,
): IEvalCompletionProvider {
    if (!transport) return provider;
    return {
        async complete(req: CompletionRequest) {
            const modelId =
                exactTransportModelId ??
                (transport === "bifrost"
                    ? bifrostModelIdFor(req.model)
                    : transportsForModel(req.model)?.[transport]);
            if (!modelId) {
                throw new Error(
                    `Model "${req.model}" does not support the "${transport}" transport.`,
                );
            }
            return provider.complete({ ...req, model: modelId });
        },
    };
}

function openAICompatibleProvider(
    apiKey: string,
    providerOptions: {
        baseURL?: string;
        providerLabel: string;
        transport?: "openrouter" | "bifrost";
    },
    options: IEvalProviderOptions,
): IEvalCompletionProvider {
    const createProvider =
        options.createOpenAICompatibleProvider ??
        ((key, openAIOptions) => new OpenAIEvalProvider(key, openAIOptions));
    return createProvider(apiKey, providerOptions);
}

export function providerModeFromEnv(): EvalProviderMode | undefined {
    const env = (
        globalThis as {
            process?: { env?: Record<string, string | undefined> };
        }
    ).process?.env?.[PROVIDER_ENV_KEY];
    const mode = env?.trim();

    if (!mode) return undefined;
    // The documented name; "gateway" stays accepted as the old spelling.
    if (mode === "vercel-ai-gateway") return "gateway";

    if (isEvalProviderMode(mode)) {
        return mode;
    }
    throw new Error(
        `Invalid ${PROVIDER_ENV_KEY} value "${env}". Expected one of: auto, vercel-ai-gateway, openrouter, openai, bifrost (legacy: gateway, vercel-ai).`,
    );
}

function gatewayFallbackModelsFromEnv(): string[] {
    const env = (
        globalThis as {
            process?: { env?: Record<string, string | undefined> };
        }
    ).process?.env?.[GATEWAY_FALLBACK_MODELS_ENV_KEY];
    return (env ?? "")
        .split(",")
        .map((model) => model.trim())
        .filter(Boolean);
}

function isEvalProviderMode(mode: string): mode is EvalProviderMode {
    return (
        mode === "auto" ||
        mode === "vercel-ai" ||
        mode === "openai" ||
        mode === "gateway" ||
        mode === "openrouter" ||
        mode === "bifrost"
    );
}
