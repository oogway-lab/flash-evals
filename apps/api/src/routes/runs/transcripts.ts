import { createHash } from "node:crypto";
import {
    canonicalJsonString,
    sttModelIdentityForId,
    type IRunAudioTranscriptSummary,
    type IRunAudioTranscriptVariantSummary,
    type IRunDetailItem,
    type ISttRunConfig,
} from "@mosaic/api-contract";
import type { IDb } from "../../db.js";

interface IAudioTranscriptDbRow {
    id: string;
    dataset_item_id: string;
    storage_key: string;
    provider_id: string;
    route_id: string;
    stt_model_id: string;
    canonical_model_id: string;
    language: string;
    config_json: unknown;
    transcript: string;
    raw_text: string | null;
    normalized_text: string | null;
    detected_language: string | null;
    segments_json: unknown;
    speakers_json: unknown;
    provider_metadata: unknown;
    warnings: unknown;
    status: string;
    error: string | null;
    created_at: Date | string;
}

interface IAudioTranscriptVariantDbRow {
    id: string;
    dataset_item_id: string;
    storage_key: string;
    source_transcript_hash: string;
    variant_kind: string;
    target_script: string;
    target_language: string;
    model_id: string;
    transcript: string;
    provider_metadata: unknown;
    status: string;
    error: string | null;
    created_at: Date | string;
}

export async function audioTranscriptPayload(
    db: IDb,
    items: IRunDetailItem[],
    sttConfigs: ISttRunConfig[] = [],
): Promise<IRunAudioTranscriptSummary[]> {
    const audioItemIds = items.filter(isAudioRunItem).map((item) => item.id);
    if (audioItemIds.length === 0) return [];
    const selectedIdentities = sttConfigs.map(sttIdentityFromConfig);
    const selectedIdentity =
        selectedIdentities.length === 1 ? selectedIdentities[0] : undefined;

    const transcriptQuery = selectedIdentity
        ? db.query<IAudioTranscriptDbRow>(
              `select
                id, dataset_item_id, storage_key, provider_id, route_id,
                stt_model_id, canonical_model_id, language, config_json,
                transcript, raw_text, normalized_text, detected_language,
                segments_json, speakers_json, provider_metadata, warnings,
                status, error, created_at
            from audio_transcripts
            where dataset_item_id = any($1::uuid[])
                and provider_id = $2
                and route_id = $3
                and canonical_model_id = $4
                and language = $5
                and config_hash = $6
            order by created_at desc`,
              [
                  audioItemIds,
                  selectedIdentity.providerId,
                  selectedIdentity.routeId,
                  selectedIdentity.canonicalModelId,
                  selectedIdentity.language,
                  selectedIdentity.configHash,
              ],
          )
        : db.query<IAudioTranscriptDbRow>(
              `select
                id, dataset_item_id, storage_key, provider_id, route_id,
                stt_model_id, canonical_model_id, language, config_json,
                transcript, raw_text, normalized_text, detected_language,
                segments_json, speakers_json, provider_metadata, warnings,
                status, error, created_at
            from audio_transcripts
            where dataset_item_id = any($1::uuid[])
            order by created_at desc`,
              [audioItemIds],
          );

    const [transcriptResult, variantResult] = await Promise.all([
        transcriptQuery,
        db.query<IAudioTranscriptVariantDbRow>(
            `select
                id, dataset_item_id, storage_key, source_transcript_hash,
                variant_kind, target_script, target_language, model_id,
                transcript, provider_metadata, status, error, created_at
            from audio_transcript_variants
            where dataset_item_id = any($1::uuid[])
            order by created_at desc`,
            [audioItemIds],
        ),
    ]);

    const variantsByItemAndStorage = new Map<
        string,
        IRunAudioTranscriptVariantSummary[]
    >();
    for (const row of variantResult.rows) {
        const key = audioTranscriptKey(
            row.dataset_item_id,
            row.storage_key,
            row.source_transcript_hash,
        );
        const variants = variantsByItemAndStorage.get(key) ?? [];
        variants.push({
            id: row.id,
            datasetItemId: row.dataset_item_id,
            storageKey: row.storage_key,
            sourceTranscriptHash: row.source_transcript_hash,
            variantKind: row.variant_kind,
            targetScript: row.target_script,
            targetLanguage: row.target_language,
            modelId: row.model_id,
            transcript: row.transcript,
            providerMetadata: row.provider_metadata,
            status: row.status,
            error: row.error,
            createdAt: isoDate(row.created_at),
        });
        variantsByItemAndStorage.set(key, variants);
    }

    return transcriptResult.rows
        .filter(
            (row) =>
                selectedIdentities.length === 0 ||
                selectedIdentities.some((identity) =>
                    transcriptMatchesIdentity(row, identity),
                ),
        )
        .map((row) => ({
            id: row.id,
            datasetItemId: row.dataset_item_id,
            storageKey: row.storage_key,
            providerId: row.provider_id,
            routeId: row.route_id,
            sttModelId: row.stt_model_id,
            canonicalModelId: row.canonical_model_id,
            language: row.language,
            configJson: isRecord(row.config_json) ? row.config_json : {},
            transcript: row.transcript,
            rawText: row.raw_text,
            normalizedText: row.normalized_text,
            detectedLanguage: row.detected_language,
            segments: transcriptSegments(row.segments_json),
            speakers: transcriptSpeakers(row.speakers_json),
            providerMetadata: row.provider_metadata,
            warnings: stringArray(row.warnings),
            status: row.status,
            error: row.error,
            createdAt: isoDate(row.created_at),
            variants:
                variantsByItemAndStorage.get(
                    audioTranscriptKey(
                        row.dataset_item_id,
                        row.storage_key,
                        hash(row.transcript),
                    ),
                ) ?? [],
        }));
}

