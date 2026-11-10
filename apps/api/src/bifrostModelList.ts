import { createHash } from "node:crypto";
import {
    listAvailableModelMetadata,
    registryEntryForBifrostModel,
    type ApiKeys,
    type IModelPricing,
    type IModelRegistryEntry,
} from "@flash-evals/llm-core";

/** How long a fetched Bifrost model list is reused. */
const LIST_TTL_MS = 10 * 60 * 1000;
/** How long a failed fetch is remembered before it is tried again. */
const ERROR_TTL_MS = 60 * 1000;

export type BifrostModelListResult =
    | {
          ids: string[];
          /** The list's own price per id, when it gives one. */
          pricing?: Record<string, IModelPricing>;
      }
    | { error: string };

interface ICacheEntry {
    expiresAt: number;
    result: BifrostModelListResult;
}

const cache = new Map<string, ICacheEntry>();
const pending = new Map<string, Promise<BifrostModelListResult>>();

export interface IBifrostModelListDeps {
    list?: typeof listAvailableModelMetadata;
    now?: () => number;
}

/** The host of Bifrost's address, for messages; never the key. */
export function bifrostHost(baseUrl: string | undefined): string | undefined {
    if (!baseUrl) return undefined;
    try {
        return new URL(baseUrl).host;
    } catch {
        return undefined;
    }
}

/**
 * Bifrost's own model ids (its `/v1/models` list), fetched once and reused
 * for ten minutes per address and key. Undefined when no Bifrost key and
 * address are configured; `{ error }` in plain words when the list can't be
 * fetched (remembered for a minute).
 */
export async function bifrostModelList(
    apiKeys: ApiKeys,
    deps: IBifrostModelListDeps = {},
): Promise<BifrostModelListResult | undefined> {
    if (!apiKeys.bifrost || !apiKeys.bifrostBaseUrl) return undefined;
    const now = deps.now ?? Date.now;
    const key = createHash("sha256")
        .update(`${apiKeys.bifrostBaseUrl}\n${apiKeys.bifrost}`)
        .digest("hex");
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.result;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const request = fetchList(apiKeys, deps.list ?? listAvailableModelMetadata)
        .then((result) => {
            cache.set(key, {
                expiresAt:
                    now() + ("error" in result ? ERROR_TTL_MS : LIST_TTL_MS),
                result,
            });
            return result;
        })
        .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
}

async function fetchList(
    apiKeys: ApiKeys,
    list: typeof listAvailableModelMetadata,
): Promise<BifrostModelListResult> {
    try {
        const models = await list(apiKeys, { provider: "bifrost" });
        const priced = models.flatMap((model) =>
            model.pricing ? [[model.id, model.pricing] as const] : [],
        );
        return {
            ids: models.map((model) => model.id),
            ...(priced.length ? { pricing: Object.fromEntries(priced) } : {}),
        };
    } catch (error) {
        const host = bifrostHost(apiKeys.bifrostBaseUrl) ?? "its address";
        const detail =
            error instanceof Error && error.message.trim()
                ? ` (${error.message.trim().slice(0, 200)})`
                : "";
        return {
            error: `Bifrost is set up (${host}) but its model list couldn't be fetched${detail}. No model is offered on Bifrost until it can be: check BIFROST_BASE_URL and the Bifrost key, then reload.`,
        };
    }
}

/** Forget fetched lists (tests). */
export function resetBifrostModelListCache(): void {
    cache.clear();
    pending.clear();
}

/**
 * For each registry model, the Bifrost id to offer it under, from Bifrost's
 * list: the registry's own Bifrost id when listed, else an `openrouter/` id
 * (it can follow data rules), else the first listed id that maps to it.
 */
export function bifrostIdsByRegistryModel(
    listedIds: readonly string[],
): Map<string, string> {
    const byModel = new Map<string, string[]>();
    for (const id of listedIds) {
        const entry = registryEntryForBifrostModel(id);
        if (!entry) continue;
        byModel.set(entry.id, [...(byModel.get(entry.id) ?? []), id]);
    }
    const chosen = new Map<string, string>();
    for (const [modelId, ids] of byModel) {
        const registryId =
            registryEntryForBifrostModel(modelId)?.transports.bifrost;
        const pick =
            ids.find((id) => id === registryId) ??
            [...ids].sort().find((id) => id.startsWith("openrouter/")) ??
            [...ids].sort()[0]!;
        chosen.set(modelId, pick);
    }
    return chosen;
}

/**
 * A registry entry as Bifrost offers it: under the id Bifrost lists for it,
 * or without Bifrost when Bifrost doesn't list it (or its list failed).
 */
export function withListedBifrostId(
    entry: IModelRegistryEntry,
    listed: ReadonlyMap<string, string> | undefined,
): IModelRegistryEntry {
    const id = listed?.get(entry.id);
    if (id === entry.transports.bifrost) return entry;
    const { bifrost: _old, ...others } = entry.transports;
    return { ...entry, transports: id ? { ...others, bifrost: id } : others };
}
