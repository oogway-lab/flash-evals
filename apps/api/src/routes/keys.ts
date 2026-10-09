import { isProviderKeyProvider } from "@mosaic/api-contract";
import type {
    IClearProviderKeyRequest,
    IListProviderKeysResponse,
    ISetProviderKeyRequest,
    ProviderKeyProvider,
} from "@mosaic/api-contract";
import { encryptSecret, maskHint } from "@mosaic/secrets";
import { withTransaction, type IDb } from "../db.js";
import { ApiBadRequestError } from "../errors.js";
import {
    normalizedProviderBaseUrl,
    resolveHostAddresses,
    type ProviderHostResolver,
} from "../providerBaseUrl.js";
import { sttModelIdsForProviderKey } from "../sttModels.js";

const UUID_PATTERN =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface IProviderKeyMetadataRow {
    id: string;
    provider: ProviderKeyProvider;
    hint: string;
    base_url: string | null;
}

export async function setProviderKeyPayload(
    db: IDb,
    encryptionKey: string | undefined,
    input: ISetProviderKeyRequest,
    resolveHost: ProviderHostResolver = resolveHostAddresses,
): Promise<void> {
    validateTeamId(input.teamId);
    validateProvider(input.provider);
    if (typeof input.key !== "string" || input.key.trim().length === 0) {
        throw new ApiBadRequestError("key is required");
    }
    const baseUrl = await normalizedProviderBaseUrl(input.baseUrl, resolveHost);
    if (input.provider === "bifrost" && !baseUrl) {
        throw new ApiBadRequestError(
            "baseUrl is required for Bifrost. Enter the public HTTPS URL of your Bifrost OpenAI-compatible endpoint.",
        );
    }
    const encrypted = encryptSecret(
        input.key,
        { teamId: input.teamId, provider: input.provider },
        encryptionKey,
    );
    await withTransaction(db, async (tx) => {
        await tx.query(
            `insert into provider_keys (
            team_id,
            provider,
            ciphertext,
            iv,
            auth_tag,
            base_url,
            hint
        ) values ($1, $2, $3, $4, $5, $6, $7)
        on conflict (team_id, provider) do update set
            ciphertext = excluded.ciphertext,
            iv = excluded.iv,
            auth_tag = excluded.auth_tag,
            base_url = excluded.base_url,
            hint = excluded.hint,
            rotation_version = gen_random_uuid()`,
            [
                input.teamId,
                input.provider,
                encrypted.ciphertext,
                encrypted.iv,
                encrypted.authTag,
                baseUrl,
                maskHint(input.key),
            ],
        );
        await invalidateProviderProbes(tx, input.teamId, input.provider);
    });
}

export async function listProviderKeysPayload(
    db: IDb,
    teamId: string,
): Promise<IListProviderKeysResponse> {
    validateTeamId(teamId);
    const result = await db.query<IProviderKeyMetadataRow>(
        `select id, provider, hint, base_url
        from provider_keys
        where team_id = $1
        order by provider`,
        [teamId],
    );
    return result.rows.map((row) => ({
        id: row.id,
        provider: row.provider,
        hint: row.hint,
        ...(row.base_url ? { baseUrl: row.base_url } : {}),
    }));
}

export async function clearProviderKeyPayload(
    db: IDb,
    input: IClearProviderKeyRequest,
): Promise<void> {
    validateTeamId(input.teamId);
    validateProvider(input.provider);
    await withTransaction(db, async (tx) => {
        await tx.query(
            "delete from provider_keys where team_id = $1 and provider = $2",
            [input.teamId, input.provider],
        );
        await invalidateProviderProbes(tx, input.teamId, input.provider);
    });
}

async function invalidateProviderProbes(
    db: IDb,
    teamId: string,
    provider: ProviderKeyProvider,
): Promise<void> {
    await db.query(
        "delete from stt_route_probes where team_id = $1 and model_id = any($2::text[])",
        [teamId, sttModelIdsForProviderKey(provider)],
    );
}

function validateTeamId(teamId: string): void {
    if (typeof teamId !== "string" || !UUID_PATTERN.test(teamId)) {
        throw new ApiBadRequestError("teamId must be a valid UUID");
    }
}

function validateProvider(
    provider: string,
): asserts provider is ProviderKeyProvider {
    if (!isProviderKeyProvider(provider)) {
        throw new ApiBadRequestError("provider is not supported");
    }
}
