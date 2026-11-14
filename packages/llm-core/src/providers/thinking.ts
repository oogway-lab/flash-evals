import type { JSONValue } from "ai";
import type {
    CompletionTransport,
    IThinkingOutcome,
    ReasoningEffort,
} from "../types.js";
import {
    bifrostUpstream,
    registryEntryForBifrostModel,
    registryModelFor,
} from "./bifrost.js";
import { bifrostListedThinkingLevels } from "./bifrostModelInfo.js";
import {
    claudeRejectsSampling,
    claudeRejectsThinkingDisabled,
} from "../models/claudeLimits.js";

/**
 * How a requested thinking (reasoning) level is sent on one route, or why
 * it can't be. Which levels a model takes comes from the model registry
 * (`reasoningEffort.supportedLevels`), never from its name.
 *
 * For a Bifrost id starting with `openrouter/`, Bifrost's cached model list
 * (OpenRouter's `supported_parameters`) decides when it says: no `reasoning`
 * means thinking can't be set; `reasoning` means it can, at the registry's
 * levels or, for a model the registry doesn't know, OpenRouter's.
 *
 * Routes and the fields they get:
 * - Vercel AI Gateway: each maker's own provider option, keyed by maker, as
 *   the gateway documents ("use the actual provider name … as the key"):
 *   `openai.reasoningEffort`; `anthropic.thinking` (+ `effort`); `google.
 *   thinkingConfig` (`thinkingLevel`, or `thinkingBudget` on Gemini 2.5).
 *   Makers the AI SDK maps the portable `reasoning` setting for (xAI,
 *   DeepSeek, Moonshot AI, Alibaba, Mistral, …) get that top-level setting,
 *   which the gateway forwards. Other makers: not sent.
 * - OpenRouter, and Bifrost ids starting with `openrouter/`: OpenRouter's
 *   `reasoning: { effort }` (`"none"` turns thinking off).
 * - OpenAI (and Bifrost ids starting with `openai/`): `reasoning_effort`.
 * - Anthropic and the Gemini API directly: the AI SDK's top-level
 *   `reasoning`, which the maker's SDK maps to its own setting (not sent
 *   for Gemma, which the Gemini API documents no thinking setting for).
 */
export type ThinkingRoute = CompletionTransport | "vercel-ai";

export interface IThinkingPlan {
    outcome: IThinkingOutcome;
    /** AI SDK `providerOptions` entries, keyed by maker. */
    providerOptions?: Record<string, Record<string, JSONValue>>;
    /** The AI SDK's portable top-level `reasoning` setting. */
    reasoning?: ReasoningEffort;
    /** Extra fields for an OpenAI-compatible chat completion body. */
    body?: Record<string, unknown>;
    /** Bifrost must pass `body` on to OpenRouter. */
    bifrostPassthrough?: boolean;
}

/**
 * Makers whose AI SDK provider maps the portable `reasoning` setting (per
 * the AI SDK reasoning docs); the gateway forwards it to them.
 */
const PORTABLE_REASONING_MAKERS = new Set([
    "xai",
    "deepseek",
    "moonshotai",
    "alibaba",
    "mistral",
    "cohere",
    "perplexity",
    "fireworks",
    "groq",
    "amazon",
    "bedrock",
]);

const MAKER_ALIASES: Record<string, string> = {
    "x-ai": "xai",
    "z-ai": "zai",
    qwen: "alibaba",
    mistralai: "mistral",
    "meta-llama": "meta",
};

const ANTHROPIC_BUDGETS: Partial<Record<ReasoningEffort, number>> = {
    minimal: 1024,
    low: 2048,
    medium: 8192,
    high: 16_384,
    xhigh: 32_768,
};

const GEMINI_25_BUDGETS: Partial<Record<ReasoningEffort, number>> = {
    none: 0,
    minimal: 512,
    low: 1024,
    medium: 8192,
    high: 24_576,
};

/** The maker of a model id such as `anthropic/claude-opus-4.8` (bare ids are OpenAI's). */
export function makerOfModel(modelId: string): string {
    const parts = modelId.replace(/^~/, "").split("/");
    const raw = (parts.length > 1 ? parts[0]! : "openai").toLowerCase();
    return MAKER_ALIASES[raw] ?? raw;
}

