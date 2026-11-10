import type { ProviderTransport } from "@flash-evals/api-contract";
import type { RunModelSpec } from "../db/jsonTypes";

/**
 * Each run model's provider and, when it isn't the registry's, the id sent
 * to it (a Bifrost id from Bifrost's list), from the run's snapshot.
 */
export function runModelRoutes(models: readonly RunModelSpec[] | undefined): {
    transport: Map<string, ProviderTransport>;
    transportModelId: Map<string, string>;
} {
    const transport = new Map<string, ProviderTransport>();
    const transportModelId = new Map<string, string>();
    for (const model of models ?? []) {
        if (model.transport) transport.set(model.modelId, model.transport);
        if (model.transportModelId)
            transportModelId.set(model.modelId, model.transportModelId);
    }
    return { transport, transportModelId };
}
