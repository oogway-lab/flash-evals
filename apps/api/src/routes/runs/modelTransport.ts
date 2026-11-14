import type { ProviderTransport } from "@flash-evals/api-contract";
import { ApiBadRequestError } from "../../errors.js";
import { registryEntryFor } from "../../modelRegistry.js";
import { TRANSPORT_LABELS_FOR_MESSAGES } from "../../transportLabels.js";

/**
 * Checks that the app knows the id `transport` calls `modelId` by, so a run
 * fails here with a clear message instead of on every call. The same model
 * often has a different id per provider (Vercel "zai/glm-5.2", OpenRouter
 * "z-ai/glm-5.2"); the model registry carries both, and calls are sent with
 * the transport's own id.
 *
 * `allowUnlistedGateway` is for run models: a model the registry does not
 * know at all may still be on Vercel AI Gateway's live list, and the run
 * sends it there under its own provider-qualified id. Judges are always
 * mapped through the registry, so they never use it.
 *
 * `transportModelId` is the Bifrost id picked from Bifrost's own list for a
 * registry model (the registry may not carry it); the caller checks it is
 * that model's (`assertBifrostIdIsModel`).
 */
export function assertModelMapsToTransport(
    modelId: string,
    transport: ProviderTransport,
    options: {
        allowUnlistedGateway?: boolean;
        prefix?: string;
        transportModelId?: string;
    } = {},
): void {
    const entry = registryEntryFor(modelId);
    if (entry?.transports[transport]) return;
    if (transport === "bifrost" && options.transportModelId) return;
    // A Bifrost id from Bifrost's own model list (provider-qualified, such
    // as openrouter/google/gemini-2.5-flash) is sent as it is.
    if (
        transport === "bifrost" &&
        modelId.includes("/") &&
        !(entry && (entry.id === modelId || entry.gatewayModelId === modelId))
    )
        return;
    if (
        !entry &&
        options.allowUnlistedGateway &&
        transport === "gateway" &&
        modelId.includes("/")
    )
        return;
    const label = TRANSPORT_LABELS_FOR_MESSAGES[transport];
    const others = entry
        ? (Object.keys(entry.transports) as ProviderTransport[])
              .filter((other) => other in TRANSPORT_LABELS_FOR_MESSAGES)
              .map((other) => TRANSPORT_LABELS_FOR_MESSAGES[other])
        : [];
    const hint =
        others.length > 0
            ? ` It is available through ${others.join(" or ")}.`
            : " Choose a model from that provider's list, or another provider.";
    throw new ApiBadRequestError(
        `${options.prefix ?? ""}Model "${modelId}" can't be sent through ${label}: the app doesn't know its ${label} model id.${hint}`,
    );
}
