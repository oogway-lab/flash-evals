import { createGateway } from "@ai-sdk/gateway";
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
import type {
    CompletionRequest,
    CompletionResult,
    EvalImage,
    IEvalCompletionProvider,
    ProviderMetadata,
    UsageData,
} from "../types.js";
import { gatewayModelIdFor } from "../models/registry.js";
import { parseStructuredOutput } from "./structuredOutput.js";

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
        try {
            const result = await this.generate({
                model: this.modelFor(modelId),
                instructions: req.system,
                messages: messagesFor(req),
                maxOutputTokens: req.maxTokens,
                temperature: isReasoningModel(req.model)
                    ? undefined
                    : req.temperature,
                topP: isReasoningModel(req.model) ? undefined : req.topP,
                seed: req.seed,
                abortSignal: req.signal,
                maxRetries: req.maxRetries ?? 2,
                timeout: req.timeoutMs ?? 120_000,
                providerOptions: providerOptionsFor(req),
                output: req.responseSchema
                    ? Output.object({
                          name: req.responseSchema.name,
                          schema: jsonSchema<unknown>(
                              req.responseSchema.schema as Parameters<
                                  typeof jsonSchema
                              >[0],
                          ),
                      })
                    : undefined,
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
                actualRoute: {
                    status: "unresolved",
                    transport: "gateway",
                    modelId,
                    ...(metadata?.gateway?.generationId
                        ? { generationId: metadata.gateway.generationId }
                        : {}),
                    evidenceCompleteness: metadata?.gateway?.generationId
                        ? "partial"
                        : "absent",
                },
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

function providerOptionsFor(req: CompletionRequest) {
    const openAIOptions =
        isReasoningModel(req.model) && req.reasoningEffort
            ? { reasoningEffort: req.reasoningEffort }
            : undefined;

    if (!openAIOptions) return undefined;
    return {
        ...(openAIOptions ? { openai: openAIOptions } : {}),
    };
}

function isReasoningModel(model: string): boolean {
    const parts = model.split("/");
    const bareModel = model.includes("/") ? parts[parts.length - 1]! : model;
    return /^o\d/.test(bareModel) || /^gpt-5/.test(bareModel);
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

function gatewayAttributionHeaders(): Record<string, string> | undefined {
    const env = (
        globalThis as {
            process?: { env?: Record<string, string | undefined> };
        }
    ).process?.env;
    const referer = env?.MOSAIC_GATEWAY_HTTP_REFERER;
    const title = env?.MOSAIC_GATEWAY_APP_TITLE;
    const headers = {
        ...(referer ? { "http-referer": referer } : {}),
        ...(title ? { "x-title": title } : {}),
    };
    return Object.keys(headers).length > 0 ? headers : undefined;
}

function providerMetadataFrom(
    metadata: Record<string, unknown> | undefined,
): ProviderMetadata | undefined {
    const gateway = metadata?.gateway;
    if (!isRecord(gateway)) return undefined;
    const generationId = gateway.generationId;
    if (typeof generationId !== "string" || generationId.length === 0) {
        return undefined;
    }
    return { gateway: { generationId } };
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
