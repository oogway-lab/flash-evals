import { hasDataPolicy } from "../types.js";
import OpenAI from "openai";
import type {
    ICompletionActualRoute,
    CompletionCacheProvenance,
    CompletionRequest,
    CompletionResult,
    CompletionTransport,
    IEvalCompletionProvider,
    UsageData,
} from "../types.js";
import { openRouterAttributionHeaders } from "./attribution.js";
import { openAIClientEndpoint } from "./endpoints.js";
import { bifrostRoutesViaOpenRouter, bifrostUpstream } from "./bifrost.js";
import { computeCostFromUsageWithPricing } from "../cost.js";
import {
    bifrostListPricing,
    bifrostModelListKey,
    bifrostOutputLimitWarning,
    loadBifrostModelInfo,
} from "./bifrostModelInfo.js";
import { parseStructuredOutput } from "./structuredOutput.js";
import { rejectsSamplingSettings, thinkingPlanFor } from "./thinking.js";

export class OpenAIEvalProvider implements IEvalCompletionProvider {
    private client: OpenAI;
    private providerLabel: string;
    private transport: CompletionTransport;
    /** Names this Bifrost (address and key) for its cached model list. */
    private modelListKey: string;

    constructor(
        apiKey: string,
        options: {
            baseURL?: string;
            providerLabel?: string;
            transport?: CompletionTransport;
            client?: OpenAI;
        } = {},
    ) {
        this.client =
            options.client ??
            new OpenAI({
                apiKey,
                ...openAIClientEndpoint(options.baseURL),
                defaultHeaders: openRouterAttributionHeaders(options.baseURL),
                timeout: 120_000,
                maxRetries: 2,
            });
        this.providerLabel = options.providerLabel ?? "OpenAI";
        this.transport = options.transport ?? "openai";
        this.modelListKey = bifrostModelListKey(options.baseURL, apiKey);
    }

    /**
     * Bifrost's model list says which models take thinking and how many
     * output tokens they can give (OpenRouter's metadata for openrouter/
     * ids). Fetched at most once per ten minutes; a failed fetch leaves the
     * model registry to decide.
     */
    private async loadBifrostModelList(): Promise<void> {
        if (this.transport !== "bifrost") return;
        await loadBifrostModelInfo(this.modelListKey, async () => {
            const models: unknown[] = [];
            for await (const model of this.client.models.list())
                models.push(model);
            return models;
        });
    }

    /**
     * A Bifrost call whose cost wasn't reported, priced at the price
     * Bifrost's model list gives the id it was sent as (before the caller
     * falls back to the registry's list price).
     */
    private bifrostListCost(
        model: string,
        usage: UsageData,
    ): { usd: number; source: "bifrost_list_price" } | undefined {
        if (this.transport !== "bifrost") return undefined;
        const pricing = bifrostListPricing(this.modelListKey, model);
        const usd = pricing
            ? computeCostFromUsageWithPricing(usage, pricing)
            : undefined;
        return usd !== undefined && Number.isFinite(usd) && usd >= 0
            ? { usd, source: "bifrost_list_price" }
            : undefined;
    }

    // eslint-disable-next-line complexity -- provider completion maps transport-specific response states.
    async complete(req: CompletionRequest): Promise<CompletionResult> {
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] =
            [];
        if (req.system) messages.push({ role: "system", content: req.system });