function bareName(modelId: string): string {
    return modelId.slice(modelId.lastIndexOf("/") + 1).toLowerCase();
}

/** Claude models that take adaptive thinking with an effort (4.6 and later). */
function claudeUsesAdaptiveThinking(modelId: string): boolean {
    const name = bareName(modelId).replace(/\./g, "-");
    if (/claude-(?:3|instant|2)/.test(name)) return false;
    if (/claude-[a-z]+-4(?:$|-[0-5](?:$|-|@))/.test(name)) return false;
    return name.includes("claude-");
}

function supportedLevels(
    modelId: string,
    route: ThinkingRoute,
    bifrostModelList: string | undefined,
): readonly ReasoningEffort[] | undefined {
    if (route !== "bifrost")
        return registryModelFor(modelId)?.reasoningEffort?.supportedLevels;
    const registryLevels =
        registryEntryForBifrostModel(modelId)?.reasoningEffort?.supportedLevels;
    if (bifrostUpstream(modelId) !== "openrouter") return registryLevels;
    return (
        bifrostListedThinkingLevels(
            bifrostModelList,
            modelId,
            registryLevels,
        ) ?? registryLevels
    );
}

function notSent(requested: ReasoningEffort, reason: string): IThinkingPlan {
    return { outcome: { requested, sent: false, reason } };
}

function sent(
    requested: ReasoningEffort,
    via: string,
    plan: Omit<IThinkingPlan, "outcome">,
): IThinkingPlan {
    return { outcome: { requested, sent: true, via }, ...plan };
}

const ROUTE_NAMES: Record<ThinkingRoute, string> = {
    openai: "OpenAI",
    "vercel-ai": "OpenAI",
    gateway: "Vercel AI Gateway",
    openrouter: "OpenRouter",
    bifrost: "Bifrost",
    anthropic: "Anthropic",
    google: "the Gemini API",
};

/**
 * The request fields that carry `level` for `modelId` (the id the route is
 * called with) on `route`. Undefined when no level is requested.
 */
export function thinkingPlanFor(
    modelId: string,
    route: ThinkingRoute,
    level: ReasoningEffort | undefined,
    options: {
        /** The Bifrost list (`bifrostModelListKey`) the call goes through. */
        bifrostModelList?: string;
    } = {},
): IThinkingPlan | undefined {
    if (!level) return undefined;
    const levels = supportedLevels(modelId, route, options.bifrostModelList);
    if (!levels)
        return notSent(
            level,
            `The model registry lists no thinking levels for ${modelId}, so no thinking setting was sent.`,
        );
    if (levels.length === 0)
        return notSent(
            level,
            `Bifrost's model list says OpenRouter takes no thinking setting for ${modelId}, so none was sent.`,
        );
    if (!levels.includes(level))
        return notSent(
            level,
            `${modelId} takes thinking levels ${levels.join(", ")}, not "${level}".`,
        );
    switch (route) {
        case "gateway":
            return gatewayPlan(modelId, level);
        case "openrouter":
            return sent(level, `reasoning.effort=${level}`, {
                body: { reasoning: { effort: level } },
            });
        case "bifrost":
            return bifrostPlan(modelId, level);
        case "openai":
            return makerOfModel(modelId) === "openai"
                ? sent(level, `reasoning_effort=${level}`, {
                      body: { reasoning_effort: level },
                  })
                : notSent(
                      level,
                      `OpenAI has no thinking setting for ${modelId}.`,
                  );
        case "vercel-ai":
            return sent(level, `openai.reasoningEffort=${level}`, {
                providerOptions: { openai: { reasoningEffort: level } },
            });
        case "google":
            if (bareName(modelId).startsWith("gemma"))
                return notSent(
                    level,
                    `${ROUTE_NAMES.google} documents no thinking setting for Gemma models such as ${modelId}.`,
                );
            return sent(level, `reasoning=${level}`, { reasoning: level });
        case "anthropic":
            return sent(level, `reasoning=${level}`, { reasoning: level });
    }
}

