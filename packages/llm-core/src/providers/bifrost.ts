import {
    MODEL_REGISTRY,
    registryEntryFor,
    type IModelRegistryEntry,
} from "../models/registry.js";

/**
 * Bifrost's OpenAI-compatible API lives under `/v1`. Accept the gateway's
 * address with or without it (and with or without a trailing slash).
 */
export function bifrostApiBaseUrl(baseUrl: string): string {
    const trimmed = baseUrl.trim().replace(/\/+$/, "");
    return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
}

/**
 * The provider Bifrost sends a model to: the first part of its Bifrost id,
 * e.g. "openrouter" for `openrouter/google/gemini-2.5-flash` or "gemini" for
 * `gemini/gemini-2.5-flash`. Undefined for an id without a prefix.
 */
export function bifrostUpstream(modelId: string): string | undefined {
    const slash = modelId.indexOf("/");
    return slash > 0 ? modelId.slice(0, slash).toLowerCase() : undefined;
}

/** Whether Bifrost forwards this model to OpenRouter. */
export function bifrostRoutesViaOpenRouter(modelId: string): boolean {
    return bifrostUpstream(modelId) === "openrouter";
}

/**
 * OpenRouter's (and Bifrost's) names for a maker that the registry calls by
 * another name; `gemini/` and `vertex/` are Bifrost's routes to Google.
 */
const VENDOR_ALIASES: Readonly<Record<string, string>> = {
    "z-ai": "zai",
    "x-ai": "xai",
    mistralai: "mistral",
    "meta-llama": "meta",
    qwen: "alibaba",
    gemini: "google",
    vertex: "google",
};

/**
 * Lower case, a `:variant` suffix dropped (`:nitro`, `:free`), any other
 * dot read as a separator (Bedrock's `google.gemma-3-27b-it`), maker aliases
 * read as the registry's (`z-ai` as `zai`), and a dot or dash between two
 * digits read the same (`claude-sonnet-4-6` is `claude-sonnet-4.6`).
 */
function normalizeBifrostModelId(modelId: string): string {
    const segments = modelId
        .toLowerCase()
        .replace(/:[^/]+$/, "")
        .replace(/(\d)\.(?=\d)/g, "$1\u2024")
        .replace(/\./g, "/")
        .split("/")
        .filter(Boolean);
    return segments
        .map((segment, index) =>
            index < segments.length - 1
                ? (VENDOR_ALIASES[segment] ?? segment)
                : segment.replace(/(\d)[-\u2024](?=\d)/g, "$1."),
        )
        .join("/")
        .replace(/\u2024/g, ".");
}

/** The id without a trailing release date (`-20250929`, `-2025-09-29`, `@20250929`). */
function withoutReleaseDate(modelId: string): string {
    return modelId.replace(
        /(?:[-@]\d{8}|-\d{4}-\d{2}-\d{2})(?=(?::[^/]+)?$)/,
        "",
    );
}

/**
 * Bifrost's `/models` list can namespace a provider model with the upstream
 * route (`openrouter/`, `bedrock/`, `gemini/`, etc.). A listed id matches a
 * known model when, after normalizing (see `normalizeBifrostModelId`), it
 * equals that model's id or ends with `/<id>`. This is deliberately a suffix
 * match: it supports new Bifrost upstreams without treating unrelated model
 * IDs as known.
 */
export function bifrostModelIdMatches(
    listedModelId: string,
    expectedModelId: string | undefined,
): boolean {
    if (!expectedModelId) return false;
    const listed = normalizeBifrostModelId(listedModelId);
    const expected = normalizeBifrostModelId(expectedModelId);
    return listed === expected || listed.endsWith(`/${expected}`);
}

/**
 * Bifrost upstreams whose ids are the maker's own bare model names
 * (`anthropic/claude-sonnet-4-6`, `vertex/claude-sonnet-4-6@20250929`).
 */
const BARE_NAME_UPSTREAMS = new Set([
    "anthropic",
    "openai",
    "gemini",
    "vertex",
    "bedrock",
    "azure",
]);

