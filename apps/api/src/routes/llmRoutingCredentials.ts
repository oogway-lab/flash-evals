import type { WorkflowLlmTransport } from "@flash-evals/api-contract";
import {
    WORKFLOW_ENV_CREDENTIAL,
    type WORKFLOW_ENV_KEYS,
} from "@flash-evals/api-contract";
import { isDirectMakerTransport, type ApiKeys } from "@flash-evals/llm-core";
import { decryptSecret } from "@flash-evals/secrets";
import { ConfigError, type IApiConfig } from "../config.js";
import { ApiBadRequestError } from "../errors.js";
import { SAVED_BIFROST_URL_MISSING } from "../secrets/resolveApiKeys.js";
import {
    assertStoredProviderBaseUrl,
    type ProviderHostResolver,
} from "../providerBaseUrl.js";

export interface IStoredProviderKeyRow {
    id: string;
    provider: string;
    rotationVersion: string;
    ciphertext: string;
    iv: string;
    authTag: string;
    baseUrl: string | null;
}

/** The key model discovery uses, and how a route or step records it. */
export interface IDiscoveryCredential {
    providerKeyId: string;
    rotationVersion: string;
    apiKeys: ApiKeys;
}

const BIFROST_BASE_URL_MISSING =
    "Bifrost needs a base URL. Save the public HTTPS URL of your Bifrost OpenAI-compatible endpoint in Settings (or set BIFROST_BASE_URL in apps/api/.env), then try again.";

/**
 * The key saved in Settings, with only the address saved with it (none
 * means the provider's public default). The server's .env address pairs
 * only with the .env key, so a saved Bifrost key without one can't be used.
 */
export async function storedCredential(
    keyRow: IStoredProviderKeyRow,
    transport: WorkflowLlmTransport,
    config: IApiConfig,
    teamId: string,
    resolveHost?: ProviderHostResolver,
): Promise<IDiscoveryCredential> {
    if (transport === "bifrost" && !keyRow.baseUrl) {
        throw new ApiBadRequestError(SAVED_BIFROST_URL_MISSING);
    }
    if (!config.flashEvalsSecretsEncKey) {
        throw new ConfigError(
            "Missing required API env: FLASH_EVALS_SECRETS_ENC_KEY",
        );
    }
    const key = decryptSecret(
        keyRow,
        { teamId, provider: keyRow.provider },
        config.flashEvalsSecretsEncKey,
    );
    // A saved address is re-checked before use.
    const baseUrl = keyRow.baseUrl
        ? await assertStoredProviderBaseUrl(keyRow.baseUrl, resolveHost)
        : null;
    return {
        providerKeyId: keyRow.id,
        rotationVersion: keyRow.rotationVersion,
        apiKeys: apiKeysForStoredCredential(transport, key, baseUrl),
    };
}

/** The config fields eval runs read a transport's .env key (and address) from. */
const ENV_KEY_CONFIG_FIELDS = {
    gateway: { apiKey: "aiGatewayApiKey" },
    bifrost: { apiKey: "bifrostApiKey", baseUrl: "bifrostBaseUrl" },
} as const satisfies Record<
    keyof typeof WORKFLOW_ENV_KEYS,
    { apiKey: keyof IApiConfig; baseUrl?: keyof IApiConfig }
>;

/** The server config a pipeline step's .env key may come from. */
export type EnvKeyConfig = Pick<
    IApiConfig,
    "aiGatewayApiKey" | "bifrostApiKey" | "bifrostBaseUrl"
>;

interface IEnvKey {
    key: string;
    /** Set when the transport needs an address; undefined when it is missing. */
    baseUrl?: string;
    needsBaseUrl: boolean;
}

/** The transport's key in the server's .env, if it may use one and it is set. */
function envKeyFor(
    transport: WorkflowLlmTransport,
    config: Partial<EnvKeyConfig> | undefined,
): IEnvKey | undefined {
    const fields = (
        ENV_KEY_CONFIG_FIELDS as Partial<
            Record<
                WorkflowLlmTransport,
                { apiKey: keyof EnvKeyConfig; baseUrl?: keyof EnvKeyConfig }
            >
        >
    )[transport];
    const key = fields && config?.[fields.apiKey];
    if (!fields || !key) return undefined;
    return {
        key,
        baseUrl: fields.baseUrl ? config?.[fields.baseUrl] : undefined,
        needsBaseUrl: Boolean(fields.baseUrl),
    };
}

/**
 * Whether a Simple mode step on this transport can run with the server's .env
 * key: it may use one (WORKFLOW_ENV_KEYS) and the key (and, for Bifrost, the
 * address) is set.
 */
export function hasUsableEnvKey(
    transport: WorkflowLlmTransport,
    config: Partial<EnvKeyConfig> | undefined,
): boolean {
    const env = envKeyFor(transport, config);
    return Boolean(env && (!env.needsBaseUrl || env.baseUrl));
}

/**
 * With no key saved in Settings, a Vercel AI Gateway step uses
 * AI_GATEWAY_API_KEY and a Bifrost step BIFROST_API_KEY and BIFROST_BASE_URL
 * from the server's environment, as eval runs, the run form and Settings do.
 * It records no key id (see WORKFLOW_ENV_CREDENTIAL). Undefined when the
 * environment has no key for the transport, or a saved key was asked for by id.
 */
export function envCredential(
    transport: WorkflowLlmTransport,
    config: Partial<EnvKeyConfig>,
    providerKeyId: string | undefined,
): IDiscoveryCredential | undefined {
    const env = envKeyFor(transport, config);
    if (!env || providerKeyId) return undefined;
    if (env.needsBaseUrl && !env.baseUrl)
        throw new ApiBadRequestError(BIFROST_BASE_URL_MISSING);
    return {
        providerKeyId: WORKFLOW_ENV_CREDENTIAL.providerKeyId,
        rotationVersion: WORKFLOW_ENV_CREDENTIAL.rotationVersion,
        apiKeys: apiKeysForStoredCredential(
            transport,
            env.key,
            env.baseUrl ?? null,
        ),
    };
}

function apiKeysForStoredCredential(
    transport: WorkflowLlmTransport,
    key: string,
    baseUrl: string | null,
): ApiKeys {
    if (transport === "openai") return { openai: key };
    if (transport === "gateway") return { gateway: key };
    if (transport === "openrouter") {
        return {
            openrouter: key,
            ...(baseUrl ? { openrouterBaseUrl: baseUrl } : {}),
        };
    }
    if (isDirectMakerTransport(transport)) return { [transport]: key };
    return {
        bifrost: key,
        ...(baseUrl ? { bifrostBaseUrl: baseUrl } : {}),
    };
}
