import { createGateway } from "@ai-sdk/gateway";
import { gatewayAttributionHeaders } from "./attribution.js";
import {
    generateText,
    jsonSchema,
    NoObjectGeneratedError,
    Output,
    type ImagePart,
    type LanguageModel,
    type LanguageModelUsage,
    type ModelMessage,
    type TextPart,
    type UserModelMessage,
} from "ai";
import {
    hasDataPolicy,
    type CompletionRequest,
    type CompletionResult,
    type EvalImage,
    type ICompletionActualRoute,
    type IEvalCompletionProvider,
    type ProviderMetadata,
    type UsageData,
} from "../types.js";
import type { JSONValue } from "ai";
import { gatewayModelIdFor } from "../models/registry.js";
import { parseStructuredOutput } from "./structuredOutput.js";
import {
    rejectsSamplingSettings,
    thinkingPlanFor,
    type IThinkingPlan,
} from "./thinking.js";

type GenerateTextFn = (input: Parameters<typeof generateText>[0]) => Promise<{
    text: string;
    output: unknown;
    usage: LanguageModelUsage;
    providerMetadata?: Record<string, unknown>;
}>;

type CreateGatewayProviderFn = (
    options: Parameters<typeof createGateway>[0],
) => (model: string) => LanguageModel;

export interface IGatewayEvalProviderDeps {
    fallbackModels?: string[];
    createGatewayProvider?: CreateGatewayProviderFn;
    generateText?: GenerateTextFn;
    modelFor?: (model: string) => LanguageModel;
}

export class GatewayEvalProvider implements IEvalCompletionProvider {
    private generate: GenerateTextFn;
    private modelFor: (model: string) => LanguageModel;

    constructor(apiKey: string, deps: IGatewayEvalProviderDeps = {}) {
        if (deps.fallbackModels && deps.fallbackModels.length > 0) {
            throw new Error(
                "Gateway fallback models are not supported for eval runs until Flash Evals records the actual served model.",
            );
        }
        this.generate = deps.generateText ?? generateText;
        const createGatewayProvider =
            deps.createGatewayProvider ??
            (createGateway as CreateGatewayProviderFn);
        this.modelFor =
            deps.modelFor ??
            createGatewayProvider({
                apiKey,
                headers: gatewayAttributionHeaders(),
            });
    }

    async complete(req: CompletionRequest): Promise<CompletionResult> {
        const start = performance.now();
        const modelId =
            gatewayModelIdFor(req.model) ??
            (req.model.includes("/") ? req.model : `openai/${req.model}`);
        const thinking = thinkingPlanFor(
            modelId,
            "gateway",
            req.reasoningEffort,
        );
        try {
            const result = await this.generate({
                model: this.modelFor(modelId),
                instructions: req.system,
                messages: messagesFor(req),
                ...callSettings(req, modelId, thinking),
                output: outputFor(req),
            });
            const latencyMs = performance.now() - start;
            const structuredOutput = req.responseSchema
                ? (result.output as unknown)
                : undefined;
            const text =
                structuredOutput === undefined
                    ? result.text
                    : JSON.stringify(structuredOutput);
            const parsedResult =
                structuredOutput === undefined
                    ? parseStructuredOutput(text, req.responseSchema)
                    : { parsed: structuredOutput, schemaViolation: false };

            const metadata = providerMetadataFrom(result.providerMetadata);
            return {
                text,
                parsed: parsedResult.parsed,
                schemaViolation: parsedResult.schemaViolation,
                usage: usageFrom(result.usage),
                latencyMs,
                providerMetadata: metadata,
                actualRoute: actualRouteFor(modelId, metadata),
                ...(thinking ? { thinking: thinking.outcome } : {}),
                cache:
                    (result.usage.inputTokenDetails?.cacheReadTokens ?? 0) > 0
                        ? {
                              status: "provider_cache",
                              kind: "prompt",
                              hit: true,
                          }
                        : { status: "miss" },
            };
        } catch (err) {
            if (NoObjectGeneratedError.isInstance(err)) {
                return {
                    text: err.text ?? "",
                    parsed: undefined,
                    schemaViolation: true,
                    usage: err.usage ? usageFrom(err.usage) : {},
                    latencyMs: performance.now() - start,
                    ...(thinking ? { thinking: thinking.outcome } : {}),
                };
            }
            throw withCause(
                new Error(
                    `Vercel AI Gateway request failed for ${req.model}: ${aiSdkErrorMessage(err)}`,
                ),
                err,
            );
        }
    }
}

