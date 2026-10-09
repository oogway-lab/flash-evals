import {
    computeCostFromUsageWithPricing,
    getBareModelName,
    getEvalProvider,
    type ApiKeys,
    type EvalImage,
    type ReasoningEffort,
    type UsageData,
} from "@mosaic/llm-core";
import { errorMessage } from "../lib/errors";
import { resolveApiKeys } from "@/server/secrets/resolveApiKeys";
import { resolvePricingFor } from "@/server/llm/pricing";
import { resolveReasoningEffort } from "@/server/llm/reasoningConfig";
import type {
    IPromptSampleInput,
    ISchemaCompatibilityIssue,
    JsonSchemaObject,
} from "@/server/db/jsonTypes";
import { parseStrictJsonOnly } from "./validation";
import { validateDataAgainstSchema } from "./schemaValidation";

export type PromptTestRunResultStatus =
    | "success"
    | "failed_validation"
    | "provider_error"
    | "timeout"
    | "cancelled";

export interface IPromptTestRunResult {
    sampleName: string;
    inputText: string;
    status: PromptTestRunResultStatus;
    rawOutput?: string;
    parsedOutput?: unknown;
    validation: {
        valid: boolean;
        errors: ISchemaCompatibilityIssue[];
    };
    usage?: UsageData;
    latencyMs?: number;
    costUsd?: number;
    costSource: "computed" | "unavailable";
    error?: string;
}

export interface IPromptTestRunResponse {
    status: "success" | "partial" | "failed";
    targetModelId: string;
    reasoningEffort?: ReasoningEffort;
    results: IPromptTestRunResult[];
}

export interface IRunPromptTestInput {
    prompt: string;
    schema: JsonSchemaObject;
    targetModelId: string;
    reasoningEffort?: ReasoningEffort;
    samples: IPromptSampleInput[];
    /** Transient image sent with every sample in this run; never persisted. */
    image?: EvalImage;
    timeoutMs?: number;
    signal?: AbortSignal;
    apiKeys?: ApiKeys;
    teamId?: string;
}

const DEFAULT_MAX_TOKENS = 1200;

export async function runPromptTest(
    input: IRunPromptTestInput,
): Promise<IPromptTestRunResponse> {
    const samples = input.samples.length > 0
        ? input.samples
        : [{ name: "Single input", inputText: "" }];
    const resolvedEffort = resolveReasoningEffort(
        input.targetModelId,
        input.reasoningEffort,
    );
    const apiKeys = input.apiKeys ?? (await resolveApiKeys(input.teamId)).apiKeys;
    const provider = getEvalProvider(apiKeys);
    const results: IPromptTestRunResult[] = [];

    for (const sample of samples) {
        if (input.signal?.aborted) {
            results.push(cancelledResult(sample));
            continue;
        }

        const prompt = promptForSample(input.prompt, sample);
        const startedAt = performance.now();
        try {
            const completion = await withTimeout(
                (signal) => provider.complete({
                    model: getBareModelName(input.targetModelId),
                    prompt,
                    images: input.image ? [input.image] : undefined,
                    responseSchema: {
                        name: "prompt_output",
                        schema: input.schema,
                    },
                    maxTokens: DEFAULT_MAX_TOKENS,
                    reasoningEffort: resolvedEffort,
                    signal,
                }),
                input.timeoutMs,
                input.signal,
            );
            const latencyMs = completion.latencyMs ?? performance.now() - startedAt;
            const parsed = parseStrictJsonOnly(completion.text);
            if (!parsed.ok) {
                results.push({
                    sampleName: sample.name,
                    inputText: sample.inputText ?? "",
                    status: "failed_validation",
                    rawOutput: completion.text,
                    validation: { valid: false, errors: [parsed.error] },
                    usage: completion.usage,
                    latencyMs,
                    ...(await costFields(
                        input.targetModelId,
                        completion.usage,
                        apiKeys,
                    )),
                });
                continue;
            }

            const schemaResult = validateDataAgainstSchema(
                input.schema,
                parsed.value,
            );
            results.push({
                sampleName: sample.name,
                inputText: sample.inputText ?? "",
                status: schemaResult.ok ? "success" : "failed_validation",
                rawOutput: completion.text,
                parsedOutput: parsed.value,
                validation: {
                    valid: schemaResult.ok,
                    errors: schemaResult.ok ? [] : schemaResult.errors,
                },
                usage: completion.usage,
                latencyMs,
                ...(await costFields(
                    input.targetModelId,
                    completion.usage,
                    apiKeys,
                )),
            });
        } catch (err) {
            results.push(errorResult(sample, err, performance.now() - startedAt));
        }
    }

    return {
        status: aggregateStatus(results),
        targetModelId: input.targetModelId,
        reasoningEffort: resolvedEffort,
        results,
    };
}

