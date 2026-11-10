import {
    listAvailableModelMetadata,
    MODEL_REGISTRY,
    registryEntriesForProvider,
    registryEntryFor,
    registryModelFor,
    type ApiKeys,
    type EvalProviderMode,
    type IModelRegistryEntry,
} from "@flash-evals/llm-core";
import type {
    IRunSetupModelOption,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { TRANSPORT_LABELS_FOR_MESSAGES } from "./transportLabels.js";
import {
    bifrostIdsByRegistryModel,
    bifrostModelList,
    withListedBifrostId,
    type IBifrostModelListDeps,
} from "./bifrostModelList.js";
import {
    preferredOffer,
    providerOffers,
    savedKeyProviders,
} from "./routes/modelProviders.js";

export {
    MODEL_REGISTRY,
    registryEntryFor,
    registryModelFor,
    type IModelRegistryEntry,
};

export interface IModelOptionsResult {
    models: IRunSetupModelOption[];
    degraded: boolean;
    /** Bifrost is configured but its model list couldn't be fetched. */
    bifrostModelListError?: string;
}

export interface IAvailableModelOptionsDeps {
    /** Runs before a transport's live listing; a throw marks it degraded. */
    beforeListing?: (transport: EnabledTransport) => Promise<void>;
    /** The team's preferred provider; the run form starts from it. */
    preferredProvider?: ProviderTransport;
    /** Lists Bifrost's models (tests fake it); see bifrostModelList. */
    bifrostList?: IBifrostModelListDeps;
}

export async function availableModelOptions(
    apiKeys: ApiKeys,
    deps: IAvailableModelOptionsDeps = {},
): Promise<IModelOptionsResult> {
    const transports = enabledTransports(apiKeys);
    const results = await Promise.all(
        transports.map(async (transport) => {
            try {
                await deps.beforeListing?.(transport);
                if (transport === "bifrost") {
                    // Fetched once and cached: Bifrost's own model ids.
                    const listed = await bifrostModelList(
                        apiKeys,
                        deps.bifrostList,
                    );
                    if (!listed || "error" in listed)
                        return {
                            transport,
                            models: undefined,
                            ...(listed ? { error: listed.error } : {}),
                        };
                    // Bifrost's list price for an id comes before the
                    // registry's (see providerOffers' livePricing).
                    return {
                        transport,
                        models: listed.ids.map((id) => {
                            const pricing = listed.pricing?.[id];
                            return pricing ? { id, pricing } : { id };
                        }),
                    };
                }
                return {
                    transport,
                    models: await listAvailableModelMetadata(apiKeys, {
                        provider: transport,
                    }),
                };
            } catch {
                return { transport, models: undefined };
            }
        }),
    );
    // Bifrost offers each model under the id Bifrost lists for it, and
    // doesn't offer models it doesn't list (or any, when the list failed).
    const bifrostResult = results.find(
        (result) => result.transport === "bifrost",
    );
    const bifrostListed = bifrostResult
        ? bifrostIdsByRegistryModel(
              bifrostResult.models?.map((model) => model.id) ?? [],
          )
        : undefined;
    const asOffered = (entry: IModelRegistryEntry) =>
        bifrostResult ? withListedBifrostId(entry, bifrostListed) : entry;
    const entries = new Map<string, IModelRegistryEntry>();
    for (const result of results) {
        const candidates =
            result.transport === "gateway"
                ? registryEntriesForProvider("gateway", result.models)
                : MODEL_REGISTRY;
        for (const candidate of candidates) {
            const entry = asOffered(candidate);
            if (entry.transports[result.transport])
                entries.set(entry.id, entry);
        }
    }
    // Models only Vercel or OpenRouter carry are listed even without that
    // provider's key, so their prices show and the form can say which key
    // is missing instead of hiding them.
    for (const entry of MODEL_REGISTRY) {
        if (
            !entries.has(entry.id) &&
            (entry.transports.gateway || entry.transports.openrouter)
        )
            entries.set(entry.id, asOffered(entry));
    }
    const bifrostError =
        bifrostResult && "error" in bifrostResult
            ? bifrostResult.error
            : undefined;
    const saved = savedKeyProviders(apiKeys);
    return {
        degraded: results.some((result) => !result.models),
        ...(bifrostError ? { bifrostModelListError: bifrostError } : {}),
        models: [...entries.values()]
            .map((entry) =>
                optionForEntry(entry, results, saved, deps.preferredProvider),
            )
            .sort(orderAvailableFirst),
    };
}

type EnabledTransport = ProviderTransport;

function enabledTransports(apiKeys: ApiKeys): EnabledTransport[] {
    return [
        ...(apiKeys.openai ? (["openai"] as const) : []),
        ...(apiKeys.gateway ? (["gateway"] as const) : []),
        ...(apiKeys.openrouter ? (["openrouter"] as const) : []),
        // Listed from the registry: no request goes to the maker.
        ...(apiKeys.anthropic ? (["anthropic"] as const) : []),
        ...(apiKeys.google ? (["google"] as const) : []),
        ...(apiKeys.bifrost && apiKeys.bifrostBaseUrl
            ? (["bifrost"] as const)
            : []),
    ];
}

export function providerModeForAvailability(
    provider: EvalProviderMode,
): "openai" | "gateway" {
    return provider === "gateway" ? "gateway" : "openai";
}

export function modelAllowedForProvider(
    entry: IModelRegistryEntry,
    provider: EvalProviderMode,
): boolean {
    const availabilityProvider = providerModeForAvailability(provider);
    return availabilityProvider === "gateway"
        ? entry.supportsGateway
        : entry.supportsOpenAI;
}

function optionForEntry(
    entry: IModelRegistryEntry,
    results: Array<{
        transport: EnabledTransport;
        models:
            Awaited<ReturnType<typeof listAvailableModelMetadata>> | undefined;
    }>,
    saved: readonly ProviderTransport[],
    preferred: ProviderTransport | undefined,
): IRunSetupModelOption {
    const supportedResults = results.filter(
        ({ transport }) => entry.transports[transport],
    );
    const livePricing = Object.fromEntries(
        supportedResults.flatMap(({ transport, models }) => {
            const pricing = models?.find(
                (model) => model.id === entry.transports[transport],
            )?.pricing;
            return pricing ? [[transport, pricing]] : [];
        }),
    );
    const providers = providerOffers(entry, saved, livePricing);
    const first = preferredOffer(providers, preferred);
    const transports = supportedResults
        .map(({ transport }) => transport)
        .sort((a, b) => Number(b === first) - Number(a === first));
    const noKeyReason =
        supportedResults.length === 0
            ? `No key for ${providers
                  .map(
                      (offer) => TRANSPORT_LABELS_FOR_MESSAGES[offer.transport],
                  )
                  .join(" or ")}.`
            : undefined;
    const providerListed = supportedResults.some(({ transport, models }) =>
        models?.some((model) => model.id === entry.transports[transport]),
    );
    const available =
        supportedResults.length > 0 &&
        supportedResults.some(({ transport, models }) =>
            models
                ? models.some(
                      (model) => model.id === entry.transports[transport],
                  )
                : true,
        );
    const costAvailable =
        Boolean(entry.pricing) ||
        supportedResults.some(({ transport, models }) =>
            models?.some(
                (model) =>
                    model.id === entry.transports[transport] && model.pricing,
            ),
        );
    return {
        id: entry.id,
        label: entry.label,
        family: entry.family,
        provider: entry.provider,
        providerLabel: entry.providerLabel,
        reasoning: entry.reasoning,
        vision: entry.vision,
        structuredOutput: entry.structuredOutput,
        judgeSuitable: entry.judgeSuitable,
        costAvailable,
        available,
        ...(providerListed ? { providerListed: true } : {}),
        transports,
        providers,
        ...(noKeyReason
            ? {
                  unavailableReason: noKeyReason,
                  disabledReason: noKeyReason,
              }
            : available
              ? {}
              : {
                    unavailableReason: "Not enabled for your API key",
                    disabledReason: "Not enabled for your API key",
                }),
        ...(entry.reasoningEffort
            ? { reasoningEffort: entry.reasoningEffort }
            : {}),
    };
}

function orderAvailableFirst(
    a: IRunSetupModelOption,
    b: IRunSetupModelOption,
): number {
    if (a.available !== b.available) return a.available ? -1 : 1;
    if (a.providerLabel !== b.providerLabel) {
        return a.providerLabel.localeCompare(b.providerLabel);
    }
    if (a.family !== b.family) return a.family.localeCompare(b.family);
    return a.label.localeCompare(b.label);
}
