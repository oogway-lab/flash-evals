import {
    isProviderTransport,
    PROVIDER_TRANSPORTS,
    type IModelPriceListResponse,
    type IModelPriceListSource,
    type IModelProviderOffer,
    type IProviderStatusResponse,
    type ProviderTransport,
} from "@flash-evals/api-contract";
import {
    MODEL_REGISTRY,
    modelVendor,
    type ApiKeys,
    type IModelPricing,
    type IModelRegistryEntry,
} from "@flash-evals/llm-core";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiBadRequestError } from "../errors.js";
import type { ProviderHostResolver } from "../providerBaseUrl.js";
import {
    resolveApiKeys,
    teamBaseUrlListingGuard,
    type IResolvedProviderKeys,
} from "../secrets/resolveApiKeys.js";
import {
    bifrostHost,
    bifrostModelList,
    type IBifrostModelListDeps,
} from "../bifrostModelList.js";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** The two price lists the app compares side by side. */
const PRICE_LISTS = ["gateway", "openrouter"] as const;

/**
 * The provider runs start each model on: FLASH_EVALS_LLM_PROVIDER from the
 * API's .env. "vercel-ai" is the Vercel gateway too; "auto" has none.
 */
export function defaultProvider(
    config: Pick<IApiConfig, "flashEvalsLlmProvider">,
): ProviderTransport | undefined {
    const mode = config.flashEvalsLlmProvider;
    if (mode === "vercel-ai") return "gateway";
    return isProviderTransport(mode) ? mode : undefined;
}

/** Which providers have a key and whether it came from Settings or .env. */
export async function providerStatusPayload(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    bifrostList?: IBifrostModelListDeps,
    resolveHost?: ProviderHostResolver,
): Promise<IProviderStatusResponse> {
    validateTeamId(teamId);
    const [resolved, stored] = await Promise.all([
        resolveApiKeys(db, config, teamId),
        db.query<{ provider: string }>(
            "select provider from provider_keys where team_id = $1",
            [teamId],
        ),
    ]);
    const inSettings = new Set(stored.rows.map((row) => row.provider));
    const provider = defaultProvider(config);
    const bifrost = await bifrostStatus(resolved, bifrostList, resolveHost);
    return {
        ...(provider ? { defaultProvider: provider } : {}),
        ...(bifrost ? { bifrost } : {}),
        keys: savedKeyProviders(resolved.apiKeys).map((transport) => ({
            provider: transport,
            source: inSettings.has(settingsKeyFor(transport))
                ? "settings"
                : "env",
        })),
    };
}

/** Bifrost's address host and whether its model list can be fetched. */
async function bifrostStatus(
    resolved: IResolvedProviderKeys,
    deps: IBifrostModelListDeps | undefined,
    resolveHost: ProviderHostResolver | undefined,
): Promise<IProviderStatusResponse["bifrost"]> {
    const { apiKeys } = resolved;
    if (!apiKeys.bifrost || !apiKeys.bifrostBaseUrl) return undefined;
    const host = bifrostHost(apiKeys.bifrostBaseUrl);
    // The list is fetched with the team's key: re-check a saved address
    // first, as every other Bifrost request does.
    try {
        await teamBaseUrlListingGuard(resolved, resolveHost)("bifrost");
    } catch (error) {
        return {
            ...(host ? { baseUrlHost: host } : {}),
            modelListError:
                error instanceof Error
                    ? error.message
                    : "The saved Bifrost address could not be checked.",
        };
    }
    const listed = await bifrostModelList(apiKeys, deps);
    if (!listed) return undefined;
    return {
        ...(host ? { baseUrlHost: host } : {}),
        ...("error" in listed
            ? { modelListError: listed.error }
            : { modelCount: listed.ids.length }),
    };
}

/** The Settings key a transport uses: direct Google calls use the Gemini key. */
function settingsKeyFor(transport: ProviderTransport): string {
    return transport === "google" ? "gemini" : transport;
}

/** Providers with a key (Settings or the repo's .env), in the order the app offers them. */
export function savedKeyProviders(apiKeys: ApiKeys): ProviderTransport[] {
    return PROVIDER_TRANSPORTS.filter((transport) =>
        transport === "bifrost"
            ? Boolean(apiKeys.bifrost && apiKeys.bifrostBaseUrl)
            : Boolean(apiKeys[transport]),
    );
}

