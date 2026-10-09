import {
    listAvailableModelMetadata,
    providerModeFromEnv,
    registryEntriesForProvider,
    type ApiKeys,
    type IAvailableModelMetadata,
    type IModelRegistryEntry,
} from "@mosaic/llm-core";

export interface IResolvedModel extends IModelRegistryEntry {
    available: boolean;
}

export interface IAvailableModelsResult {
    models: IResolvedModel[];
    degraded: boolean;
}

const CACHE_TTL_MS = 10 * 60 * 1000;

interface ICacheEntry {
    expiresAt: number;
    result: IAvailableModelsResult;
}

const cache = new Map<string, ICacheEntry>();

function cacheKeyFor(apiKeys: ApiKeys, provider: "openai" | "gateway"): string {
    const raw = [
        provider,
        apiKeys.openai ?? "",
        apiKeys.gateway ?? "",
    ].join(":");
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
        hash = (hash * 31 + raw.charCodeAt(i)) | 0;
    }
    return String(hash);
}

function orderAvailableFirst(a: IResolvedModel, b: IResolvedModel): number {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return a.label.localeCompare(b.label);
}

function resolveAgainst(
    liveModels: IAvailableModelMetadata[],
    provider: "openai" | "gateway",
): IResolvedModel[] {
    const liveById = new Map(liveModels.map((model) => [model.id, model]));
    return registryEntriesForProvider(provider, liveModels).map((entry) => ({
        ...entry,
        ...(entry.pricing
            ? {}
            : {
                  pricing: liveById.get(modelIdForProvider(entry, provider))
                      ?.pricing,
              }),
        available: liveById.has(modelIdForProvider(entry, provider)),
    })).sort(orderAvailableFirst);
}

function degradedFallback(): IAvailableModelsResult {
    const provider = providerModeForAvailability();
    const models = registryEntriesForProvider(provider).map((entry) => ({
        ...entry,
        available: true,
    })).sort(orderAvailableFirst);
    return { models, degraded: true };
}

export async function getAvailableModels(
    apiKeys: ApiKeys,
): Promise<IAvailableModelsResult> {
    const provider = providerModeForAvailability();
    const key = cacheKeyFor(apiKeys, provider);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result;
    }

    try {
        const liveModels = await listAvailableModelMetadata(apiKeys, { provider });
        const result: IAvailableModelsResult = {
            models: resolveAgainst(liveModels, provider),
            degraded: false,
        };
        cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, result });
        return result;
    } catch (err) {
        if (isProviderConfigurationError(err)) throw err;
        // Don't cache the fallback — a transient outage should self-heal on the
        // next call rather than serving "unverified" for the whole TTL window.
        return degradedFallback();
    }
}

function isProviderConfigurationError(err: unknown): boolean {
    return (
        err instanceof Error &&
        /^Please add your (OpenAI|AI Gateway) API key/.test(err.message)
    );
}

function providerModeForAvailability(): "openai" | "gateway" {
    const mode = providerModeFromEnv();
    return mode === "gateway" ? "gateway" : "openai";
}

function modelIdForProvider(
    entry: IModelRegistryEntry,
    provider: "openai" | "gateway",
): string {
    return provider === "gateway" ? entry.gatewayModelId : entry.id;
}