        const userParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
            { type: "text", text: req.prompt },
        ];
        for (const img of req.images ?? []) {
            userParts.push({
                type: "image_url",
                image_url: {
                    url: `data:${img.mimeType};base64,${img.base64Data}`,
                },
            });
        }
        messages.push({ role: "user", content: userParts });

        const responseFormat = req.responseSchema
            ? ({
                  type: "json_schema",
                  json_schema: {
                      name: req.responseSchema.name,
                      schema: req.responseSchema.schema,
                      strict: req.responseSchema.strict ?? true,
                  },
              } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"])
            : req.jsonMode
              ? ({
                    type: "json_object",
                } satisfies OpenAI.Chat.Completions.ChatCompletionCreateParams["response_format"])
              : undefined;

        // `max_completion_tokens` is the current param and works for both gpt-4o
        // and reasoning models; `max_tokens` is deprecated and rejected by o-series.
        const reasoning = rejectsSamplingSettings(req.model);
        await this.loadBifrostModelList();
        const outputLimitWarning =
            this.transport === "bifrost"
                ? bifrostOutputLimitWarning(
                      this.modelListKey,
                      req.model,
                      req.maxTokens,
                  )
                : undefined;
        const thinking = thinkingPlanFor(
            req.model,
            this.transport,
            req.reasoningEffort,
            this.transport === "bifrost"
                ? { bifrostModelList: this.modelListKey }
                : undefined,
        );
        const createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming =
            {
                model: req.model,
                messages,
                max_completion_tokens: req.maxTokens,
                temperature: reasoning ? undefined : req.temperature,
                top_p: reasoning ? undefined : req.topP,
                seed: req.seed,
                response_format: responseFormat,
                stream: false,
            };
        // Bifrost passes extra body fields on to the provider when asked
        // (x-bf-passthrough-extra-params), so a model it forwards to
        // OpenRouter can follow the rules through OpenRouter's own settings.
        const bifrostPassthrough =
            this.transport === "bifrost" &&
            ((hasDataPolicy(req.dataPolicy) &&
                bifrostRoutesViaOpenRouter(req.model)) ||
                thinking?.bifrostPassthrough === true);
        if (this.transport === "bifrost" && hasDataPolicy(req.dataPolicy)) {
            if (!bifrostPassthrough)
                throw new Error(
                    `Bifrost sends ${req.model} to ${bifrostUpstream(req.model) ?? "its default provider"}, not OpenRouter, so it can't pass on the data rules. Choose a Bifrost model ID that starts with openrouter/.`,
                );
            Object.assign(createParams, {
                provider: openRouterProviderOptions(req),
            });
        } else if (
            this.transport !== "openrouter" &&
            hasDataPolicy(req.dataPolicy)
        )
            throw new Error(
                `${this.providerLabel} can't limit which hosting companies serve ${req.model} or what they keep. Run it through Vercel AI Gateway or OpenRouter instead.`,
            );
        if (this.transport === "openrouter") {
            Object.assign(createParams, {
                provider: openRouterProviderOptions(req),
            });
        }
        if (thinking?.body) Object.assign(createParams, thinking.body);

        const start = performance.now();
        const response = await this.createCompletion(
            req,
            createParams,
            bifrostPassthrough,
        );
        const latencyMs = performance.now() - start;

        if (response.choices[0]?.finish_reason === "length") {
            throw new Error(
                `${this.providerLabel} reached the output token limit for ${req.model}. Increase max output tokens and try again.`,
            );
        }

        const message = response.choices[0]?.message;
        const sdkParsed = req.responseSchema
            ? (message as { parsed?: unknown } | undefined)?.parsed
            : undefined;
        const text =
            message?.content ??
            ((message as { refusal?: string | null } | undefined)?.refusal ||
                (sdkParsed === undefined || sdkParsed === null
                    ? ""
                    : JSON.stringify(sdkParsed)));

        // OpenRouter reports the call's cost in usage.cost; Bifrost may pass
        // it through. Without it the caller prices the call at list prices.
        const reportedCost =
            this.transport === "openrouter" || this.transport === "bifrost"
                ? openRouterReportedCost(response.usage)
                : undefined;
        const usage: UsageData = {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            reasoningTokens:
                response.usage?.completion_tokens_details?.reasoning_tokens,
            cacheReadTokens:
                response.usage?.prompt_tokens_details?.cached_tokens,
            totalTokens: response.usage?.total_tokens,
        };
        const cost =
            reportedCost === undefined
                ? this.bifrostListCost(req.model, usage)
                : { usd: reportedCost, source: "provider_reported" as const };

        const parsedResult =
            sdkParsed === undefined || sdkParsed === null
                ? parseStructuredOutput(text, req.responseSchema)
                : { parsed: sdkParsed, schemaViolation: false };

        const cache = cacheProvenanceFrom(response);
        const observedRoute = actualRouteFrom(
            response,
            this.transport,
            req.model,
        );
        const actualRoute: ICompletionActualRoute =
            cache.status === "provider_cache" &&
            cache.kind === "response" &&
            cache.hit
                ? {
                      status: "not_invoked",
                      ...("generationId" in observedRoute &&
                      observedRoute.generationId
                          ? { generationId: observedRoute.generationId }
                          : {}),
                      evidenceCompleteness: "complete",
                  }
                : observedRoute;

        const servedBy =
            "upstreamProvider" in actualRoute
                ? actualRoute.upstreamProvider
                : undefined;
        return {
            text,
            parsed: parsedResult.parsed,
            schemaViolation: parsedResult.schemaViolation,
            usage,
            cost,
            latencyMs,
            actualRoute,
            cache,
            ...(servedBy ? { providerMetadata: { servedBy } } : {}),
            ...(thinking ? { thinking: thinking.outcome } : {}),
            ...(outputLimitWarning ? { warnings: [outputLimitWarning] } : {}),
        };
    }

    private async createCompletion(
        req: CompletionRequest,
        createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
        bifrostPassthrough = false,
    ) {
        try {
            const options = requestOptions(
                req,
                this.transport,
                bifrostPassthrough,
            );
            const request = req.responseSchema
                ? this.client.chat.completions.parse(createParams, options)
                : this.client.chat.completions.create(createParams, options);
            if (this.transport !== "openrouter") return await request;
            const wrapped = await request.withResponse();
            return Object.assign(wrapped.data, {
                __flashEvalsOpenRouterCacheStatus:
                    wrapped.response.headers.get("x-openrouter-cache-status") ??
                    undefined,
                __flashEvalsOpenRouterGenerationId:
                    wrapped.response.headers.get("x-generation-id") ??
                    undefined,
            });
        } catch (err) {
            throw withCause(
                new Error(
                    `${this.providerLabel} request failed for ${req.model}: ${openAIErrorMessage(err)}`,
                ),
                err,
            );
        }
    }
}