function promptForSample(prompt: string, sample: IPromptSampleInput): string {
    return sample.inputText
        ? `${prompt}\n\nSample input:\n<input>\n${sample.inputText}\n</input>`
        : prompt;
}

async function costFields(
    modelId: string,
    usage: UsageData | undefined,
    apiKeys: ApiKeys,
): Promise<{
    costUsd?: number;
    costSource: "computed" | "unavailable";
}> {
    const pricing = await resolvePricingFor(modelId, apiKeys);
    if (!pricing || !usage) return { costSource: "unavailable" };
    const costUsd = computeCostFromUsageWithPricing(usage, pricing);
    return costUsd === undefined
        ? { costSource: "unavailable" }
        : { costUsd, costSource: "computed" };
}

function aggregateStatus(
    results: IPromptTestRunResult[],
): IPromptTestRunResponse["status"] {
    if (results.every((result) => result.status === "success")) return "success";
    if (results.some((result) => result.status === "success")) return "partial";
    return "failed";
}

async function withTimeout<T>(
    run: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number | undefined,
    signal: AbortSignal | undefined,
): Promise<T> {
    if (signal?.aborted) throw abortError();

    return new Promise<T>((resolve, reject) => {
        let settled = false;
        let timer: ReturnType<typeof setTimeout> | undefined;
        const controller = new AbortController();

        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            if (timer) clearTimeout(timer);
            signal?.removeEventListener("abort", onAbort);
            fn();
        };
        const rejectAndAbort = (err: Error) => {
            controller.abort();
            settle(() => reject(err));
        };
        const onAbort = () => {
            rejectAndAbort(abortError());
        };

        if (timeoutMs) {
            timer = setTimeout(() => {
                rejectAndAbort(timeoutError());
            }, timeoutMs);
        }
        if (signal) signal.addEventListener("abort", onAbort, { once: true });

        let promise: Promise<T>;
        try {
            promise = run(controller.signal);
        } catch (err) {
            settle(() => reject(err));
            return;
        }
        promise.then(
            (value) => settle(() => resolve(value)),
            (err: unknown) => settle(() => reject(err)),
        );
    });
}

function abortError(): Error {
    return Object.assign(new Error("Cancelled"), { name: "AbortError" });
}

function timeoutError(): Error {
    return Object.assign(new Error("Timed out"), { name: "TimeoutError" });
}

function cancelledResult(sample: IPromptSampleInput): IPromptTestRunResult {
    return {
        sampleName: sample.name,
        inputText: sample.inputText ?? "",
        status: "cancelled",
        validation: { valid: false, errors: [] },
        costSource: "unavailable",
        error: "Cancelled",
    };
}

function errorResult(
    sample: IPromptSampleInput,
    err: unknown,
    latencyMs: number,
): IPromptTestRunResult {
    const name = err instanceof Error ? err.name : "";
    const status =
        name === "AbortError"
            ? "cancelled"
            : name === "TimeoutError"
              ? "timeout"
              : "provider_error";
    const message = errorMessage(err);
    return {
        sampleName: sample.name,
        inputText: sample.inputText ?? "",
        status,
        validation: { valid: false, errors: [] },
        latencyMs,
        costSource: "unavailable",
        error: message,
    };
}
