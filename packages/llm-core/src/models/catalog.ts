import type {
    IModelPricing,
    IModelPricingTier,
    IModelRegistryEntry,
    EvalProviderTransport,
    IReasoningEffortCapability,
} from "./registry.js";
import { REASONING_EFFORT_LEVELS, type ReasoningEffort } from "../types.js";
import { claudeRejectsThinkingDisabled } from "./claudeLimits.js";

export const CATALOG_URLS = {
    "models.dev": "https://models.dev/api.json",
    openrouter: "https://openrouter.ai/api/v1/models",
    gateway: "https://ai-gateway.vercel.sh/v1/models",
} as const;
export type CatalogSource = keyof typeof CATALOG_URLS;
/** Transports public catalogs describe; direct maker prices live in the registry. */
export type CatalogTransport = Exclude<
    EvalProviderTransport,
    "bifrost" | "anthropic" | "google"
>;

export interface ICatalogModel {
    id: string;
    transport: CatalogTransport;
    name: string;
    family: string;
    reasoning: boolean;
    vision: boolean;
    structuredOutput: boolean;
    reasoningEffort?: IReasoningEffortCapability;
    pricing?: IModelPricing;
}
export interface IModelCatalogSnapshot {
    version: 1;
    source: CatalogSource;
    fetchedAt: string;
    models: ICatalogModel[];
}

/** Normalize only text-generation models; prices in models.dev are USD per million tokens. */
export function parseModelCatalog(
    source: CatalogSource,
    payload: unknown,
    now = new Date(),
): IModelCatalogSnapshot {
    if (!isRecord(payload)) throw new Error(`Invalid ${source} model catalog`);
    let models: ICatalogModel[];
    if (source === "models.dev") {
        models = (
            [
                ["openai", "openai"],
                ["openrouter", "openrouter"],
                ["vercel", "gateway"],
            ] as const
        ).flatMap(([provider, transport]) => {
            const entry = payload[provider];
            if (!isRecord(entry) || !isRecord(entry.models))
                throw new Error(`Missing ${provider} catalog`);
            return Object.values(entry.models).flatMap((model) =>
                normalizeModel(model, transport, true),
            );
        });
    } else {
        if (!Array.isArray(payload.data))
            throw new Error(`Missing ${source} models`);
        models = payload.data.flatMap((model) =>
            normalizeModel(model, source, false),
        );
    }
    if (models.length === 0) throw new Error(`Empty ${source} model catalog`);
    return {
        version: 1,
        source,
        fetchedAt: now.toISOString(),
        models: models.sort((a, b) =>
            `${a.transport}/${a.id}`.localeCompare(`${b.transport}/${b.id}`),
        ),
    };
}

function normalizeModel(
    value: unknown,
    transport: CatalogTransport,
    modelsDev: boolean,
): ICatalogModel[] {
    if (
        !isRecord(value) ||
        typeof value.id !== "string" ||
        !value.id ||
        value.id.length > 300
    )
        return [];
    if (value.type !== undefined && value.type !== "language") return [];
    const inputs = textModelInputs(value, modelsDev || transport === "gateway");
    if (!inputs) return [];
    if (
        /(?:embed|rerank|moderation|whisper|transcri|(?:^|[-/])tts(?:[-/]|$))/i.test(
            value.id,
        )
    )
        return [];
    const parameters = stringArray(value.supported_parameters);
    const tags = stringArray(value.tags);
    const reasoning =
        value.reasoning === true ||
        parameters.includes("reasoning") ||
        tags.includes("reasoning");
    const pricing = normalizePricing(value, transport, modelsDev);
    const reasoningEffort = effortCapability(value.reasoning_options);
    const name =
        typeof value.name === "string"
            ? value.name.replace(/^[^:]+: /, "")
            : value.id;
    const modelName = value.id.slice(value.id.lastIndexOf("/") + 1);
    const family =
        typeof value.family === "string"
            ? value.family
            : modelName.split(/[-_.]/)[0]!;
    return [
        {
            id: value.id,
            transport,
            name,
            family,
            reasoning,
            vision: inputs.includes("image"),
            structuredOutput: modelsDev
                ? value.structured_output === true
                : parameters.includes("response_format") ||
                  parameters.includes("structured_outputs") ||
                  tags.includes("structured-output"),
            reasoningEffort,
            pricing,
        },
    ];
}