/** Resolved when Vercel said which host served the call. */
function actualRouteFor(
    modelId: string,
    metadata: ProviderMetadata | undefined,
): ICompletionActualRoute {
    const generationId = metadata?.gateway?.generationId;
    const id = generationId ? { generationId } : {};
    if (metadata?.servedBy)
        return {
            status: "resolved",
            transport: "gateway",
            modelId,
            upstreamProvider: metadata.servedBy,
            ...id,
            evidenceCompleteness: "complete",
        };
    return {
        status: "unresolved",
        transport: "gateway",
        modelId,
        ...id,
        evidenceCompleteness: generationId ? "partial" : "absent",
    };
}

/** Structured output: the request's schema, any JSON object, or none. */
function outputFor(req: CompletionRequest) {
    if (req.responseSchema)
        return Output.object({
            name: req.responseSchema.name,
            schema: jsonSchema<unknown>(
                req.responseSchema.schema as Parameters<typeof jsonSchema>[0],
            ),
        });
    return req.jsonMode ? Output.json() : undefined;
}

function messagesFor(req: CompletionRequest): ModelMessage[] {
    return [{ role: "user", content: userContentFor(req) }];
}

function userContentFor(
    req: CompletionRequest,
): Exclude<UserModelMessage["content"], string> {
    const parts: Array<TextPart | ImagePart> = [
        { type: "text", text: req.prompt },
    ];

    for (const img of req.images ?? []) {
        parts.push(imagePartFor(img));
    }
    return parts;
}

function imagePartFor(img: EvalImage) {
    return {
        type: "image" as const,
        image: `data:${img.mimeType};base64,${img.base64Data}`,
        mediaType: img.mimeType,
    };
}

/** Limits, sampling, retries, thinking and routing options for one call. */
function callSettings(
    req: CompletionRequest,
    modelId: string,
    thinking: IThinkingPlan | undefined,
) {
    const noSampling = rejectsSamplingSettings(modelId);
    return {
        maxOutputTokens: req.maxTokens,
        temperature: noSampling ? undefined : req.temperature,
        topP: noSampling ? undefined : req.topP,
        seed: req.seed,
        abortSignal: req.signal,
        maxRetries: req.maxRetries ?? 2,
        timeout: req.timeoutMs ?? 120_000,
        ...(thinking?.reasoning ? { reasoning: thinking.reasoning } : {}),
        providerOptions: providerOptionsFor(req, thinking?.providerOptions),
    };
}

/** The maker's thinking options (keyed by maker) and Vercel's data rules. */
function providerOptionsFor(
    req: CompletionRequest,
    thinkingOptions: Record<string, Record<string, JSONValue>> | undefined,
) {
    const gatewayOptions = gatewayDataOptions(req.dataPolicy);
    if (!thinkingOptions && !gatewayOptions) return undefined;
    return {
        ...thinkingOptions,
        ...(gatewayOptions ? { gateway: gatewayOptions } : {}),
    };
}

/** Vercel's routing options for a data policy, or undefined when it sets none. */
export function gatewayDataOptions(
    policy: CompletionRequest["dataPolicy"],
): Record<string, JSONValue> | undefined {
    if (!hasDataPolicy(policy)) return undefined;
    return {
        ...(policy?.onlyHosts?.length ? { only: policy.onlyHosts } : {}),
        ...(policy?.zeroDataRetention ? { zeroDataRetention: true } : {}),
        ...(policy?.disallowPromptTraining
            ? { disallowPromptTraining: true }
            : {}),
    };
}

function usageFrom(usage: LanguageModelUsage): UsageData {
    return {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens,
        cacheReadTokens: usage.inputTokenDetails.cacheReadTokens,
        cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens,
        totalTokens: usage.totalTokens,
    };
}

export function providerMetadataFrom(
    metadata: Record<string, unknown> | undefined,
): ProviderMetadata | undefined {
    const gateway = metadata?.gateway;
    if (!isRecord(gateway)) return undefined;
    const generationId =
        typeof gateway.generationId === "string" &&
        gateway.generationId.length > 0
            ? gateway.generationId
            : undefined;
    // Which hosting company Vercel routed the call to.
    const routing = isRecord(gateway.routing) ? gateway.routing : undefined;
    const served = routing?.finalProvider ?? routing?.resolvedProvider;
    const servedBy =
        typeof served === "string" && served.length > 0 && served.length <= 100
            ? served
            : undefined;
    if (!generationId && !servedBy) return undefined;
    return {
        ...(generationId ? { gateway: { generationId } } : {}),
        ...(servedBy ? { servedBy } : {}),
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function aiSdkErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    return err.message.trim() || err.name || "Unknown provider error";
}

function withCause(error: Error, cause: unknown): Error {
    return Object.assign(error, { cause });
}
