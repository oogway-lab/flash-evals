import type { ReasoningEffort } from "@flash-evals/llm-core";
import { registryModelFor } from "./modelRegistry";

export function resolveReasoningEffort(
    modelId: string,
    requested?: ReasoningEffort,
): ReasoningEffort | undefined {
    const capability = registryModelFor(modelId)?.reasoningEffort;
    if (!capability) return undefined;
    if (requested === undefined) return capability.defaultLevel;
    return capability.supportedLevels.includes(requested)
        ? requested
        : undefined;
}
