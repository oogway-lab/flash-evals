import { createHash } from "crypto";
import {
    canonicalJsonObject,
    canonicalJsonString,
    sttCostUsdForDuration,
    sttModelIdentityForId,
} from "@mosaic/api-contract";
import { and, eq } from "drizzle-orm";
import { errorMessage } from "../../lib/errors";
import { db } from "../../db/client";
import { audioTranscripts } from "../../db/schema";
import { normalizeTranscript } from "../metrics";
import type { ITranscriptArtifact, ITranscriptIdentity } from "./types";

export function transcriptIdentity(
    modelId: string,
    config: Record<string, unknown> | undefined,
): ITranscriptIdentity {
    const configJson = canonicalJsonObject(config ?? {});
    return {
        ...sttModelIdentityForId(modelId),
        configHash: createHash("sha256")
            .update(canonicalJsonString(configJson))
            .digest("hex"),
        configJson,
    };
}

export async function readCachedTranscript(input: {
    datasetItemId: string;
    storageKey: string;
    identity: ITranscriptIdentity;
    language: string | undefined;
}): Promise<ITranscriptArtifact | undefined> {
    const rows = await db
        .select({
            transcript: audioTranscripts.transcript,
            segmentsJson: audioTranscripts.segmentsJson,
            speakersJson: audioTranscripts.speakersJson,
            providerMetadata: audioTranscripts.providerMetadata,
            warnings: audioTranscripts.warnings,
            detectedLanguage: audioTranscripts.detectedLanguage,
        })
        .from(audioTranscripts)
        .where(
            and(
                eq(audioTranscripts.datasetItemId, input.datasetItemId),
                eq(audioTranscripts.storageKey, input.storageKey),
                eq(audioTranscripts.providerId, input.identity.providerId),
                eq(audioTranscripts.routeId, input.identity.routeId),
                eq(
                    audioTranscripts.canonicalModelId,
                    input.identity.canonicalModelId,
                ),
                eq(audioTranscripts.language, cacheLanguage(input.language)),
                eq(audioTranscripts.configHash, input.identity.configHash),
                eq(audioTranscripts.status, "completed"),
            ),
        )
        .limit(1);
    const row = rows[0];
    if (!row?.transcript) return undefined;
    return {
        text: row.transcript,
        segments: row.segmentsJson ?? [],
        speakers: row.speakersJson ?? [],
        providerMetadata: row.providerMetadata ?? undefined,
        warnings: row.warnings ?? [],
        detectedLanguage: row.detectedLanguage ?? undefined,
    };
}

export async function writeCompletedTranscriptArtifact(input: {
    datasetItemId: string;
    storageKey: string;
    modelId: string;
    language: string | undefined;
    identity: ITranscriptIdentity;
    artifact: ITranscriptArtifact;
    latencyMsTotal: number;
}): Promise<ITranscriptArtifact> {
    const costUsd = sttCostUsdForDuration(
        input.modelId,
        input.artifact.durationMs,
    );
    const providerMetadata = {
        provider: input.identity.providerId,
        route: input.identity.routeId,
        model: input.identity.canonicalModelId,
        configHash: input.identity.configHash,
        latencyMsTotal: input.latencyMsTotal,
        ...(input.artifact.durationMs !== undefined
            ? { audioDurationMs: input.artifact.durationMs }
            : {}),
        ...(costUsd !== undefined
            ? { costUsd, costSource: "computed" as const }
            : { costSource: "unavailable" as const }),
        ...input.artifact.providerMetadata,
    };
    const completedValues = {
        transcript: input.artifact.text,
        rawText: input.artifact.text,
        normalizedText: normalizeTranscript(input.artifact.text),
        detectedLanguage: input.artifact.detectedLanguage ?? input.language,
        providerMetadata,
        segmentsJson: input.artifact.segments,
        speakersJson: input.artifact.speakers,
        warnings: input.artifact.warnings,
        status: "completed" as const,
        error: null,
    };
    await db
        .insert(audioTranscripts)
        .values({
            ...transcriptIdentityValues(input),
            ...completedValues,
        })
        .onConflictDoUpdate({
            target: conflictTarget,
            set: completedValues,
        });
    return {
        ...input.artifact,
        detectedLanguage:
            input.artifact.detectedLanguage ?? input.language ?? undefined,
        providerMetadata,
    };
}

export async function writeFailedTranscriptArtifact(input: {
    datasetItemId: string;
    storageKey: string;
    modelId: string;
    language: string | undefined;
    identity: ITranscriptIdentity;
    error: unknown;
}): Promise<void> {
    const failedValues = {
        transcript: "",
        rawText: null,
        normalizedText: null,
        detectedLanguage: null,
        segmentsJson: [],
        speakersJson: [],
        warnings: [],
        status: "failed" as const,
        error: errorMessage(input.error),
    };
    await db
        .insert(audioTranscripts)
        .values({
            ...transcriptIdentityValues(input),
            ...failedValues,
            providerMetadata: {
                provider: input.identity.providerId,
                route: input.identity.routeId,
                model: input.identity.canonicalModelId,
                configHash: input.identity.configHash,
            },
        })
        .onConflictDoUpdate({
            target: conflictTarget,
            set: failedValues,
        });
}

function transcriptIdentityValues(input: {
    datasetItemId: string;
    storageKey: string;
    modelId: string;
    language: string | undefined;
    identity: ITranscriptIdentity;
}) {
    return {
        datasetItemId: input.datasetItemId,
        storageKey: input.storageKey,
        providerId: input.identity.providerId,
        routeId: input.identity.routeId,
        sttModelId: input.modelId,
        canonicalModelId: input.identity.canonicalModelId,
        language: cacheLanguage(input.language),
        configHash: input.identity.configHash,
        configJson: input.identity.configJson,
    };
}

const conflictTarget = [
    audioTranscripts.datasetItemId,
    audioTranscripts.storageKey,
    audioTranscripts.providerId,
    audioTranscripts.routeId,
    audioTranscripts.canonicalModelId,
    audioTranscripts.language,
    audioTranscripts.configHash,
];

function cacheLanguage(language: string | undefined): string {
    return language ?? "";
}
