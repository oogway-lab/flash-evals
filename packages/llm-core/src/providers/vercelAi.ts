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
import type {
    CompletionRequest,
    CompletionResult,
    EvalImage,
    IEvalCompletionProvider,
    UsageData,
} from "../types.js";
import { parseStructuredOutput } from "./structuredOutput.js";

function isReasoningModel(model: string): boolean {
    return /^o\d/.test(model) || /^gpt-5/.test(model);
}

type GenerateTextFn = (
    input: Parameters<typeof generateText>[0],
) => Promise<{
    text: string;
    output: unknown;
    usage: LanguageModelUsage;
}>;

export interface IVercelAIEvalProviderDeps {
    generateText?: GenerateTextFn;
    modelFor?: (model: string) => LanguageModel;
}

export class VercelAIEvalProvider implements IEvalCompletionProvider {
    private generate: GenerateTextFn;
    private modelFor: (model: string) => LanguageModel;

    constructor(apiKey: string, deps: IVercelAIEvalProviderDeps = {}) {
        this.generate = deps.generateText ?? generateText;
        this.modelFor = deps.modelFor ?? createOpenAI({ apiKey });
    }

    async complete(req: CompletionRequest): Promise<CompletionResult> {
        const start = performance.now();
        try {
            const result = await this.generate({
                model: this.modelFor(req.model),
                instructions: req.system,
                messages: messagesFor(req),
                maxOutputTokens: req.maxTokens,
                temperature: isReasoningModel(req.model)
                    ? undefined
                    : req.temperature,
                abortSignal: req.signal,
                maxRetries: 2,
                timeout: 120_000,
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
            const text = structuredOutput === undefined
                ? result.text
                : JSON.stringify(structuredOutput);
            const parsedResult = structuredOutput === undefined
                ? parseStructuredOutput(text, req.responseSchema)
                : { parsed: structuredOutput, schemaViolation: false };

            return {
                text,
                parsed: parsedResult.parsed,
                schemaViolation: parsedResult.schemaViolation,
                usage: usageFrom(result.usage),
                latencyMs,
            };
        } catch (err) {
            if (NoObjectGeneratedError.isInstance(err)) {
                return {
                    text: err.text ?? "",
                    parsed: undefined,
                    schemaViolation: true,
                    usage: err.usage
                        ? usageFrom(err.usage)
                        : {},
                    latencyMs: performance.now() - start,
                };
            }
            throw withCause(
                new Error(
                    `Vercel AI SDK request failed for ${req.model}: ${aiSdkErrorMessage(err)}`,
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
    if (!isReasoningModel(req.model) || !req.reasoningEffort) return undefined;
    return {
        openai: {
            reasoningEffort: req.reasoningEffort,
        },
    };
}

function usageFrom(usage: LanguageModelUsage): UsageData {
    return {
        promptTokens: usage.inputTokens,
        completionTokens: usage.outputTokens,
        reasoningTokens: usage.outputTokenDetails.reasoningTokens,
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
