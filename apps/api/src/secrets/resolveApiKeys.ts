import {
    OpenAIEvalProvider,
    type ApiKeys,
    type IEvalProviderOptions,
} from "@mosaic/llm-core";
import { decryptSecret } from "@mosaic/secrets";
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
        "openai" | "gateway" | "soniox" | "openrouter" | "bifrost" | "gemini";
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

    const encryptionKey = config.mosaicSecretsEncKey;
    if (!encryptionKey) {
        throw new ConfigError(
            "Missing required API env: MOSAIC_SECRETS_ENC_KEY",
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
 */
export async function assertTeamBaseUrl(
    resolved: IResolvedProviderKeys,
    baseUrl: string | undefined,
    resolveHost?: ProviderHostResolver,
): Promise<void> {
    if (baseUrl && resolved.storedBaseUrls.has(baseUrl)) {
        await assertStoredProviderBaseUrl(baseUrl, resolveHost);
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

function resolvedKeys(
    stored: Map<string, { key: string; baseUrl?: string }>,
    config: IApiConfig,
): IResolvedProviderKeys {
    const openai = stored.get("openai")?.key ?? config.openaiApiKey;
    const gateway = stored.get("gateway")?.key ?? config.aiGatewayApiKey;
    const soniox = stored.get("soniox")?.key ?? config.sonioxApiKey;
    const gemini = stored.get("gemini")?.key ?? config.geminiApiKey;
    const openrouterRow = stored.get("openrouter");
    const bifrostRow = stored.get("bifrost");
    const openrouter = openrouterRow?.key ?? config.openrouterApiKey;
    const bifrost = bifrostRow?.key ?? config.bifrostApiKey;
    const openrouterBaseUrl =
        openrouterRow?.baseUrl ?? config.openrouterBaseUrl;
    const bifrostBaseUrl = bifrostRow?.baseUrl ?? config.bifrostBaseUrl;
    return {
        apiKeys: {
            openai,
            gateway,
            openrouter,
            openrouterBaseUrl,
            bifrost,
            bifrostBaseUrl,
        },
        sttProviderKeys: {
            openai,
            vercelGateway: gateway,
            soniox,
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