/** Ids a registry model is known by on routes Bifrost can forward to. */
function qualifiedIdsOf(entry: IModelRegistryEntry): (string | undefined)[] {
    return [
        entry.transports.bifrost,
        entry.gatewayModelId,
        entry.transports.openrouter,
        entry.transports.anthropic && `anthropic/${entry.transports.anthropic}`,
        entry.transports.google && `google/${entry.transports.google}`,
    ];
}

function bareName(modelId: string): string {
    const normalized = normalizeBifrostModelId(modelId);
    return normalized.slice(normalized.lastIndexOf("/") + 1);
}

function findRegistryEntryForBifrostModel(
    bifrostModelId: string,
): IModelRegistryEntry | undefined {
    for (const id of new Set([
        bifrostModelId,
        withoutReleaseDate(bifrostModelId),
    ])) {
        const direct = registryEntryFor(id);
        if (direct) return direct;
        const upstream = bifrostUpstream(id);
        // Bifrost ids first, then (for an `openrouter/` id) OpenRouter's own
        // id without the prefix, then the model's other ids.
        for (let pass = 0; pass < 5; pass += 1) {
            if (pass === 1 && upstream === "openrouter") {
                const inner = registryEntryFor(id.slice("openrouter/".length));
                if (inner) return inner;
            }
            const found = MODEL_REGISTRY.find((entry) =>
                bifrostModelIdMatches(id, qualifiedIdsOf(entry)[pass]),
            );
            if (found) return found;
        }
        if (upstream && BARE_NAME_UPSTREAMS.has(upstream)) {
            const name = bareName(id);
            const found = MODEL_REGISTRY.find((entry) =>
                qualifiedIdsOf(entry).some(
                    (known) => known !== undefined && bareName(known) === name,
                ),
            );
            if (found) return found;
        }
    }
    return undefined;
}

let lookupRegistry: readonly IModelRegistryEntry[] | undefined;
const lookupCache = new Map<string, IModelRegistryEntry | null>();

/**
 * The registry model behind a Bifrost model id, for its label, thinking
 * levels, structured output and list prices: the id itself when the
 * registry knows it, else the first model whose Bifrost, gateway,
 * OpenRouter or maker id matches (see `bifrostModelIdMatches`), also with a
 * trailing release date dropped. Examples:
 * `openrouter/anthropic/claude-sonnet-4.6` and `anthropic/claude-sonnet-4-6`
 * are `anthropic/claude-sonnet-4.6`; `openrouter/openai/gpt-4o` is `gpt-4o`;
 * `openrouter/meta-llama/llama-4-scout` is `meta/llama-4-scout`.
 */
export function registryEntryForBifrostModel(
    bifrostModelId: string,
): IModelRegistryEntry | undefined {
    if (lookupRegistry !== MODEL_REGISTRY) {
        lookupRegistry = MODEL_REGISTRY;
        lookupCache.clear();
    }
    const cached = lookupCache.get(bifrostModelId);
    if (cached !== undefined) return cached ?? undefined;
    const found = findRegistryEntryForBifrostModel(bifrostModelId);
    if (lookupCache.size > 5_000) lookupCache.clear();
    lookupCache.set(bifrostModelId, found ?? null);
    return found;
}

/**
 * The registry model whose capabilities (thinking levels, structured output,
 * vision, label, list price) apply to `modelId`: a registry, gateway or
 * transport id the registry knows, or a provider-prefixed Bifrost id such as
 * `openrouter/anthropic/claude-sonnet-4.6` (see
 * `registryEntryForBifrostModel`). Use `registryEntryFor` instead where a
 * Bifrost id must stay unknown (which transports a model id names).
 */
export function registryModelFor(
    modelId: string,
): IModelRegistryEntry | undefined {
    const direct = registryEntryFor(modelId);
    if (direct || !modelId.includes("/")) return direct;
    return registryEntryForBifrostModel(modelId);
}

/**
 * The id a Bifrost call sends for `modelId`: a registry id (or its gateway
 * id) is sent as the registry's Bifrost id (`gpt-4o` → `openai/gpt-4o`); any
 * other id, such as one from Bifrost's own model list
 * (`openrouter/google/gemini-2.5-flash`), is sent as it is.
 */
export function bifrostModelIdFor(modelId: string): string {
    const known = registryEntryFor(modelId);
    if (known && (known.id === modelId || known.gatewayModelId === modelId))
        return known.transports.bifrost ?? modelId;
    return modelId;
}