function textModelInputs(
    value: Record<string, unknown>,
    simpleKeys: boolean,
): string[] | undefined {
    const modalities = simpleKeys ? value.modalities : value.architecture;
    if (!isRecord(modalities)) return undefined;
    const inputs = stringArray(
        simpleKeys ? modalities.input : modalities.input_modalities,
    );
    const outputs = stringArray(
        simpleKeys ? modalities.output : modalities.output_modalities,
    );
    return inputs.includes("text") &&
        outputs.length === 1 &&
        outputs[0] === "text"
        ? inputs
        : undefined;
}

function normalizePricing(
    value: Record<string, unknown>,
    transport: CatalogTransport,
    modelsDev: boolean,
): IModelPricing | undefined {
    const pricing = modelsDev ? value.cost : value.pricing;
    if (!isRecord(pricing)) return undefined;
    const input = finitePrice(
        transport === "openrouter" && !modelsDev
            ? pricing.prompt
            : pricing.input,
    );
    const output = finitePrice(
        transport === "openrouter" && !modelsDev
            ? pricing.completion
            : pricing.output,
    );
    if (input === undefined || output === undefined) return undefined;
    const divisor = modelsDev ? 1_000_000 : 1;
    const optionalRates: Partial<IModelPricing> = {};
    for (const [source, target] of [
        [
            modelsDev ? "cache_read" : "input_cache_read",
            "cacheReadPricePerToken",
        ],
        [
            modelsDev ? "cache_write" : "input_cache_write",
            "cacheWritePricePerToken",
        ],
        ["reasoning", "reasoningPricePerToken"],
    ] as const) {
        const rate = finitePrice(pricing[source]);
        if (rate !== undefined) optionalRates[target] = rate / divisor;
    }
    const promptTiers = pricingTiers(pricing.input_tiers, divisor);
    const completionTiers = pricingTiers(pricing.output_tiers, divisor);
    return {
        promptPricePerToken: input / divisor,
        completionPricePerToken: output / divisor,
        ...optionalRates,
        ...(promptTiers.length ? { promptTiers } : {}),
        ...(completionTiers.length ? { completionTiers } : {}),
    };
}

function pricingTiers(value: unknown, divisor: number): IModelPricingTier[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((tier) => {
        if (!isRecord(tier)) return [];
        const minTokens = finitePrice(tier.min);
        const maxTokens = tier.max == null ? undefined : finitePrice(tier.max);
        const cost = finitePrice(tier.cost);
        if (
            minTokens === undefined ||
            cost === undefined ||
            (tier.max != null &&
                (maxTokens === undefined || maxTokens <= minTokens))
        )
            return [];
        return [
            {
                minTokens,
                ...(maxTokens === undefined ? {} : { maxTokens }),
                pricePerToken: cost / divisor,
            },
        ];
    });
}
function finitePrice(value: unknown): number | undefined {
    if (typeof value !== "string" && typeof value !== "number")
        return undefined;
    if (typeof value === "string" && !value.trim()) return undefined;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : undefined;
}
function effortCapability(
    value: unknown,
): IReasoningEffortCapability | undefined {
    if (!Array.isArray(value)) return undefined;
    const values = value.flatMap((option) =>
        isRecord(option) && option.type === "effort"
            ? stringArray(option.values)
            : [],
    );
    const supportedLevels = REASONING_EFFORT_LEVELS.filter((level) =>
        values.includes(level),
    );
    if (!supportedLevels.length) return undefined;
    const defaultLevel: ReasoningEffort = supportedLevels.includes("low")
        ? "low"
        : supportedLevels[0]!;
    return { supportedLevels, defaultLevel };
}
function stringArray(value: unknown): string[] {
    return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : [];
}
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate persisted data before it can replace the bundled or last good catalog. */
export function readCatalogSnapshot(
    value: unknown,
): IModelCatalogSnapshot | undefined {
    return isCatalogSnapshot(value) ? value : undefined;
}