export function sttConfigFromRunSnapshot(
    snapshot: unknown,
): ISttRunConfig | undefined {
    if (!isRecord(snapshot)) return undefined;
    const config = snapshot.sttConfig;
    return isRecord(config) && typeof config.modelId === "string"
        ? (config as unknown as ISttRunConfig)
        : undefined;
}

export function sttConfigsFromRunSnapshot(snapshot: unknown): ISttRunConfig[] {
    if (!isRecord(snapshot)) return [];
    if (isRecord(snapshot.sttVariants)) {
        return Object.values(snapshot.sttVariants).flatMap((variant) => {
            if (!isRecord(variant) || !isRecord(variant.config)) return [];
            return typeof variant.config.modelId === "string"
                ? [variant.config as unknown as ISttRunConfig]
                : [];
        });
    }
    const legacy = sttConfigFromRunSnapshot(snapshot);
    return legacy ? [legacy] : [];
}

function audioTranscriptKey(
    datasetItemId: string,
    storageKey: string,
    sourceTranscriptHash: string,
): string {
    return `${datasetItemId}:${storageKey}:${sourceTranscriptHash}`;
}

function isAudioRunItem(item: IRunDetailItem): boolean {
    return (
        item.type === "audio" || item.mimeType?.startsWith("audio/") === true
    );
}

function sttIdentityFromConfig(sttConfig: ISttRunConfig) {
    return {
        ...sttModelIdentityForId(sttConfig.modelId),
        language: normalizeLanguage(sttConfig.language),
        configHash: stableConfigHash(sttConfig.config),
    };
}

function transcriptMatchesIdentity(
    row: IAudioTranscriptDbRow,
    identity: ReturnType<typeof sttIdentityFromConfig>,
): boolean {
    return (
        row.provider_id === identity.providerId &&
        row.route_id === identity.routeId &&
        row.canonical_model_id === identity.canonicalModelId &&
        row.language === identity.language &&
        hashStableConfig(row.config_json) === identity.configHash
    );
}

function stableConfigHash(config: unknown): string {
    return hash(canonicalJsonString(isRecord(config) ? config : {}));
}

function hashStableConfig(config: unknown): string {
    return stableConfigHash(isRecord(config) ? config : {});
}

function normalizeLanguage(language: string | undefined): string {
    return language?.trim().toLowerCase() ?? "";
}

function hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function transcriptSegments(
    value: unknown,
): IRunAudioTranscriptSummary["segments"] {
    return Array.isArray(value) ? value.filter(isTranscriptSegment) : [];
}

function isTranscriptSegment(
    value: unknown,
): value is IRunAudioTranscriptSummary["segments"][number] {
    return (
        isRecord(value) &&
        typeof value.text === "string" &&
        (value.startMs === undefined || typeof value.startMs === "number") &&
        (value.endMs === undefined || typeof value.endMs === "number") &&
        (value.speaker === undefined || typeof value.speaker === "string") &&
        (value.language === undefined || typeof value.language === "string")
    );
}

function transcriptSpeakers(
    value: unknown,
): IRunAudioTranscriptSummary["speakers"] {
    return Array.isArray(value) ? value.filter(isTranscriptSpeaker) : [];
}

function isTranscriptSpeaker(
    value: unknown,
): value is IRunAudioTranscriptSummary["speakers"][number] {
    return (
        isRecord(value) &&
        typeof value.id === "string" &&
        (value.label === undefined || typeof value.label === "string")
    );
}

function stringArray(value: unknown): string[] {
    return Array.isArray(value) &&
        value.every((item) => typeof item === "string")
        ? value
        : [];
}

function isoDate(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