export function openRouterProviderOptions(req: CompletionRequest) {
    const policy = req.route?.upstreamPolicy;
    const data = req.dataPolicy;
    return {
        ...(data?.onlyHosts?.length
            ? { only: data.onlyHosts, allow_fallbacks: false }
            : {}),
        ...(data?.zeroDataRetention ? { zdr: true } : {}),
        ...(data?.disallowPromptTraining ? { data_collection: "deny" } : {}),
        ...(policy?.mode === "preference"
            ? {
                  order: policy.order,
                  allow_fallbacks: policy.allowFallbacks,
              }
            : {}),
        ...(policy?.mode === "exact"
            ? { only: policy.only, allow_fallbacks: false }
            : {}),
        ...(req.route?.requireParameters !== undefined
            ? { require_parameters: req.route.requireParameters }
            : {}),
    };
}

function requestOptions(
    req: CompletionRequest,
    transport: CompletionTransport,
    bifrostPassthrough: boolean,
) {
    return {
        signal: req.signal,
        ...(req.timeoutMs !== undefined ? { timeout: req.timeoutMs } : {}),
        maxRetries: req.maxRetries ?? 2,
        ...(bifrostPassthrough
            ? { headers: { "x-bf-passthrough-extra-params": "true" } }
            : {}),
        ...(transport === "openrouter"
            ? {
                  headers: {
                      "X-OpenRouter-Cache":
                          req.cachePolicy?.responseCache === "allow"
                              ? "true"
                              : "false",
                  },
              }
            : {}),
    };
}

function actualRouteFrom(
    response: OpenAI.Chat.Completions.ChatCompletion,
    transport: CompletionTransport,
    requestedModel: string,
): ICompletionActualRoute {
    const record = response as unknown as Record<string, unknown>;
    const model =
        typeof record.model === "string" && record.model
            ? record.model
            : requestedModel;
    const reportedProvider =
        typeof record.provider === "string" && record.provider.length <= 100
            ? record.provider
            : undefined;
    // Through Bifrost, a top-level provider naming Bifrost's own upstream
    // (e.g. "openrouter") says nothing about the hosting company.
    const upstreamProvider =
        transport === "bifrost" &&
        reportedProvider?.toLowerCase() === bifrostUpstream(requestedModel)
            ? undefined
            : reportedProvider;
    const headerGenerationId = record.__flashEvalsOpenRouterGenerationId;
    const generationId =
        typeof headerGenerationId === "string" &&
        headerGenerationId.length <= 200
            ? headerGenerationId
            : typeof record.id === "string" && record.id.length <= 200
              ? record.id
              : undefined;
    if (transport === "openai") {
        return {
            status: "resolved",
            transport,
            modelId: model,
            ...(generationId ? { generationId } : {}),
            evidenceCompleteness: "complete",
        };
    }
    if (upstreamProvider) {
        return {
            status: "resolved",
            transport,
            modelId: model,
            upstreamProvider,
            ...(generationId ? { generationId } : {}),
            evidenceCompleteness: "complete",
        };
    }
    return {
        status: "unresolved",
        transport,
        modelId: model,
        ...(generationId ? { generationId } : {}),
        evidenceCompleteness: generationId ? "partial" : "absent",
    };
}

