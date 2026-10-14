import type {
    IModelPricing,
    IModelRegistryEntry,
    EvalProviderTransport,
    IReasoningEffortCapability,
} from "./registry.js";
import { REASONING_EFFORT_LEVELS, type ReasoningEffort } from "../types.js";

export const CATALOG_URLS = {
    "models.dev": "https://models.dev/api.json",
    openrouter: "https://openrouter.ai/api/v1/models",
    gateway: "https://ai-gateway.vercel.sh/v1/models",
} as const;
export type CatalogSource = keyof typeof CATALOG_URLS;
export type CatalogTransport = Exclude<EvalProviderTransport, "bifrost">;

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
    return {
        promptPricePerToken: input / divisor,
        completionPricePerToken: output / divisor,
    };
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
        finitePrice(value.completionPricePerToken) !== undefined
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
    const staticById = new Map(staticEntries.map((entry) => [entry.id, entry]));
    function indexEntry(entry: IModelRegistryEntry) {
        for (const alias of [
            entry.id,
            entry.gatewayModelId,
            ...Object.values(entry.transports),
        ]) {
            if (alias) aliases.set(alias, entry.id);
        }
    }
    for (const entry of entries.values()) indexEntry(entry);
    for (const snapshot of snapshots)
        for (const model of snapshot.models) {
            const id =
                aliases.get(model.id) ??
                (model.id.startsWith("openai/") ? model.id.slice(7) : model.id);
            const prior = entries.get(id);
            const preservedEffort = staticById.get(id)?.reasoningEffort;
            const entry = entryFromCatalog(id, model, prior, preservedEffort);
            entries.set(id, entry);
            indexEntry(entry);
        }
    return [...entries.values()];
}

function catalogEffort(
    model: ICatalogModel,
    prior: IModelRegistryEntry | undefined,
    preserved: IReasoningEffortCapability | undefined,
): IReasoningEffortCapability | undefined {
    if (!model.reasoning) return undefined;
    return preserved ?? model.reasoningEffort ?? prior?.reasoningEffort;
}

function entryFromCatalog(
    id: string,
    model: ICatalogModel,
    prior: IModelRegistryEntry | undefined,
    preservedEffort: IReasoningEffortCapability | undefined,
): IModelRegistryEntry {
    const reasoningEffort = catalogEffort(model, prior, preservedEffort);
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
            prior?.gatewayModelId ??
            (model.transport === "openai" ? `openai/${model.id}` : model.id),
        label: model.name,
        family,
        provider: prior?.provider ?? provider,
        providerLabel,
        reasoning: model.reasoning,
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
