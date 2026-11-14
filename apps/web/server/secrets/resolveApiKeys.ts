import type { ApiKeys } from "@flash-evals/llm-core";
import {
    checkPublicProviderBaseUrl,
    ProviderBaseUrlError,
    resolveHostAddresses,
    type ProviderHostResolver,
} from "@flash-evals/llm-core/public-base-url";
import { decryptSecret } from "@flash-evals/secrets";
import { eq } from "drizzle-orm";
import type { ISttProviderKeys } from "../audio/providerKeys";
import { db } from "../db/client";
import { providerKeys } from "../db/schema";
import { apiKeysFromEnv } from "../llm/apiKeys";
import { sttProviderKeysFromEnv } from "../audio/providerKeys";

export interface IResolvedProviderKeys {
    apiKeys: ApiKeys;
    sttProviderKeys: ISttProviderKeys;
}

export async function resolveApiKeys(
    teamId?: string,
    options: {
        env?: Record<string, string | undefined>;
        encryptionKey?: string;
        resolveHost?: ProviderHostResolver;
    } = {},
): Promise<IResolvedProviderKeys> {
    const env = options.env ?? process.env;
    const encryptionKey =
        options.encryptionKey ?? env.FLASH_EVALS_SECRETS_ENC_KEY;
    const fallbackApiKeys = apiKeysFromEnv(env);
    const fallbackSttKeys = sttProviderKeysFromEnv(env);
    if (!teamId) {
        return resolvedKeys(new Map(), fallbackApiKeys, fallbackSttKeys);
    }
    const rows = await db
        .select()
        .from(providerKeys)
        .where(eq(providerKeys.teamId, teamId));
    if (rows.length === 0) {
        return resolvedKeys(new Map(), fallbackApiKeys, fallbackSttKeys);
    }
    if (!encryptionKey) {
        throw new Error(
            "FLASH_EVALS_SECRETS_ENC_KEY is required for stored provider keys.",
        );
    }
    const unusableProviders = new Set<string>();
    const stored = new Map(
        rows.map((row) => [
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
    const unusable: NonNullable<ApiKeys["unusable"]> = {};
    for (const [provider, { baseUrl }] of stored) {
        const reason = baseUrl
            ? await savedBaseUrlProblem(
                  baseUrl,
                  options.resolveHost ?? resolveHostAddresses,
              )
            : missingSavedBaseUrlProblem(provider);
        if (!reason) continue;
        // Only a run that calls this provider fails; its key is left out
        // (no .env fallback) so it is never sent to that address.
        stored.delete(provider);
        if (provider === "openrouter" || provider === "bifrost")
            unusable[provider] = reason;
        unusableProviders.add(provider);
    }
    return resolvedKeys(
        stored,
        fallbackApiKeys,
        fallbackSttKeys,
        unusable,
        unusableProviders,
    );
}

/**
 * A Settings key goes only to its own saved URL or the provider's public
 * default, never to the .env address. Bifrost has no public default, so a
 * saved Bifrost key without a URL can't be used.
 */
function missingSavedBaseUrlProblem(provider: string): string | undefined {
    return provider === "bifrost" ? SAVED_BIFROST_URL_MISSING : undefined;
}

export const SAVED_BIFROST_URL_MISSING =
    "The Bifrost key saved in Settings has no base URL. Save the public HTTPS URL of your Bifrost endpoint with it in Settings, then try again.";

/**
 * A base URL saved in Settings was checked when saved, but DNS can change
 * since (rebinding); check it again before the worker sends a team's key
 * there, as the API does before its own calls. .env URLs are the
 * operator's and are not checked. Returns why it can't be used, if so.
 */
async function savedBaseUrlProblem(
    baseUrl: string,
    resolveHost: ProviderHostResolver,
): Promise<string | undefined> {
    try {
        await checkPublicProviderBaseUrl(baseUrl, resolveHost);
        return undefined;
    } catch (err) {
        if (!(err instanceof ProviderBaseUrlError)) throw err;
        return err.kind === "lookup"
            ? "The saved provider base URL could not be resolved right now. Try again."
            : `The saved provider base URL is no longer allowed (${err.message}). Update it in Settings, then try again.`;
    }
}

function resolvedKeys(
    stored: Map<string, { key: string; baseUrl?: string }>,
    envApiKeys: ApiKeys,
    envSttKeys: ISttProviderKeys,
    unusable: ApiKeys["unusable"] = {},
    unusableProviders: ReadonlySet<string> = new Set(),
): IResolvedProviderKeys {
    // A provider whose saved base URL failed its check gets no .env key.
    const fallbackApiKeys: ApiKeys = withoutProviders(
        envApiKeys,
        unusableProviders,
    );
    const fallbackSttKeys: ISttProviderKeys = withoutProviders(
        envSttKeys,
        unusableProviders,
    );
    const openai = stored.get("openai")?.key ?? fallbackApiKeys.openai;
    const gateway = stored.get("gateway")?.key ?? fallbackApiKeys.gateway;
    const { soniox, elevenlabs, gemini } = sttOnlyKeys(stored, fallbackSttKeys);
    const openrouterRow = stored.get("openrouter");
    const bifrostRow = stored.get("bifrost");
    const openrouter = openrouterRow?.key ?? fallbackApiKeys.openrouter;
    const bifrost = bifrostRow?.key ?? fallbackApiKeys.bifrost;
    // A saved key keeps its own URL (none means the provider's public
    // default); the .env URL pairs only with the .env key.
    const openrouterBaseUrl = openrouterRow
        ? openrouterRow.baseUrl
        : fallbackApiKeys.openrouterBaseUrl;
    const bifrostBaseUrl = bifrostRow
        ? bifrostRow.baseUrl
        : fallbackApiKeys.bifrostBaseUrl;
    return {
        apiKeys: {
            openai,
            gateway,
            openrouter,
            openrouterBaseUrl,
            bifrost,
            bifrostBaseUrl,
            ...directMakerKeys(stored),
            ...(Object.keys(unusable).length > 0 ? { unusable } : {}),
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
    };
}

/** Drops a provider's key and base URL (named as in Settings rows). */
function withoutProviders<T extends object>(
    keys: T,
    providers: ReadonlySet<string>,
): T {
    if (providers.size === 0) return keys;
    const copy = { ...keys } as Record<string, unknown>;
    for (const provider of providers) {
        delete copy[provider];
        delete copy[`${provider}BaseUrl`];
        if (provider === "gateway") delete copy.vercelGateway;
    }
    return copy as T;
}

/** Speech-to-text-only keys: a key saved in Settings wins over .env. */
function sttOnlyKeys(
    stored: Map<string, { key: string }>,
    fallback: ISttProviderKeys,
): Pick<ISttProviderKeys, "soniox" | "elevenlabs" | "gemini"> {
    return {
        soniox: stored.get("soniox")?.key ?? fallback.soniox,
        elevenlabs: stored.get("elevenlabs")?.key ?? fallback.elevenlabs,
        gemini: stored.get("gemini")?.key ?? fallback.gemini,
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
