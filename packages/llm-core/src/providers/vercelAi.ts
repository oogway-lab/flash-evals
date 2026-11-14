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
import { createOpenAI } from "@ai-sdk/openai";
import {
    DIRECT_MAKER_HOSTS,
    type DirectMakerTransport,
} from "../models/registry.js";
import type {
    CompletionCacheProvenance,
    CompletionRequest,
    CompletionResult,
    ICompletionActualRoute,
    EvalImage,
    IEvalCompletionProvider,
    UsageData,
} from "../types.js";
import { OPENAI_API_BASE_URL } from "./endpoints.js";
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
    response?: { id?: string; modelId?: string };
}>;

export interface IVercelAIEvalProviderDeps {
    generateText?: GenerateTextFn;
    modelFor?: (model: string) => LanguageModel;
    /**
     * Set for a call straight to the model's maker: the maker is recorded as
     * the host that served it, and run data rules are checked against it.
     */
    directMaker?: DirectMakerTransport;
    /** Provider name used in error messages. */
    providerLabel?: string;
}

export class VercelAIEvalProvider implements IEvalCompletionProvider {
    private generate: GenerateTextFn;
    private modelFor: (model: string) => LanguageModel;
    private directMaker?: DirectMakerTransport;
    private providerLabel: string;

    constructor(apiKey: string, deps: IVercelAIEvalProviderDeps = {}) {
        this.generate = deps.generateText ?? generateText;
        this.modelFor =
            deps.modelFor ??
            createOpenAI({ apiKey, baseURL: OPENAI_API_BASE_URL });
        this.directMaker = deps.directMaker;
        this.providerLabel = deps.providerLabel ?? "Vercel AI SDK";
    }

    async complete(req: CompletionRequest): Promise<CompletionResult> {
        if (this.directMaker)
            assertDirectDataPolicy(req, this.directMaker, this.providerLabel);
        const start = performance.now();
        const thinking = thinkingPlanFor(
            req.model,
            this.directMaker ?? "vercel-ai",
            req.reasoningEffort,
        );
        try {
            const result = await this.generate({
                model: this.modelFor(req.model),
                instructions: req.system,
                messages: messagesFor(req),
                maxOutputTokens: req.maxTokens,
                ...(this.directMaker
                    ? directCallOptions(req, thinking)
                    : {
                          temperature: rejectsSamplingSettings(req.model)
                              ? undefined
                              : req.temperature,
                          maxRetries: 2,
                          timeout: 120_000,
                          ...(thinking?.providerOptions
                              ? { providerOptions: thinking.providerOptions }
                              : {}),
                      }),
                abortSignal: req.signal,
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

            const usage = usageFrom(result.usage);
            return {
                text,
                parsed: parsedResult.parsed,
                schemaViolation: parsedResult.schemaViolation,
                usage,
                latencyMs,
                ...(thinking ? { thinking: thinking.outcome } : {}),
                ...(this.directMaker
                    ? directProvenance(
                          this.directMaker,
                          req.model,
                          usage,
                          result.response,
                      )
                    : {}),
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
                    `${this.providerLabel} request failed for ${req.model}: ${aiSdkErrorMessage(err)}`,
                ),
                err,
            );
        }
    }
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

/**
 * Sampling, retries and effort for a direct maker call. The AI SDK maps the
 * shared reasoning level to each maker's own setting (Anthropic: adaptive
 * thinking with `effort`; Gemini: `thinkingLevel` or a thinking budget) and
 * drops sampling settings a model rejects, with a warning.
 */
function directCallOptions(
    req: CompletionRequest,
    thinking: IThinkingPlan | undefined,
) {
    const noSampling = rejectsSamplingSettings(req.model);
    return {
        temperature: noSampling ? undefined : req.temperature,
        topP: noSampling ? undefined : req.topP,
        seed: req.seed,
        maxRetries: req.maxRetries ?? 2,
        timeout: req.timeoutMs ?? 120_000,
        ...(thinking?.reasoning ? { reasoning: thinking.reasoning } : {}),
    };
}

/**
 * A direct call is always served by the maker. It can follow an `onlyHosts`
 * rule that names the maker, but not retention or training rules: those
 * depend on the account's agreement with the maker, which a call can't check.
 */
function assertDirectDataPolicy(
    req: CompletionRequest,
    maker: DirectMakerTransport,
    providerLabel: string,
): void {
    const policy = req.dataPolicy;
    if (!policy) return;
    if (policy.zeroDataRetention || policy.disallowPromptTraining)
        throw new Error(
            `${providerLabel} can't promise zero data retention or no training on prompts for ${req.model}. Run it through Vercel AI Gateway or OpenRouter instead.`,
        );
    const hosts = policy.onlyHosts ?? [];
    if (
        hosts.length > 0 &&
        !hosts.some((host) => DIRECT_MAKER_HOSTS[maker].includes(host))
    )
        throw new Error(
            `${providerLabel} serves ${req.model} itself, and the run's data rules don't allow "${DIRECT_MAKER_HOSTS[maker][0]}". Add it to the allowed hosts or run the model through a gateway.`,
        );
}

function directProvenance(
    maker: DirectMakerTransport,
    requestedModel: string,
    usage: UsageData,
    response: { id?: string; modelId?: string } | undefined,
): Pick<CompletionResult, "actualRoute" | "cache" | "providerMetadata"> {
    const host = DIRECT_MAKER_HOSTS[maker][0]!;
    const generationId =
        response?.id && response.id.length <= 200 ? response.id : undefined;
    const actualRoute: ICompletionActualRoute = {
        status: "resolved",
        transport: maker,
        modelId: response?.modelId || requestedModel,
        upstreamProvider: host,
        ...(generationId ? { generationId } : {}),
        evidenceCompleteness: "complete",
    };
    const cache: CompletionCacheProvenance =
        usage.cacheReadTokens === undefined
            ? { status: "miss" }
            : {
                  status: "provider_cache",
                  kind: "prompt",
                  hit: usage.cacheReadTokens > 0,
              };
    return { actualRoute, cache, providerMetadata: { servedBy: host } };
}

function usageFrom(usage: LanguageModelUsage): UsageData {
    return {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens,
        // Input totals include cache reads and writes, which cost charges at
        // their own rates.
        ...(usage.inputTokenDetails?.cacheReadTokens !== undefined
            ? { cacheReadTokens: usage.inputTokenDetails.cacheReadTokens }
            : {}),
        ...(usage.inputTokenDetails?.cacheWriteTokens !== undefined
            ? { cacheWriteTokens: usage.inputTokenDetails.cacheWriteTokens }
            : {}),
        totalTokens: usage.totalTokens,
    };
}

function aiSdkErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return String(err);
    return err.message.trim() || err.name || "Unknown provider error";
}

function withCause(error: Error, cause: unknown): Error {
    return Object.assign(error, { cause });
}
