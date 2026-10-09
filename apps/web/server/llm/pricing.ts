import {
    gatewayModelIdFor,
    listAvailableModelMetadata,
    providerModeFromEnv,
    type ApiKeys,
    type IModelPricing,
} from "@mosaic/llm-core";
import { registryEntryFor } from "./modelRegistry";

export type ModelPricing = IModelPricing;

const CACHE_TTL_MS = 10 * 60 * 1000;

interface IPricingCacheEntry {
    expiresAt: number;
    byId: Map<string, ModelPricing>;
}

const gatewayPricingCache = new Map<string, IPricingCacheEntry>();

export function pricingFor(modelId: string): ModelPricing | undefined {
    return registryEntryFor(modelId)?.pricing;
}

export async function resolvePricingFor(
    modelId: string,
    apiKeys: ApiKeys,
): Promise<ModelPricing | undefined> {
    const staticPricing = pricingFor(modelId);
    if (staticPricing) return staticPricing;
    if (providerModeFromEnv() !== "gateway" || !apiKeys.gateway) return undefined;
    const livePricing = await gatewayPricingFor(apiKeys);
    return livePricing.get(gatewayModelIdFor(modelId) ?? modelId);
}

async function gatewayPricingFor(
    apiKeys: ApiKeys,
): Promise<Map<string, ModelPricing>> {
    const key = cacheKeyFor(apiKeys);
    const cached = gatewayPricingCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.byId;

    try {
        const models = await listAvailableModelMetadata(apiKeys, {
            provider: "gateway",
        });
        const byId = new Map<string, ModelPricing>();
        for (const model of models) {
            if (model.pricing) byId.set(model.id, model.pricing);
        }
        gatewayPricingCache.set(key, {
            byId,
            expiresAt: Date.now() + CACHE_TTL_MS,
        });
        return byId;
    } catch {
        return new Map();
    }
}

function cacheKeyFor(apiKeys: ApiKeys): string {
    const raw = apiKeys.gateway ?? "";
    let hash = 0;
    for (let i = 0; i < raw.length; i += 1) {
        hash = (hash * 31 + raw.charCodeAt(i)) | 0;
    }
    return String(hash);
}