function isCatalogSnapshot(value: unknown): value is IModelCatalogSnapshot {
    if (
        !isRecord(value) ||
        value.version !== 1 ||
        typeof value.source !== "string" ||
        !Object.prototype.hasOwnProperty.call(CATALOG_URLS, value.source) ||
        typeof value.fetchedAt !== "string" ||
        !Number.isFinite(Date.parse(value.fetchedAt)) ||
        !Array.isArray(value.models) ||
        !value.models.length
    )
        return false;
    return value.models.every(isCatalogModel);
}

function validPricing(value: unknown): boolean {
    if (value === undefined) return true;
    return (
        isRecord(value) &&
        typeof value.promptPricePerToken === "number" &&
        typeof value.completionPricePerToken === "number" &&
        finitePrice(value.promptPricePerToken) !== undefined &&
        finitePrice(value.completionPricePerToken) !== undefined &&
        [
            "cacheReadPricePerToken",
            "cacheWritePricePerToken",
            "reasoningPricePerToken",
        ].every(
            (key) =>
                value[key] === undefined ||
                (typeof value[key] === "number" &&
                    finitePrice(value[key]) !== undefined),
        ) &&
        ["promptTiers", "completionTiers"].every(
            (key) =>
                value[key] === undefined ||
                (Array.isArray(value[key]) &&
                    value[key].every(
                        (tier) =>
                            isRecord(tier) &&
                            typeof tier.minTokens === "number" &&
                            finitePrice(tier.minTokens) !== undefined &&
                            typeof tier.pricePerToken === "number" &&
                            finitePrice(tier.pricePerToken) !== undefined &&
                            (tier.maxTokens === undefined ||
                                (typeof tier.maxTokens === "number" &&
                                    finitePrice(tier.maxTokens) !== undefined &&
                                    tier.maxTokens > tier.minTokens)),
                    )),
        )
    );
}

function validEffort(value: unknown): boolean {
    if (value === undefined) return true;
    return (
        isRecord(value) &&
        Array.isArray(value.supportedLevels) &&
        value.supportedLevels.length > 0 &&
        value.supportedLevels.every((level) =>
            REASONING_EFFORT_LEVELS.some((known) => known === level),
        ) &&
        value.supportedLevels.includes(value.defaultLevel)
    );
}

function isCatalogModel(model: unknown): model is ICatalogModel {
    if (!isRecord(model)) return false;
    return (
        typeof model.id === "string" &&
        model.id.length > 0 &&
        model.id.length <= 300 &&
        typeof model.name === "string" &&
        typeof model.family === "string" &&
        ["openai", "openrouter", "gateway"].includes(String(model.transport)) &&
        typeof model.reasoning === "boolean" &&
        typeof model.vision === "boolean" &&
        typeof model.structuredOutput === "boolean" &&
        validPricing(model.pricing) &&
        validEffort(model.reasoningEffort)
    );
}

/** Preserve existing IDs and transport aliases while adding catalog-backed models. */
export function mergeModelCatalogs(
    staticEntries: readonly IModelRegistryEntry[],
    snapshots: readonly IModelCatalogSnapshot[],
): IModelRegistryEntry[] {
    const entries = new Map<string, IModelRegistryEntry>(
        staticEntries.map((entry) => [
            entry.id,
            {
                ...entry,
                transports: { ...entry.transports },
                pricingByTransport: { ...entry.pricingByTransport },
            },
        ]),
    );
    const aliases = new Map<string, string>();
    // The same model can have a different ID on each provider's list
    // (Vercel "zai/glm-5.2", OpenRouter "z-ai/glm-5.2"); this index matches
    // them so one entry carries both providers and both prices.
    const sameModel = new Map<string, Set<string>>();
    const staticById = new Map(staticEntries.map((entry) => [entry.id, entry]));
    function indexEntry(entry: IModelRegistryEntry) {
        for (const alias of [
            entry.id,
            entry.gatewayModelId,
            ...Object.values(entry.transports),
        ]) {
            if (alias) aliases.set(alias, entry.id);
        }
        for (const alias of [
            entry.id,
            entry.transports.gateway,
            entry.transports.openrouter,
        ]) {
            const key = alias ? crossProviderKey(alias) : undefined;
            if (!key) continue;
            const ids = sameModel.get(key) ?? new Set<string>();
            ids.add(entry.id);
            sameModel.set(key, ids);
        }
    }
    function matchingEntryId(model: ICatalogModel): string | undefined {
        const exact = aliases.get(model.id);
        if (exact) return exact;
        if (model.transport === "openai") return undefined;
        const key = crossProviderKey(model.id);
        const ids = key ? sameModel.get(key) : undefined;
        if (!ids || ids.size !== 1) return undefined;
        const [id] = ids;
        // Never fold two models from the same provider's list together.
        return id && !entries.get(id)?.transports[model.transport]
            ? id
            : undefined;
    }
    for (const entry of entries.values()) indexEntry(entry);
    for (const snapshot of snapshots)
        for (const model of snapshot.models) {
            const id =
                matchingEntryId(model) ??
                (model.id.startsWith("openai/") ? model.id.slice(7) : model.id);
            const prior = entries.get(id);
            const fromCatalog = entryFromCatalog(id, model, prior);
            const pinned = staticById.get(id);
            const entry = pinned
                ? withStaticFacts(fromCatalog, pinned)
                : fromCatalog;
            entries.set(id, entry);
            indexEntry(entry);
        }
    return [...entries.values()];
}