function bifrostPlan(modelId: string, level: ReasoningEffort): IThinkingPlan {
    const upstream = bifrostUpstream(modelId);
    if (upstream === "openrouter")
        return sent(level, `reasoning.effort=${level} (passed to OpenRouter)`, {
            body: { reasoning: { effort: level } },
            bifrostPassthrough: true,
        });
    if (upstream === "openai")
        return sent(level, `reasoning_effort=${level}`, {
            body: { reasoning_effort: level },
        });
    return notSent(
        level,
        `Bifrost sends ${modelId} to ${upstream ?? "its default provider"}, and Flash Evals has no documented thinking setting for that. Choose a Bifrost model ID that starts with openrouter/.`,
    );
}

function gatewayPlan(modelId: string, level: ReasoningEffort): IThinkingPlan {
    const maker = makerOfModel(modelId);
    if (maker === "openai")
        return sent(level, `openai.reasoningEffort=${level}`, {
            providerOptions: { openai: { reasoningEffort: level } },
        });
    if (maker === "anthropic") return anthropicGatewayPlan(modelId, level);
    if (maker === "google") return googleGatewayPlan(modelId, level);
    if (PORTABLE_REASONING_MAKERS.has(maker))
        return sent(level, `reasoning=${level}`, { reasoning: level });
    return notSent(
        level,
        `${ROUTE_NAMES.gateway} documents no thinking setting for ${maker} models such as ${modelId}.`,
    );
}

function anthropicGatewayPlan(
    modelId: string,
    level: ReasoningEffort,
): IThinkingPlan {
    if (level === "none" && claudeRejectsThinkingDisabled(modelId))
        return notSent(
            level,
            `${modelId} can't turn thinking off, so no thinking setting was sent.`,
        );
    if (level === "none")
        return sent(level, "anthropic.thinking.type=disabled", {
            providerOptions: { anthropic: { thinking: { type: "disabled" } } },
        });
    if (claudeUsesAdaptiveThinking(modelId)) {
        const effort = level === "minimal" ? "low" : level;
        return sent(level, `anthropic.thinking=adaptive, effort=${effort}`, {
            providerOptions: {
                anthropic: { thinking: { type: "adaptive" }, effort },
            },
        });
    }
    const budgetTokens = ANTHROPIC_BUDGETS[level]!;
    return sent(level, `anthropic.thinking.budgetTokens=${budgetTokens}`, {
        providerOptions: {
            anthropic: { thinking: { type: "enabled", budgetTokens } },
        },
    });
}

function googleGatewayPlan(
    modelId: string,
    level: ReasoningEffort,
): IThinkingPlan {
    const name = bareName(modelId);
    if (name.startsWith("gemma"))
        return notSent(
            level,
            `${ROUTE_NAMES.gateway} documents no thinking setting for Gemma models such as ${modelId}.`,
        );
    if (name.startsWith("gemini-2.5")) {
        const thinkingBudget = GEMINI_25_BUDGETS[level];
        if (thinkingBudget === undefined)
            return notSent(level, `${modelId} has no "${level}" thinking.`);
        return sent(
            level,
            `google.thinkingConfig.thinkingBudget=${thinkingBudget}`,
            {
                providerOptions: {
                    google: { thinkingConfig: { thinkingBudget } },
                },
            },
        );
    }
    if (level === "none" || level === "xhigh")
        return notSent(
            level,
            level === "none"
                ? `${modelId} can't turn thinking off; its lowest level is "minimal" or "low".`
                : `${modelId} has no "xhigh" thinking level; its highest is "high".`,
        );
    return sent(level, `google.thinkingConfig.thinkingLevel=${level}`, {
        providerOptions: {
            google: { thinkingConfig: { thinkingLevel: level } },
        },
    });
}

/**
 * Whether a model refuses temperature and top-p: OpenAI reasoning models
 * (registry `reasoning`, or an o-series / GPT-5+ name the registry doesn't
 * know), and Claude 5.x / Opus 4.7+ on any route.
 */
export function rejectsSamplingSettings(modelId: string): boolean {
    if (claudeRejectsSampling(modelId)) return true;
    // A Bifrost id (`openrouter/openai/gpt-6-luna`) is its registry model.
    const entry = registryModelFor(modelId);
    if (entry) return entry.provider === "openai" && entry.reasoning;
    if (makerOfModel(modelId) !== "openai") return false;
    const bare = bareName(modelId);
    return /^o\d/.test(bare) || /^gpt-[5-9]/.test(bare);
}
