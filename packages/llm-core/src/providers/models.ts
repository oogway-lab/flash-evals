import { bifrostApiBaseUrl } from "./bifrost.js";
import {
    bifrostModelInfoFromListing,
    bifrostModelListKeyFor,
    installBifrostModelInfo,
    type IBifrostModelInfo,
} from "./bifrostModelInfo.js";
import { createGateway, type GatewayProvider } from "@ai-sdk/gateway";
import OpenAI from "openai";
import type { ApiKeys } from "../types.js";
import { gatewayAttributionHeaders } from "./attribution.js";
import { openAIClientEndpoint } from "./endpoints.js";
import { providerModeFromEnv, type EvalProviderMode } from "./factory.js";
import {
    directMakerModelIds,
    isDirectMakerTransport,
    registryEntryFor,
    type DirectMakerTransport,
    type IModelPricing,
    type IModelPricingTier,
} from "../models/registry.js";

const MODEL_LIST_TIMEOUT_MS = 15_000;

export interface IListAvailableModelsOptions {
    createGatewayProvider?: (
        apiKey: string,
    ) => Pick<GatewayProvider, "getAvailableModels">;
    provider?: EvalProviderMode | DirectMakerTransport;
}

export interface IAvailableModelMetadata {
    id: string;
    pricing?: IModelPricing;
    /** Bifrost: what its list says the model takes (see IBifrostModelInfo). */
    bifrost?: IBifrostModelInfo;
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
    if (isDirectMakerTransport(provider)) {
        return listDirectMakerModels(apiKeys, provider);
    }
    if (provider === "openrouter") {
        return (
            await listOpenAICompatibleModels({
                apiKey: apiKeys.openrouter,
                baseURL:
                    apiKeys.openrouterBaseUrl ?? "https://openrouter.ai/api/v1",
                missingKeyMessage:
                    "Please add your OpenRouter API key to list models.",
            })
        ).map((id) => ({ id }));
    }
    if (provider === "bifrost") {
        // Bifrost's list carries OpenRouter's metadata for openrouter/ ids;
        // remembered so thinking and output limits can follow it.
        const models = (
            await listOpenAICompatibleModelRecords({
                apiKey: apiKeys.bifrost,
                baseURL: apiKeys.bifrostBaseUrl
                    ? bifrostApiBaseUrl(apiKeys.bifrostBaseUrl)
                    : undefined,
                missingKeyMessage:
                    "Please add your Bifrost API key to list models.",
                missingBaseUrlMessage:
                    "Please add BIFROST_BASE_URL to list Bifrost models.",
            })
        ).flatMap((record) => {
            const info = bifrostModelInfoFromListing(record);
            return info
                ? [
                      {
                          id: info.id,
                          bifrost: info,
                          ...(info.pricing ? { pricing: info.pricing } : {}),
                      },
                  ]
                : [];
        });
        const listKey = bifrostModelListKeyFor(apiKeys);
        if (listKey)
            installBifrostModelInfo(
                listKey,
                models.map((model) => model.bifrost),
            );
        return models;
    }
    return (await listOpenAIModels(apiKeys)).map((id) => ({ id }));
}

/**
 * Direct maker models come from the registry, with no request to the maker:
 * only models whose direct id has been checked are offered.
 */
function listDirectMakerModels(
    apiKeys: ApiKeys,
    transport: DirectMakerTransport,
): IAvailableModelMetadata[] {
    if (!apiKeys[transport]) {
        throw new Error(
            `Please add your ${transport === "anthropic" ? "Anthropic" : "Gemini"} API key in Settings to list models.`,
        );
    }
    return directMakerModelIds(transport).flatMap((id) => {
        const entry = registryEntryFor(id);
        const modelId = entry?.transports[transport];
        if (!entry || !modelId) return [];
        const pricing = entry.pricingByTransport?.[transport];
        return [{ id: modelId, ...(pricing ? { pricing } : {}) }];
    });
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

interface IOpenAICompatibleListInput {
    apiKey?: string;
    baseURL?: string;
    missingKeyMessage: string;
    missingBaseUrlMessage?: string;
}

async function listOpenAICompatibleModels(
    input: IOpenAICompatibleListInput,
): Promise<string[]> {
    return (await listOpenAICompatibleModelRecords(input)).map(
        (model) => model.id,
    );
}

/** Every listed model as the provider sent it, extra fields included. */
async function listOpenAICompatibleModelRecords(
    input: IOpenAICompatibleListInput,
): Promise<OpenAI.Models.Model[]> {
    if (!input.apiKey) {
        throw new Error(input.missingKeyMessage);
    }
    if (input.missingBaseUrlMessage && !input.baseURL) {
        throw new Error(input.missingBaseUrlMessage);
    }
    const client = new OpenAI({
        apiKey: input.apiKey,
        ...openAIClientEndpoint(input.baseURL),
        timeout: 15_000,
        maxRetries: 1,
    });
    const models: OpenAI.Models.Model[] = [];
    for await (const model of client.models.list()) {
        models.push(model);
    }
    return models;
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
        createGateway({
            apiKey: apiKeys.gateway,
            headers: gatewayAttributionHeaders(),
        });
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
        ...optionalRate(
            pricing,
            "input_cache_write",
            "cacheWritePricePerToken",
        ),
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
    return value === undefined
        ? {}
        : ({ [target]: value } as { [K in T]: number });
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

async function withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
): Promise<T> {
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
