import type * as NodeCrypto from "node:crypto";
import type { ICostPricing } from "../cost.js";
import type { ApiKeys, ReasoningEffort } from "../types.js";
import { bifrostApiBaseUrl } from "./bifrost.js";

/**
 * What Bifrost's model list (`/v1/models`) says about one model. For an
 * `openrouter/…` id Bifrost passes on OpenRouter's own metadata:
 * `supported_parameters` (e.g. `reasoning`, `reasoning_effort`,
 * `structured_outputs`, `response_format`) and `max_output_tokens`. A field
 * is undefined when the list doesn't say.
 */
export interface IBifrostModelInfo {
    id: string;
    /** OpenRouter takes `reasoning` for it (thinking can be set). */
    reasoning?: boolean;
    /** OpenRouter also lists `reasoning_effort` (effort levels). */
    reasoningEffort?: boolean;
    /** OpenRouter lists `structured_outputs` or `response_format`. */
    structuredOutput?: boolean;
    /** The most output tokens one call can ask for. */
    maxOutputTokens?: number;
    /**
     * The list's price for the id (OpenRouter's `pricing`: USD per token as
     * strings, `prompt`, `completion`, `input_cache_read`, …).
     */
    pricing?: ICostPricing;
}

/**
 * Thinking levels OpenRouter's `reasoning.effort` accepts. A model that
 * lists only `reasoning` (on/off or a budget, no `reasoning_effort`) gets a
 * narrower set: OpenRouter turns the effort into on/off or a budget.
 */
export const OPENROUTER_EFFORT_LEVELS: readonly ReasoningEffort[] = [
    "none",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
];
export const OPENROUTER_TOGGLE_LEVELS: readonly ReasoningEffort[] = [
    "none",
    "low",
    "medium",
    "high",
];

/** Reads one entry of Bifrost's `/v1/models` list; undefined without an id. */
export function bifrostModelInfoFromListing(
    model: unknown,
): IBifrostModelInfo | undefined {
    if (typeof model !== "object" || model === null) return undefined;
    const record = model as Record<string, unknown>;
    if (typeof record.id !== "string" || !record.id) return undefined;
    const parameters = Array.isArray(record.supported_parameters)
        ? record.supported_parameters.filter(
              (value): value is string => typeof value === "string",
          )
        : undefined;
    const maxOutput = record.max_output_tokens;
    const pricing = listedPricing(record.pricing);
    return {
        id: record.id,
        ...(parameters
            ? {
                  reasoning: parameters.includes("reasoning"),
                  reasoningEffort: parameters.includes("reasoning_effort"),
                  structuredOutput:
                      parameters.includes("structured_outputs") ||
                      parameters.includes("response_format"),
              }
            : {}),
        ...(typeof maxOutput === "number" &&
        Number.isSafeInteger(maxOutput) &&
        maxOutput > 0
            ? { maxOutputTokens: maxOutput }
            : {}),
        ...(pricing ? { pricing } : {}),
    };
}

/**
 * OpenRouter's per-token prices as Bifrost lists them. Undefined without a
 * prompt and completion price; a negative price (OpenRouter's "-1" for a
 * router whose price varies) is no price.
 */
function listedPricing(value: unknown): ICostPricing | undefined {
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    const prompt = perTokenPrice(record.prompt);
    const completion = perTokenPrice(record.completion);
    if (prompt === undefined || completion === undefined) return undefined;
    const cacheRead = perTokenPrice(record.input_cache_read);
    const cacheWrite = perTokenPrice(record.input_cache_write);
    const reasoning = perTokenPrice(record.internal_reasoning);
    return {
        promptPricePerToken: prompt,
        completionPricePerToken: completion,
        ...(cacheRead !== undefined
            ? { cacheReadPricePerToken: cacheRead }
            : {}),
        ...(cacheWrite !== undefined
            ? { cacheWritePricePerToken: cacheWrite }
            : {}),
        // OpenRouter lists "0" when thinking is billed as output.
        ...(reasoning !== undefined && reasoning > 0
            ? { reasoningPricePerToken: reasoning }
            : {}),
    };
}

function perTokenPrice(value: unknown): number | undefined {
    const price =
        typeof value === "number"
            ? value
            : typeof value === "string" && value.trim() !== ""
              ? Number(value)
              : Number.NaN;
    return Number.isFinite(price) && price >= 0 ? price : undefined;
}

/**
 * Names one Bifrost (its API address and key) for its cached model list.
 * Each team can point at its own Bifrost, whose list may say anything, so
 * what one list says (prices, thinking, output limits) is used only for
 * calls through that same Bifrost and key.
 */
export function bifrostModelListKey(
    apiBaseUrl: string | undefined,
    apiKey: string,
): string {
    return nodeCrypto()
        .createHash("sha256")
        .update(`${apiBaseUrl ?? ""}\n${apiKey}`)
        .digest("hex");
}

