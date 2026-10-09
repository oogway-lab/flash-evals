import type { ApiKeys } from "@mosaic/llm-core";

export function apiKeysFromEnv(
    env: Record<string, string | undefined> = process.env,
): ApiKeys {
    return {
        openai: env.OPENAI_API_KEY,
        gateway: env.AI_GATEWAY_API_KEY,
        openrouter: env.OPENROUTER_API_KEY,
        openrouterBaseUrl: env.OPENROUTER_BASE_URL,
        bifrost: env.BIFROST_API_KEY,
        bifrostBaseUrl: env.BIFROST_BASE_URL,
    };
}
