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
import { parseStructuredOutput } from "./structuredOutput.js";

function isReasoningModel(model: string): boolean {
    return /^o\d/.test(model) || /^gpt-5/.test(model);
}

export class OpenAIEvalProvider implements IEvalCompletionProvider {
    private client: OpenAI;
    private providerLabel: string;
    private transport: CompletionTransport;

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
                ...(options.baseURL ? { baseURL: options.baseURL } : {}),
                timeout: 120_000,
                maxRetries: 2,
            });
        this.providerLabel = options.providerLabel ?? "OpenAI";
        this.transport = options.transport ?? "openai";
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
            : undefined;

        // `max_completion_tokens` is the current param and works for both gpt-4o
        // and reasoning models; `max_tokens` is deprecated and rejected by o-series.
        const reasoning = isReasoningModel(req.model);
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
        if (this.transport === "openrouter") {
            Object.assign(createParams, {
                provider: openRouterProviderOptions(req),
                ...(req.reasoningEffort
                    ? { reasoning: { effort: req.reasoningEffort } }
                    : {}),
            });
        }
        if (reasoning && req.reasoningEffort) {
            createParams.reasoning_effort = req.reasoningEffort;
        }

        const start = performance.now();
        const response = await this.createCompletion(req, createParams);
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

        const usage: UsageData = {
            promptTokens: response.usage?.prompt_tokens,
            completionTokens: response.usage?.completion_tokens,
            reasoningTokens:
                response.usage?.completion_tokens_details?.reasoning_tokens,
            cacheReadTokens:
                response.usage?.prompt_tokens_details?.cached_tokens,
            totalTokens: response.usage?.total_tokens,
        };

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

        return {
            text,
            parsed: parsedResult.parsed,
            schemaViolation: parsedResult.schemaViolation,
            usage,
            latencyMs,
            actualRoute,
            cache,
        };
    }

    private async createCompletion(
        req: CompletionRequest,
        createParams: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    ) {
        try {
            const request = req.responseSchema
                ? this.client.chat.completions.parse(
                      createParams,
                      requestOptions(req, this.transport),
                  )
                : this.client.chat.completions.create(
                      createParams,
                      requestOptions(req, this.transport),
                  );
            if (this.transport !== "openrouter") return await request;
            const wrapped = await request.withResponse();
            return Object.assign(wrapped.data, {
                __mosaicOpenRouterCacheStatus:
                    wrapped.response.headers.get("x-openrouter-cache-status") ??
                    undefined,
                __mosaicOpenRouterGenerationId:
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

function openRouterProviderOptions(req: CompletionRequest) {
    const policy = req.route?.upstreamPolicy;
    return {
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
) {
    return {
        signal: req.signal,
        ...(req.timeoutMs !== undefined ? { timeout: req.timeoutMs } : {}),
        maxRetries: req.maxRetries ?? 2,
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
    const upstreamProvider =
        typeof record.provider === "string" && record.provider.length <= 100
            ? record.provider
            : undefined;
    const headerGenerationId = record.__mosaicOpenRouterGenerationId;
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
    const cacheStatus = record.__mosaicOpenRouterCacheStatus;
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
