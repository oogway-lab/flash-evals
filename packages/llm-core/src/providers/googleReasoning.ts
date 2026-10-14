import { registryEntryFor } from "../models/registry.js";
import type { ReasoningEffort } from "../types.js";

/** Keep routine Google requests from inheriting the provider's higher thinking default. */
export function googleDefaultReasoningEffort(
    modelId: string,
): ReasoningEffort | undefined {
    // OpenRouter currently requires thinking on these routes. Lite accepts
    // minimal; 3.8 Flash accepts low. Neither accepts none (catalog, 2026-10-15).
    if (modelId === "google/gemini-3.5-flash-lite") return "minimal";
    const model = registryEntryFor(modelId);
    if (model?.provider !== "google") return undefined;
    const levels = model.reasoningEffort?.supportedLevels;
    return (["none", "minimal", "low"] as const).find((level) =>
        levels?.includes(level),
    );
}
