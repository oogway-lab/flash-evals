export interface ISttProviderKeys {
    openai?: string;
    vercelGateway?: string;
    soniox?: string;
    gemini?: string;
    openrouter?: string;
    openrouterBaseUrl?: string;
    bifrost?: string;
    bifrostBaseUrl?: string;
}

export function sttProviderKeysFromEnv(
    env: Record<string, string | undefined> = process.env,
): ISttProviderKeys {
    return {
        openai: emptyToUndefined(env.OPENAI_API_KEY),
        vercelGateway: emptyToUndefined(env.AI_GATEWAY_API_KEY),
        soniox: emptyToUndefined(env.SONIOX_API_KEY),
        gemini: emptyToUndefined(env.GEMINI_API_KEY),
        openrouter: emptyToUndefined(env.OPENROUTER_API_KEY),
        openrouterBaseUrl: emptyToUndefined(env.OPENROUTER_BASE_URL),
        bifrost: emptyToUndefined(env.BIFROST_API_KEY),
        bifrostBaseUrl: emptyToUndefined(env.BIFROST_BASE_URL),
    };
}

function emptyToUndefined(value: string | undefined): string | undefined {
    const trimmed = value?.trim();
    return trimmed ? trimmed : undefined;
}