/**
 * node:crypto, loaded when a key is made rather than imported at the top,
 * so this module stays in the client-safe main entry: list keys are only
 * ever made on the server (Node, Bun, or Workers with nodejs_compat).
 */
function nodeCrypto(): typeof NodeCrypto {
    return process.getBuiltinModule("node:crypto") as typeof NodeCrypto;
}

/** `bifrostModelListKey` for the Bifrost in `apiKeys`; undefined without one. */
export function bifrostModelListKeyFor(apiKeys: ApiKeys): string | undefined {
    if (!apiKeys.bifrost || !apiKeys.bifrostBaseUrl) return undefined;
    return bifrostModelListKey(
        bifrostApiBaseUrl(apiKeys.bifrostBaseUrl),
        apiKeys.bifrost,
    );
}

// What each fetched Bifrost list said, by list key and then Bifrost id.
const infoByList = new Map<string, Map<string, IBifrostModelInfo>>();

/** Remember what the Bifrost model list named `listKey` says. */
export function installBifrostModelInfo(
    listKey: string,
    models: readonly IBifrostModelInfo[],
): void {
    infoByList.set(listKey, new Map(models.map((model) => [model.id, model])));
}

/**
 * What the Bifrost list named `listKey` said about `bifrostModelId`;
 * undefined without a key or when that list doesn't name the model.
 */
export function bifrostModelInfo(
    listKey: string | undefined,
    bifrostModelId: string,
): IBifrostModelInfo | undefined {
    if (!listKey) return undefined;
    return infoByList.get(listKey)?.get(bifrostModelId);
}

/** The price the Bifrost list named `listKey` gives `bifrostModelId`. */
export function bifrostListPricing(
    listKey: string | undefined,
    bifrostModelId: string,
): ICostPricing | undefined {
    return bifrostModelInfo(listKey, bifrostModelId)?.pricing;
}

/**
 * The thinking levels Bifrost's list says OpenRouter takes for a model:
 * `[]` when it lists no `reasoning` (thinking can't be set), undefined when
 * the list doesn't say (the model registry decides). `registryLevels` win
 * when the model takes thinking, since they are the model's own.
 */
export function bifrostListedThinkingLevels(
    listKey: string | undefined,
    bifrostModelId: string,
    registryLevels: readonly ReasoningEffort[] | undefined,
): readonly ReasoningEffort[] | undefined {
    const info = bifrostModelInfo(listKey, bifrostModelId);
    if (info?.reasoning === undefined) return undefined;
    if (!info.reasoning) return [];
    if (registryLevels) return registryLevels;
    return info.reasoningEffort
        ? OPENROUTER_EFFORT_LEVELS
        : OPENROUTER_TOGGLE_LEVELS;
}

/**
 * A plain-words warning when a call asks for more output tokens than
 * Bifrost's list says the model can give; undefined otherwise.
 */
export function bifrostOutputLimitWarning(
    listKey: string | undefined,
    bifrostModelId: string,
    maxOutputTokens: number | undefined,
): string | undefined {
    const limit = bifrostModelInfo(listKey, bifrostModelId)?.maxOutputTokens;
    if (limit === undefined || maxOutputTokens === undefined) return undefined;
    if (maxOutputTokens <= limit) return undefined;
    return `The output limit (${maxOutputTokens.toLocaleString("en-US")} tokens) is more than ${bifrostModelId} can give (${limit.toLocaleString("en-US")} tokens, per Bifrost's model list); the provider may refuse the call or stop at its own limit.`;
}

/** How long a fetched list is reused before it is fetched again. */
const LIST_TTL_MS = 10 * 60 * 1000;
/** How long a failed fetch is remembered before it is tried again. */
const ERROR_TTL_MS = 60 * 1000;
const loadedUntil = new Map<string, number>();
const loading = new Map<string, Promise<void>>();

/**
 * Fetch one Bifrost's model list (`key` names its address and key) at most
 * once per ten minutes and remember what it says. A failed fetch is
 * remembered for a minute and never fails the caller: the model registry
 * decides meanwhile.
 */
export async function loadBifrostModelInfo(
    key: string,
    list: () => Promise<readonly unknown[]>,
    now: () => number = Date.now,
): Promise<void> {
    if ((loadedUntil.get(key) ?? 0) > now()) return;
    const inFlight = loading.get(key);
    if (inFlight) return inFlight;
    const request = list()
        .then((models) => {
            installBifrostModelInfo(
                key,
                models.flatMap((model) => {
                    const info = bifrostModelInfoFromListing(model);
                    return info ? [info] : [];
                }),
            );
            loadedUntil.set(key, now() + LIST_TTL_MS);
        })
        .catch(() => {
            loadedUntil.set(key, now() + ERROR_TTL_MS);
        })
        .finally(() => loading.delete(key));
    loading.set(key, request);
    return request;
}

/** Forget every fetched list (tests). */
export function resetBifrostModelInfo(): void {
    infoByList.clear();
    loadedUntil.clear();
    loading.clear();
}
