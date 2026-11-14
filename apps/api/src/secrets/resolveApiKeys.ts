import {
    OpenAIEvalProvider,
    type ApiKeys,
    type IEvalProviderOptions,
} from "@flash-evals/llm-core";
import { decryptSecret } from "@flash-evals/secrets";
import { ConfigError, type IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import {
    assertStoredProviderBaseUrl,
    type ProviderHostResolver,
} from "../providerBaseUrl.js";

export interface ISttProviderKeys {
    openai?: string;
    vercelGateway?: string;
    soniox?: string;
    elevenlabs?: string;
    gemini?: string;
    openrouter?: string;
    openrouterBaseUrl?: string;
    bifrost?: string;
    bifrostBaseUrl?: string;
}

export interface IResolvedProviderKeys {
    apiKeys: ApiKeys;
    sttProviderKeys: ISttProviderKeys;
    /**
     * Base URLs saved by the team (operator env URLs are not included). They
     * are re-validated only right before a request is sent to one: see
     * {@link assertTeamBaseUrl}.
     */
    storedBaseUrls: ReadonlySet<string>;
}

interface IProviderKeyRow {
    provider:
        | "openai"
        | "gateway"
        | "soniox"
        | "elevenlabs"
        | "openrouter"
        | "bifrost"
        | "gemini"
        | "anthropic";
    ciphertext: string;
    iv: string;
    authTag: string;
    baseUrl: string | null;
}

export async function resolveApiKeys(
    db: IDb,
    config: IApiConfig,
    teamId?: string,
): Promise<IResolvedProviderKeys> {
    if (!teamId) return resolvedKeys(new Map(), config);

    const result = await db.query<IProviderKeyRow>(
        `select provider, ciphertext, iv, auth_tag as "authTag", base_url as "baseUrl"
        from provider_keys
        where team_id = $1`,
        [teamId],
    );
    if (result.rows.length === 0) return resolvedKeys(new Map(), config);

    const encryptionKey = config.flashEvalsSecretsEncKey;
    if (!encryptionKey) {
        throw new ConfigError(
            "Missing required API env: FLASH_EVALS_SECRETS_ENC_KEY",
        );
    }
    const stored = new Map(
        result.rows.map((row) => [
            row.provider,
            {
                key: decryptSecret(
                    row,
                    { teamId, provider: row.provider },
                    encryptionKey,
                ),
                baseUrl: row.baseUrl ?? undefined,
            },
        ]),
    );
    return resolvedKeys(stored, config);
}

/**
 * Re-validate a team-saved base URL right before a request is sent to it, so
 * a DNS change after save cannot point provider calls at a private address.
 * Operator env URLs are trusted and skipped, and providers that are not used
 * are never looked up.
 *
 * Matching is by origin, not the exact string: clients send to a derived URL
 * (Bifrost adds `/v1` to an address saved without it), and DNS is per host.
 */
export async function assertTeamBaseUrl(
    resolved: IResolvedProviderKeys,
    baseUrl: string | undefined,
    resolveHost?: ProviderHostResolver,
): Promise<void> {
    if (!baseUrl) return;
    const origin = urlOrigin(baseUrl);
    const stored = [...resolved.storedBaseUrls].find(
        (url) => url === baseUrl || (origin && urlOrigin(url) === origin),
    );
    if (stored) await assertStoredProviderBaseUrl(stored, resolveHost);
}

function urlOrigin(url: string): string | undefined {
    try {
        const { origin } = new URL(url);
        return origin === "null" ? undefined : origin;
    } catch {
        return undefined;
    }
}

/**
 * `availableModelOptions` hook that re-validates a team-saved base URL before
 * that transport's live model listing is fetched.
 */
export function teamBaseUrlListingGuard(
    resolved: IResolvedProviderKeys,
    resolveHost?: ProviderHostResolver,
): (transport: string) => Promise<void> {
    return (transport) =>
        assertTeamBaseUrl(
            resolved,
            transport === "openrouter"
                ? resolved.apiKeys.openrouterBaseUrl
                : transport === "bifrost"
                  ? resolved.apiKeys.bifrostBaseUrl
                  : undefined,
            resolveHost,
        );
}

/**
 * `getEvalProvider` options that re-validate a team-saved OpenRouter or
 * Bifrost base URL before each completion request to it.
 */
export function teamBaseUrlProviderOptions(
    resolved: IResolvedProviderKeys,
    resolveHost?: ProviderHostResolver,
): Pick<IEvalProviderOptions, "createOpenAICompatibleProvider"> {
    return {
        createOpenAICompatibleProvider: (apiKey, options) => {
            const provider = new OpenAIEvalProvider(apiKey, options);
            return {
                async complete(req) {
                    await assertTeamBaseUrl(
                        resolved,
                        options.baseURL,
                        resolveHost,
                    );
                    return provider.complete(req);
                },
            };
        },
    };
}

export const SAVED_BIFROST_URL_MISSING =
    "The Bifrost key saved in Settings has no base URL. Save the public HTTPS URL of your Bifrost endpoint with it in Settings, then try again.";

function resolvedKeys(
    stored: Map<string, { key: string; baseUrl?: string }>,
    config: IApiConfig,
): IResolvedProviderKeys {
    const openai = stored.get("openai")?.key ?? config.openaiApiKey;
    const gateway = stored.get("gateway")?.key ?? config.aiGatewayApiKey;
    const { soniox, elevenlabs, gemini } = sttOnlyKeys(stored, config);
    const openrouterRow = stored.get("openrouter");
    const bifrostRow = stored.get("bifrost");
    const openrouter = openrouterRow?.key ?? config.openrouterApiKey;
    // A saved key keeps its own URL (none means the provider's public
    // default); the .env URL pairs only with the .env key. Bifrost has no
    // public default, so a saved Bifrost key without a URL is left out
    // (no .env fallback) and a Bifrost call says why.
    const bifrostUnusable = bifrostRow !== undefined && !bifrostRow.baseUrl;
    const bifrost = bifrostUnusable
        ? undefined
        : (bifrostRow?.key ?? config.bifrostApiKey);
    const openrouterBaseUrl = openrouterRow
        ? openrouterRow.baseUrl
        : config.openrouterBaseUrl;
    const bifrostBaseUrl = bifrostRow
        ? bifrostRow.baseUrl
        : config.bifrostBaseUrl;
    return {
        apiKeys: {
            openai,
            gateway,
            openrouter,
            openrouterBaseUrl,
            bifrost,
            bifrostBaseUrl,
            ...directMakerKeys(stored),
            ...(bifrostUnusable
                ? { unusable: { bifrost: SAVED_BIFROST_URL_MISSING } }
                : {}),
        },
        sttProviderKeys: {
            openai,
            vercelGateway: gateway,
            soniox,
            elevenlabs,
            gemini,
            openrouter,
            openrouterBaseUrl,
            bifrost,
            bifrostBaseUrl,
        },
        storedBaseUrls: new Set(
            [...stored.values()].flatMap(({ baseUrl }) =>
                baseUrl ? [baseUrl] : [],
            ),
        ),
    };
}

/** Speech-to-text-only keys: a key saved in Settings wins over .env. */
function sttOnlyKeys(
    stored: Map<string, { key: string }>,
    config: IApiConfig,
): Pick<ISttProviderKeys, "soniox" | "elevenlabs" | "gemini"> {
    return {
        soniox: stored.get("soniox")?.key ?? config.sonioxApiKey,
        elevenlabs: stored.get("elevenlabs")?.key ?? config.elevenlabsApiKey,
        gemini: stored.get("gemini")?.key ?? config.geminiApiKey,
    };
}

/**
 * Direct maker keys come from Settings only, never from .env, so a key
 * exported in a shell can't end up paying for a team's runs. Direct Google
 * calls use the saved Gemini key.
 */
function directMakerKeys(
    stored: Map<string, { key: string }>,
): Pick<ApiKeys, "anthropic" | "google"> {
    const anthropic = stored.get("anthropic")?.key;
    const google = stored.get("gemini")?.key;
    return {
        ...(anthropic ? { anthropic } : {}),
        ...(google ? { google } : {}),
    };
}
