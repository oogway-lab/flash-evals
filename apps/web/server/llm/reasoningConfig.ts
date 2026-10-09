import type { ReasoningEffort } from "@mosaic/llm-core";
import { registryEntryFor } from "./modelRegistry";

export function resolveReasoningEffort(
    modelId: string,
    requested?: ReasoningEffort,
): ReasoningEffort | undefined {
    const capability = registryEntryFor(modelId)?.reasoningEffort;
    if (!capability) return undefined;
    if (requested === undefined) return capability.defaultLevel;
    return capability.supportedLevels.includes(requested) ? requested : undefined;
}
