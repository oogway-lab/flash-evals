import type { ApiKeys } from "@mosaic/llm-core";
import { decryptSecret } from "@mosaic/secrets";
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
    } = {},
): Promise<IResolvedProviderKeys> {
    const env = options.env ?? process.env;
    const encryptionKey = options.encryptionKey ?? env.MOSAIC_SECRETS_ENC_KEY;
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
            "MOSAIC_SECRETS_ENC_KEY is required for stored provider keys.",
        );
    }
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
    return resolvedKeys(stored, fallbackApiKeys, fallbackSttKeys);
}

function resolvedKeys(
    stored: Map<string, { key: string; baseUrl?: string }>,
    fallbackApiKeys: ApiKeys,
    fallbackSttKeys: ISttProviderKeys,
): IResolvedProviderKeys {
    const openai = stored.get("openai")?.key ?? fallbackApiKeys.openai;
    const gateway = stored.get("gateway")?.key ?? fallbackApiKeys.gateway;
    const soniox = stored.get("soniox")?.key ?? fallbackSttKeys.soniox;
    const gemini = stored.get("gemini")?.key ?? fallbackSttKeys.gemini;
    const openrouterRow = stored.get("openrouter");
    const bifrostRow = stored.get("bifrost");
    const openrouter = openrouterRow?.key ?? fallbackApiKeys.openrouter;
    const bifrost = bifrostRow?.key ?? fallbackApiKeys.bifrost;
    const openrouterBaseUrl =
        openrouterRow?.baseUrl ?? fallbackApiKeys.openrouterBaseUrl;
    const bifrostBaseUrl =
        bifrostRow?.baseUrl ?? fallbackApiKeys.bifrostBaseUrl;
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
    };
}