/** USD per 1M tokens, without float noise such as 0.30000000000000004. */
function perMillion(pricePerToken: number): number {
    return Math.round(pricePerToken * 1e12) / 1e6;
}

function priceFields(
    pricing: IModelPricing | undefined,
): Pick<IModelProviderOffer, "inputPerMillion" | "outputPerMillion"> {
    return pricing
        ? {
              inputPerMillion: perMillion(pricing.promptPricePerToken),
              outputPerMillion: perMillion(pricing.completionPricePerToken),
          }
        : {};
}

/**
 * Every provider that can run this model with its ID and price there. Vercel
 * and OpenRouter are always listed when they carry the model, key or not, so
 * prices can be compared before a key is saved; OpenAI, Anthropic, the Gemini
 * API and Bifrost only when their key is saved.
 */
export function providerOffers(
    entry: IModelRegistryEntry,
    saved: readonly ProviderTransport[],
    livePricing: Partial<Record<ProviderTransport, IModelPricing>> = {},
): IModelProviderOffer[] {
    return PROVIDER_TRANSPORTS.flatMap((transport) => {
        const modelId = entry.transports[transport];
        const keySaved = saved.includes(transport);
        if (!modelId) return [];
        if (!PRICE_LISTS.some((list) => list === transport) && !keySaved)
            return [];
        const pricing =
            livePricing[transport] ??
            entry.pricingByTransport?.[transport] ??
            // OpenAI and Bifrost publish no price list: list prices.
            (transport === "openai" || transport === "bifrost"
                ? entry.pricing
                : undefined);
        return [{ transport, modelId, ...priceFields(pricing), keySaved }];
    });
}

/**
 * The preferred provider, when it has a key saved and lists the model. The
 * run form starts from it; without one, the existing order stands.
 */
export function preferredOffer(
    offers: readonly IModelProviderOffer[],
    preferred: ProviderTransport | undefined,
): ProviderTransport | undefined {
    return offers.find(
        (offer) => offer.keySaved && offer.transport === preferred,
    )?.transport;
}

export async function modelPriceListPayload(
    db: IDb,
    config: IApiConfig,
    teamId: string,
): Promise<IModelPriceListResponse> {
    validateTeamId(teamId);
    const [resolved, lists] = await Promise.all([
        resolveApiKeys(db, config, teamId),
        priceListSources(db),
    ]);
    const preferredProvider = defaultProvider(config);
    const saved = savedKeyProviders(resolved.apiKeys);
    const models = MODEL_REGISTRY.flatMap((entry) => {
        const providers = providerOffers(entry, saved).filter((offer) =>
            PRICE_LISTS.some((list) => list === offer.transport),
        );
        return providers.length > 0
            ? [
                  {
                      id: entry.id,
                      label: entry.label,
                      vendor: modelVendor(entry.id, entry.provider),
                      providers,
                  },
              ]
            : [];
    }).sort(
        (a, b) =>
            Number(a.id.startsWith("~")) - Number(b.id.startsWith("~")) ||
            a.vendor.localeCompare(b.vendor) ||
            a.label.localeCompare(b.label),
    );
    return {
        lists,
        models,
        savedKeyProviders: saved,
        ...(preferredProvider ? { preferredProvider } : {}),
    };
}

async function priceListSources(db: IDb): Promise<IModelPriceListSource[]> {
    const result = await db.query<{
        source: string;
        fetchedAt: Date | string;
        modelCount: number | string;
    }>(
        `select source, fetched_at as "fetchedAt",
            jsonb_array_length(snapshot->'models') as "modelCount"
        from model_catalog_snapshots
        where source = any($1::text[])`,
        [[...PRICE_LISTS]],
    );
    return PRICE_LISTS.map((provider) => {
        const row = result.rows.find(
            (candidate) => candidate.source === provider,
        );
        return {
            provider,
            ...(row
                ? { fetchedAt: new Date(row.fetchedAt).toISOString() }
                : {}),
            modelCount: row ? Number(row.modelCount) : 0,
        };
    });
}

function validateTeamId(teamId: string): void {
    if (typeof teamId !== "string" || !UUID_PATTERN.test(teamId)) {
        throw new ApiBadRequestError("teamId must be a valid UUID");
    }
}
