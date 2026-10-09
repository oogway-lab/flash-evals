import {
    transportsForModel,
    type EvalProviderTransport,
} from "../models/registry.js";
import type {
    ApiKeys,
    CompletionRequest,
    IEvalCompletionProvider,
} from "../types.js";
import {
    GatewayEvalProvider,
    type IGatewayEvalProviderDeps,
} from "./gateway.js";
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
    gatewayFallbackModels?: string[];
    exactTransportModelId?: string;
}

const PROVIDER_ENV_KEY = "MOSAIC_LLM_PROVIDER";
const GATEWAY_FALLBACK_MODELS_ENV_KEY = "MOSAIC_GATEWAY_FALLBACK_MODELS";

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
            throw new Error("Please add your OpenRouter API key to run evals.");
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
            throw new Error("Please add your Bifrost API key to run evals.");
        }
        if (!apiKeys.bifrostBaseUrl) {
            throw new Error(
                "Please add BIFROST_BASE_URL to run Bifrost evals.",
            );
        }
        return routeForExplicitTransport(
            openAICompatibleProvider(
                apiKeys.bifrost,
                {
                    baseURL: apiKeys.bifrostBaseUrl,
                    providerLabel: "Bifrost",
                    transport: "bifrost",
                },
                options,
            ),
            options.transport,
            options.exactTransportModelId,
        );
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

function autoProvider(
    apiKeys: ApiKeys,
    options: IEvalProviderOptions,
): IEvalCompletionProvider {
    return {
        complete(req: CompletionRequest) {
            const transport = transportForAutoRequest(req.model, apiKeys);
            return getEvalProvider(apiKeys, { ...options, transport }).complete(
                req,
            );
        },
    };
}

function transportForAutoRequest(
    modelId: string,
    apiKeys: ApiKeys,
): EvalProviderTransport {
    // Provider-qualified model ids cannot be submitted to OpenAI directly.
    if (modelId.includes("/")) {
        if (apiKeys.gateway) return "gateway";
        if (apiKeys.openrouter) return "openrouter";
        if (apiKeys.bifrost && apiKeys.bifrostBaseUrl) return "bifrost";
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
                transportsForModel(req.model)?.[transport];
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

    if (isEvalProviderMode(mode)) {
        return mode;
    }
    throw new Error(
        `Invalid ${PROVIDER_ENV_KEY} value "${env}". Expected one of: auto, vercel-ai, openai, gateway, openrouter, bifrost.`,
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
