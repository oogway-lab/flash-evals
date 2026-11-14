import type {
    IThinkingOutcome,
    ProviderMetadata,
    ReasoningEffort,
} from "@flash-evals/llm-core";
import { registryModelFor } from "../llm/modelRegistry";

/**
 * A run model's stored thinking level that the worker can't send (the
 * registry model behind its id lists no such level): recorded on the cell so
 * the run page says so instead of showing nothing.
 */
export function unsentThinkingOutcome(
    modelId: string,
    requested: ReasoningEffort | undefined,
    sent: ReasoningEffort | undefined,
): IThinkingOutcome | undefined {
    if (!requested || sent) return undefined;
    const levels = registryModelFor(modelId)?.reasoningEffort?.supportedLevels;
    return {
        requested,
        sent: false,
        reason: levels
            ? `${modelId} takes thinking levels ${levels.join(", ")}, not "${requested}", so no thinking setting was sent.`
            : `The model registry lists no thinking levels for ${modelId}, so no thinking setting was sent.`,
    };
}

/** The cell's provider metadata with `outcome` when the call itself recorded none. */
export function withThinkingOutcome(
    metadata: ProviderMetadata | undefined,
    outcome: IThinkingOutcome | undefined,
): ProviderMetadata | undefined {
    if (!outcome || metadata?.thinking) return metadata;
    return { ...metadata, thinking: outcome };
}