/**
 * Vendor names that differ between the Vercel and OpenRouter lists, mapped to
 * one spelling. Only used to match the same model across the two lists.
 */
const VENDOR_ALIASES: Readonly<Record<string, string>> = {
    "z-ai": "zai",
    "x-ai": "xai",
    spacexai: "xai",
    mistralai: "mistral",
    "meta-llama": "meta",
    qwen: "alibaba",
    "bytedance-seed": "bytedance",
};

/** Readable names for model makers, keyed by their one spelling above. */
const VENDOR_NAMES: Readonly<Record<string, string>> = {
    openai: "OpenAI",
    anthropic: "Anthropic",
    google: "Google",
    zai: "Z.ai",
    xai: "xAI",
    mistral: "Mistral",
    meta: "Meta",
    alibaba: "Alibaba (Qwen)",
    deepseek: "DeepSeek",
    moonshotai: "Moonshot AI",
    minimax: "MiniMax",
    bytedance: "ByteDance",
    amazon: "Amazon",
    cohere: "Cohere",
    nvidia: "NVIDIA",
};

/**
 * Who makes a model, named the same way whichever list spelled it:
 * "z-ai/glm-5.2", "zai/glm-5.2" and "~z-ai/glm-latest" are all "Z.ai".
 * Bare IDs such as "gpt-6-luna" belong to `fallbackVendor`.
 */
export function modelVendor(
    modelId: string,
    fallbackVendor = "openai",
): string {
    const slash = modelId.indexOf("/");
    const raw = (slash > 0 ? modelId.slice(0, slash) : fallbackVendor).replace(
        /^~/,
        "",
    );
    const vendor = VENDOR_ALIASES[raw.toLowerCase()] ?? raw.toLowerCase();
    return VENDOR_NAMES[vendor] ?? raw;
}

/**
 * A provider-neutral key for "vendor/model", or undefined for IDs that name a
 * variant rather than a model (OpenRouter's "~" aliases and ":free"/":batch").
 * Dots and dashes count as the same, so "seed-2-1-turbo" matches "seed-2.1-turbo".
 */
export function crossProviderKey(modelId: string): string | undefined {
    if (modelId.startsWith("~") || modelId.includes(":")) return undefined;
    const slash = modelId.indexOf("/");
    if (slash <= 0 || slash !== modelId.lastIndexOf("/")) return undefined;
    const vendor = modelId.slice(0, slash).toLowerCase();
    const name = modelId
        .slice(slash + 1)
        .toLowerCase()
        .replace(/\./g, "-");
    return name ? `${VENDOR_ALIASES[vendor] ?? vendor}/${name}` : undefined;
}

/** Catalog order defines last-wins precedence, so every merge must use the same order. */
const SOURCE_PRECEDENCE: readonly CatalogSource[] = [
    "models.dev",
    "openrouter",
    "gateway",
];

