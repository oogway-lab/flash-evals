import {
    isProviderTransport,
    type ProviderTransport,
} from "@flash-evals/api-contract";
import { ensureModelCatalog } from "@/server/llm/catalog";
import { registryModelFor } from "@/server/llm/modelRegistry";

/** What the results page shows about a model besides its raw ID. */
export interface IModelInfo {
    /** Readable name from the model registry, e.g. "GPT-4.1 mini". */
    label: string;
    /** The provider the run sent this model through, when the run recorded it. */
    provider?: ProviderTransport;
    /** That provider's list price per million input tokens, in USD. */
    inputPerMillion?: number;
    /** That provider's list price per million output tokens, in USD. */
    outputPerMillion?: number;
}

const PER_MILLION = 1_000_000;

/**
 * Readable names and list prices for a run's models, from the model
 * registry and the stored price lists. A model the run sent through a named
 * provider gets that provider's price, since Vercel and OpenRouter can list
 * the same model at different prices. Unknown models are left out, so the
 * page falls back to the raw ID.
 */
export async function modelInfoFor(
    modelIds: readonly string[],
    providers: Readonly<Record<string, ProviderTransport>> = {},
): Promise<Record<string, IModelInfo>> {
    await ensureModelCatalog();
    const info: Record<string, IModelInfo> = {};
    for (const modelId of new Set(modelIds)) {
        const entry = registryModelFor(modelId);
        if (!entry) continue;
        const provider = providers[modelId];
        const pricing = provider
            ? (entry.pricingByTransport?.[provider] ??
              (provider === "openai" ? entry.pricing : undefined))
            : entry.pricing;
        info[modelId] = {
            label: entry.label,
            ...(provider ? { provider } : {}),
            ...(pricing
                ? {
                      inputPerMillion:
                          pricing.promptPricePerToken * PER_MILLION,
                      outputPerMillion:
                          pricing.completionPricePerToken * PER_MILLION,
                  }
                : {}),
        };
    }
    return info;
}

/** Each model's provider as the run recorded it in its saved settings. */
export function runModelProviders(
    snapshot: Readonly<Record<string, unknown>>,
): Record<string, ProviderTransport> {
    const models = Array.isArray(snapshot.models) ? snapshot.models : [];
    return Object.fromEntries(
        models.flatMap((model: unknown) => {
            if (typeof model !== "object" || model === null) return [];
            const { modelId, transport } = model as Record<string, unknown>;
            return typeof modelId === "string" && isProviderTransport(transport)
                ? [[modelId, transport]]
                : [];
        }),
    );
}
