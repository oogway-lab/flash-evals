import { createGateway, type GatewayProvider } from "@ai-sdk/gateway";
import OpenAI from "openai";
import type { ApiKeys } from "../types.js";
import { providerModeFromEnv, type EvalProviderMode } from "./factory.js";
import type { IModelPricing, IModelPricingTier } from "../models/registry.js";

const MODEL_LIST_TIMEOUT_MS = 15_000;

export interface IListAvailableModelsOptions {
    createGatewayProvider?: (apiKey: string) => Pick<
        GatewayProvider,
        "getAvailableModels"
    >;
    provider?: EvalProviderMode;
}

export interface IAvailableModelMetadata {
    id: string;
    pricing?: IModelPricing;
}

interface IGatewayModelMetadata {
    id: string;
    modelType?: string;
    type?: string;
    pricing?: unknown;
}

export async function listAvailableModels(
    apiKeys: ApiKeys,
    options: IListAvailableModelsOptions = {},
): Promise<string[]> {
    return (await listAvailableModelMetadata(apiKeys, options)).map(
        (model) => model.id,
    );
}

export async function listAvailableModelMetadata(
    apiKeys: ApiKeys,
    options: IListAvailableModelsOptions = {},
): Promise<IAvailableModelMetadata[]> {
    const provider = options.provider ?? providerModeFromEnv() ?? "auto";
    if (provider === "gateway") {
        return listGatewayModels(apiKeys, options);
    }
    if (provider === "openrouter") {
        return (await listOpenAICompatibleModels({
            apiKey: apiKeys.openrouter,
            baseURL: apiKeys.openrouterBaseUrl ?? "https://openrouter.ai/api/v1",
            missingKeyMessage: "Please add your OpenRouter API key to list models.",
        })).map((id) => ({ id }));
    }
    if (provider === "bifrost") {
        return (await listOpenAICompatibleModels({
            apiKey: apiKeys.bifrost,
            baseURL: apiKeys.bifrostBaseUrl,
            missingKeyMessage: "Please add your Bifrost API key to list models.",
            missingBaseUrlMessage: "Please add BIFROST_BASE_URL to list Bifrost models.",
        })).map((id) => ({ id }));
    }
    return (await listOpenAIModels(apiKeys)).map((id) => ({ id }));
}

async function listOpenAIModels(apiKeys: ApiKeys): Promise<string[]> {
    if (!apiKeys.openai) {
        throw new Error("Please add your OpenAI API key to list models.");
    }
    return listOpenAICompatibleModels({
        apiKey: apiKeys.openai,
        missingKeyMessage: "Please add your OpenAI API key to list models.",
    });
}

async function listOpenAICompatibleModels(input: {
    apiKey?: string;
    baseURL?: string;
    missingKeyMessage: string;
    missingBaseUrlMessage?: string;
}): Promise<string[]> {
    if (!input.apiKey) {
        throw new Error(input.missingKeyMessage);
    }
    if (input.missingBaseUrlMessage && !input.baseURL) {
        throw new Error(input.missingBaseUrlMessage);
    }
    const client = new OpenAI({
        apiKey: input.apiKey,
        ...(input.baseURL ? { baseURL: input.baseURL } : {}),
        timeout: 15_000,
        maxRetries: 1,
    });
    const ids: string[] = [];
    for await (const model of client.models.list()) {
        ids.push(model.id);
    }
    return ids;
}

async function listGatewayModels(
    apiKeys: ApiKeys,
    options: IListAvailableModelsOptions,
): Promise<IAvailableModelMetadata[]> {
    if (!apiKeys.gateway) {
        throw new Error("Please add your AI Gateway API key to list models.");
    }
    const gateway =
        options.createGatewayProvider?.(apiKeys.gateway) ??
        createGateway({ apiKey: apiKeys.gateway });
    const metadata = await withTimeout(
        gateway.getAvailableModels(),
        MODEL_LIST_TIMEOUT_MS,
    );
    return metadata.models
        .flatMap(gatewayModelMetadata)
        .filter(isLanguageModel)
        .map((model) => ({
            id: model.id,
            ...optionalPricing(model.pricing),
        }));
}

function gatewayModelMetadata(model: unknown): IGatewayModelMetadata[] {
    if (!isRecord(model) || typeof model.id !== "string") return [];
    return [
        {
            id: model.id,
            modelType: stringProperty(model, "modelType"),
            type: stringProperty(model, "type"),
            pricing: model.pricing,
        },
    ];
}

function isLanguageModel(model: IGatewayModelMetadata): boolean {
    const modelType = model.modelType ?? model.type;
    return (
        modelType === undefined ||
        modelType === null ||
        modelType === "language"
    );
}

function pricingFromGateway(pricing: unknown): IModelPricing | undefined {
    if (!isRecord(pricing)) return undefined;
    const promptPricePerToken = numericPrice(pricing.input);
    const completionPricePerToken = numericPrice(pricing.output);
    if (
        promptPricePerToken === undefined ||
        completionPricePerToken === undefined
    ) {
        return undefined;
    }
    const promptTiers = tiersFromGateway(pricing.input_tiers);
    const completionTiers = tiersFromGateway(pricing.output_tiers);
    return {
        promptPricePerToken,
        completionPricePerToken,
        ...optionalRate(pricing, "reasoning", "reasoningPricePerToken"),
        ...optionalRate(pricing, "input_cache_read", "cacheReadPricePerToken"),
        ...optionalRate(pricing, "input_cache_write", "cacheWritePricePerToken"),
        ...(promptTiers.length > 0 ? { promptTiers } : {}),
        ...(completionTiers.length > 0 ? { completionTiers } : {}),
    };
}

function optionalRate<T extends string>(
    pricing: Record<string, unknown>,
    source: string,
    target: T,
): { [K in T]: number } | Record<string, never> {
    const value = numericPrice(pricing[source]);
    return value === undefined ? {} : { [target]: value } as { [K in T]: number };
}

function tiersFromGateway(value: unknown): IModelPricingTier[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((tier) => {
        if (!isRecord(tier)) return [];
        const pricePerToken = numericPrice(tier.cost);
        const minTokens = numericBoundary(tier.min);
        const maxTokens = numericBoundary(tier.max);
        if (pricePerToken === undefined || minTokens === undefined) return [];
        return [
            {
                minTokens,
                ...(maxTokens === undefined ? {} : { maxTokens }),
                pricePerToken,
            },
        ];
    });
}

function optionalPricing(
    pricing: unknown,
): { pricing: IModelPricing } | Record<string, never> {
    const normalized = pricingFromGateway(pricing);
    return normalized ? { pricing: normalized } : {};
}

function stringProperty(
    value: Record<string, unknown>,
    key: string,
): string | undefined {
    const property = value[key];
    return typeof property === "string" ? property : undefined;
}

function numericPrice(value: unknown): number | undefined {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function numericBoundary(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "string" || value.trim() === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new Error("Timed out listing models.")),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
