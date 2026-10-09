import {
    getEvalProvider,
    getBareModelName,
    computeCostFromUsageWithPricing,
    type ApiKeys,
    type CompletionRequest,
    type CostSource,
    type ProviderMetadata,
    type EvalProviderTransport,
    type UsageData,
} from "@mosaic/llm-core";
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
): Promise<ExecutedCell> {
    const provider = getEvalProvider(
        apiKeys,
        transport
            ? {
                  transport,
                  ...(transport === "gateway"
                      ? { exactTransportModelId: modelId }
                      : {}),
              }
            : {},
    );

    const completionRequest: CompletionRequest = {
        ...request,
        model: getBareModelName(modelId),
    };
    const result = await provider.complete(completionRequest);

    const { costUsd, costSource } = resolveCost(result.usage, pricing);

    return {
        outputText: result.text,
        parsed: result.parsed,
        schemaViolation: result.schemaViolation ?? false,
        usage: result.usage,
        latencyMs: result.latencyMs,
        costUsd,
        costSource,
        providerMetadata: result.providerMetadata,
    };
}

function resolveCost(
    usage: UsageData,
    pricing: ModelPricing | undefined,
): { costUsd?: number; costSource: CostSource } {
    if (pricing) {
        const computed = computeCostFromUsageWithPricing(usage, pricing);
        if (computed !== undefined) {
            return { costUsd: computed, costSource: "computed" };
        }
    }
    return { costSource: "unavailable" };
}