function cacheProvenanceFrom(
    response: OpenAI.Chat.Completions.ChatCompletion,
): CompletionCacheProvenance {
    const record = response as unknown as Record<string, unknown>;
    const cacheStatus = record.__flashEvalsOpenRouterCacheStatus;
    if (typeof cacheStatus === "string") {
        const normalized = cacheStatus.trim().toLowerCase();
        if (normalized === "hit" || normalized === "miss")
            return {
                status: "provider_cache",
                kind: "response",
                hit: normalized === "hit",
            };
    }
    const promptDetails = response.usage?.prompt_tokens_details;
    const cachedTokens = promptDetails?.cached_tokens;
    if (typeof cachedTokens === "number")
        return {
            status: "provider_cache",
            kind: "prompt",
            hit: cachedTokens > 0,
        };
    return { status: "miss" };
}

function openAIErrorMessage(err: unknown): string {
    if (!(err instanceof Error)) return String(err);

    const status = numberProperty(err, "status");
    const code = stringProperty(err, "code");
    const requestId = stringProperty(err, "requestID");
    const detail = causeDetail((err as { cause?: unknown }).cause);
    const parts: string[] = [];

    if (status !== undefined) parts.push(`status ${status}`);
    if (code) parts.push(`code ${code}`);
    if (requestId) parts.push(`request ${requestId}`);

    const message = err.message.trim() || err.name || "Unknown provider error";
    if (detail && !message.includes(detail)) {
        parts.push(detail);
    }

    return parts.length > 0 ? `${message} (${parts.join("; ")})` : message;
}

function causeDetail(cause: unknown): string | undefined {
    if (!cause) return undefined;
    if (cause instanceof Error) {
        const message = cause.message.trim();
        const nested = causeDetail((cause as { cause?: unknown }).cause);
        if (nested && message && !message.includes(nested)) {
            return `${message}: ${nested}`;
        }
        return message || nested;
    }
    if (typeof cause === "object") {
        const code = stringProperty(cause, "code");
        const syscall = stringProperty(cause, "syscall");
        const hostname = stringProperty(cause, "hostname");
        return [code, syscall, hostname].filter(Boolean).join(" ") || undefined;
    }
    return String(cause);
}

function numberProperty(value: object, key: string): number | undefined {
    const prop = (value as Record<string, unknown>)[key];
    return typeof prop === "number" ? prop : undefined;
}

function stringProperty(value: object, key: string): string | undefined {
    const prop = (value as Record<string, unknown>)[key];
    return typeof prop === "string" && prop ? prop : undefined;
}

function withCause(error: Error, cause: unknown): Error {
    return Object.assign(error, { cause });
}

function finiteNonNegative(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}

/**
 * OpenRouter's `usage.cost` is only the OpenRouter charge. For BYOK requests the
 * upstream provider bills separately (`cost_details.upstream_inference_cost`);
 * when that is missing the total is unknown, so fall back to catalog pricing.
 */
function openRouterReportedCost(usage: unknown): number | undefined {
    if (!usage || typeof usage !== "object") return undefined;
    const record = usage as {
        cost?: unknown;
        is_byok?: unknown;
        cost_details?: { upstream_inference_cost?: unknown } | null;
    };
    const cost = finiteNonNegative(record.cost);
    if (cost === undefined || record.is_byok !== true) return cost;
    const upstream = finiteNonNegative(
        record.cost_details?.upstream_inference_cost,
    );
    return upstream === undefined ? undefined : cost + upstream;
}