export function orderCatalogSnapshots(
    snapshots: Iterable<IModelCatalogSnapshot>,
): IModelCatalogSnapshot[] {
    return [...snapshots].sort(
        (a, b) =>
            SOURCE_PRECEDENCE.indexOf(a.source) -
            SOURCE_PRECEDENCE.indexOf(b.source),
    );
}

/**
 * Hand-curated registry entries own their capability flags, label and default
 * price; catalogs only add transports and per-transport prices to them.
 */
function withStaticFacts(
    merged: IModelRegistryEntry,
    pinned: IModelRegistryEntry,
): IModelRegistryEntry {
    return {
        ...merged,
        label: pinned.label,
        family: pinned.family,
        provider: pinned.provider,
        providerLabel: pinned.providerLabel,
        reasoning: pinned.reasoning,
        vision: pinned.vision,
        structuredOutput: pinned.structuredOutput,
        judgeSuitable: pinned.judgeSuitable,
        pricing: pinned.pricing ?? merged.pricing,
        reasoningEffort: pinned.reasoningEffort,
    };
}

/**
 * Leaves out "none" for a Claude model that can't turn thinking off, even
 * when a provider's list offers it (the call would be refused).
 */
function withoutRefusedThinkingOff(
    id: string,
    effort: IReasoningEffortCapability | undefined,
): IReasoningEffortCapability | undefined {
    if (!effort || !claudeRejectsThinkingDisabled(id)) return effort;
    const supportedLevels: ReasoningEffort[] = effort.supportedLevels.filter(
        (level) => level !== "none",
    );
    if (!supportedLevels.length) return undefined;
    return {
        supportedLevels,
        defaultLevel: supportedLevels.includes(effort.defaultLevel)
            ? effort.defaultLevel
            : supportedLevels[0]!,
    };
}

function entryFromCatalog(
    id: string,
    model: ICatalogModel,
    prior: IModelRegistryEntry | undefined,
): IModelRegistryEntry {
    // A source without effort or reasoning data must not erase what another source reported.
    const reasoning = model.reasoning || prior?.reasoning === true;
    const reasoningEffort = reasoning
        ? withoutRefusedThinkingOff(
              id,
              model.reasoningEffort ?? prior?.reasoningEffort,
          )
        : undefined;
    const provider =
        model.transport === "openai" ? "openai" : model.id.split("/")[0]!;
    const family = model.family.split(/[-_.]/)[0]!;
    const providerLabel =
        family === "gemma"
            ? "Gemma"
            : ({
                  openai: "OpenAI",
                  google: "Gemini",
                  anthropic: "Claude",
                  "meta-llama": "Llama",
                  meta: "Llama",
                  alibaba: "Qwen",
                  qwen: "Qwen",
                  mistralai: "Mistral",
                  mistral: "Mistral",
                  xai: "Grok",
              }[provider] ?? provider);
    return {
        id,
        gatewayModelId:
            model.transport === "gateway" && !prior?.transports.gateway
                ? model.id
                : (prior?.gatewayModelId ??
                  (model.transport === "openai"
                      ? `openai/${model.id}`
                      : model.id)),
        label: model.name,
        family,
        provider: prior?.provider ?? provider,
        providerLabel,
        reasoning,
        vision: model.vision,
        structuredOutput: model.structuredOutput,
        judgeSuitable: model.structuredOutput,
        supportsOpenAI:
            model.transport === "openai" || prior?.supportsOpenAI === true,
        supportsGateway:
            model.transport === "gateway" || prior?.supportsGateway === true,
        transports: {
            ...prior?.transports,
            [model.transport]: model.id,
        },
        pricingByTransport: {
            ...prior?.pricingByTransport,
            ...(model.pricing ? { [model.transport]: model.pricing } : {}),
        },
        pricing: model.pricing ?? prior?.pricing,
        reasoningEffort,
    };
}

export async function fetchModelCatalog(
    source: CatalogSource,
    fetcher: typeof fetch = fetch,
): Promise<IModelCatalogSnapshot> {
    const response = await fetcher(CATALOG_URLS[source], {
        signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok)
        throw new Error(`Catalog ${source} returned ${response.status}`);
    const content = await response.text();
    if (content.length > 20_000_000)
        throw new Error(`Catalog ${source} exceeds size limit`);
    return parseModelCatalog(source, JSON.parse(content));
}
