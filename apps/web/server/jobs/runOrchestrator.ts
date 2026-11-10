import {
    getBareModelName,
    transportModelIdFor,
    completionCostFields,
    type ApiKeys,
    type CompletionRequest,
    type CompletionResult,
    type CostBasis,
    type CostSource,
    type ProviderMetadata,
    type EvalProviderTransport,
    type UsageData,
} from "@flash-evals/llm-core";
import { getLimitedEvalProvider } from "../llm/providerConcurrency";
import type { ModelPricing } from "../llm/pricing";

export interface ExecutedCell {
    outputText: string;
    parsed?: unknown;
    schemaViolation: boolean;
    usage: UsageData;
    latencyMs: number;
    costUsd?: number;
    costSource: CostSource;
    providerMetadata?: ProviderMetadata;
}

export async function executeCell(
    modelId: string,
    request: Omit<CompletionRequest, "model">,
    apiKeys: ApiKeys,
    pricing: ModelPricing | undefined,
    transport?: EvalProviderTransport,
    /** The provider's own id, e.g. a Bifrost id from Bifrost's list. */
    transportModelId?: string,
): Promise<ExecutedCell> {
    const provider = getLimitedEvalProvider(
        apiKeys,
        transport
            ? {
                  transport,
                  ...(transportModelId
                      ? { exactTransportModelId: transportModelId }
                      : {}),
                  // Send the gateway's own id for the model when the
                  // registry knows it ("z-ai/glm-5.2" is "zai/glm-5.2" on
                  // Vercel). A model only on the gateway's live list goes
                  // under its own id.
                  ...(transport === "gateway" && !transportModelId
                      ? {
                            exactTransportModelId:
                                transportModelIdFor(modelId, "gateway") ??
                                modelId,
                        }
                      : {}),
              }
            : {},
    );

    const completionRequest: CompletionRequest = {
        ...request,
        model: getBareModelName(modelId),
    };
    const result = await provider.complete(completionRequest);

    const { costUsd, costSource, costBasis } = completionCostFields(
        result,
        pricing,
    );

    return {
        outputText: result.text,
        parsed: result.parsed,
        schemaViolation: result.schemaViolation ?? false,
        usage: result.usage,
        latencyMs: result.latencyMs,
        costUsd,
        costSource,
        providerMetadata: cellProviderMetadata(result, costBasis),
    };
}

/**
 * What an eval cell keeps about its call: whether a requested thinking level
 * was sent (and why not), the thinking tokens reported, so the run page can
 * say both; and where the cost came from (reported, Bifrost's list, the
 * registry's list).
 */
export function cellProviderMetadata(
    result: Pick<CompletionResult, "providerMetadata" | "thinking" | "usage">,
    costBasis: CostBasis | undefined,
): ProviderMetadata | undefined {
    const reasoningTokens = result.usage.reasoningTokens;
    if (
        !result.providerMetadata &&
        !result.thinking &&
        !costBasis &&
        reasoningTokens === undefined
    )
        return undefined;
    return {
        ...result.providerMetadata,
        ...(result.thinking ? { thinking: result.thinking } : {}),
        ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
        ...(costBasis ? { costBasis } : {}),
    };
}
