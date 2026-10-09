import {
    listAvailableModelMetadata,
    MODEL_REGISTRY,
    registryEntriesForProvider,
    registryEntryFor,
    type ApiKeys,
    type EvalProviderMode,
    type IModelRegistryEntry,
} from "@mosaic/llm-core";
import type { IRunSetupModelOption } from "@mosaic/api-contract";

export { MODEL_REGISTRY, registryEntryFor, type IModelRegistryEntry };

export interface IModelOptionsResult {
    models: IRunSetupModelOption[];
    degraded: boolean;
}

export interface IAvailableModelOptionsDeps {
    /** Runs before a transport's live listing; a throw marks it degraded. */
    beforeListing?: (transport: EnabledTransport) => Promise<void>;
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
    const entries = new Map<string, IModelRegistryEntry>();
    for (const result of results) {
        const candidates =
            result.transport === "gateway"
                ? registryEntriesForProvider("gateway", result.models)
                : MODEL_REGISTRY;
        for (const entry of candidates) {
            if (entry.transports[result.transport])
                entries.set(entry.id, entry);
        }
    }
    return {
        degraded: results.some((result) => !result.models),
        models: [...entries.values()]
            .map((entry) => optionForEntry(entry, results))
            .sort(orderAvailableFirst),
    };
}

type EnabledTransport = "openai" | "gateway" | "openrouter" | "bifrost";

function enabledTransports(apiKeys: ApiKeys): EnabledTransport[] {
    return [
        ...(apiKeys.openai ? (["openai"] as const) : []),
        ...(apiKeys.gateway ? (["gateway"] as const) : []),
        ...(apiKeys.openrouter ? (["openrouter"] as const) : []),
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
): IRunSetupModelOption {
    const supportedResults = results.filter(
        ({ transport }) => entry.transports[transport],
    );
    const providerListed = supportedResults.some(({ transport, models }) =>
        models?.some((model) => model.id === entry.transports[transport]),
    );
    const available = supportedResults.some(({ transport, models }) =>
        models
            ? models.some((model) => model.id === entry.transports[transport])
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
        transports: supportedResults.map(({ transport }) => transport),
        ...(available
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
