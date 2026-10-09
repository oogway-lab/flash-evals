import { randomUUID } from "crypto";
import type { EvalImage } from "@mosaic/llm-core";
import { and, eq, sql } from "drizzle-orm";
import type { ITranscriptArtifact } from "../audio/transcription";
import { getOrCreateAudioTranscriptArtifactWithProvenance } from "../audio/transcription";
import { transcriptIdentity } from "../audio/transcription/store";
import { getOrCreateTransliteration } from "../audio/transliteration";
import { db } from "../db/client";
import { workflowRunItems } from "../db/schema";
import type { datasetItems } from "../db/schema";
import type { IWorkflowSnapshot } from "../db/jsonTypes";
import type { resolveApiKeys } from "../secrets/resolveApiKeys";
import { loadImage } from "../images/source";
import {
    nextPreparationPollDelay,
    preparationLeaseExpired,
    workflowItemLeaseMs,
    workflowPreparationWaitMs,
} from "./itemLease";

export type WorkflowDatasetItem = typeof datasetItems.$inferSelect;
type ResolvedKeys = Awaited<ReturnType<typeof resolveApiKeys>>;

export interface IPreparedWorkflowAudio {
    workflowRunItemId: string;
    artifact: ITranscriptArtifact;
    selectedTranscript: string;
    variant: "raw" | "latin";
    identity: ReturnType<typeof transcriptIdentity>;
    artifactLatencyMs?: number;
    artifactCostUsd?: number;
    artifactCostSource?: "computed" | "unavailable";
}

type PreparedWithPersistence = IPreparedWorkflowAudio & {
    persistence: {
        cacheHit: boolean;
        lookupLatencyMs: number;
        transcriptionLatencyMs: number;
        transliterationLatencyMs: number;
    };
};

export interface IResolvedWorkflowInput {
    text: string;
    images?: EvalImage[];
    transcript?: string;
    preparedAudio?: IPreparedWorkflowAudio;
}

interface IWorkflowItemInput {
    workflowRunId: string;
    item: WorkflowDatasetItem;
    sttConfig: IWorkflowSnapshot["sttConfig"];
    sttProviderKeys: ResolvedKeys["sttProviderKeys"];
    apiKeys: ResolvedKeys["apiKeys"];
    prepareAudio?: boolean;
    includeImages?: boolean;
}

type PreparedAudioInput = IWorkflowItemInput & {
    sttConfig: NonNullable<IWorkflowSnapshot["sttConfig"]>;
};

export async function resolveWorkflowItemInput(
    input: IWorkflowItemInput,
): Promise<IResolvedWorkflowInput> {
    const { item, sttConfig } = input;
    const isAudio =
        item.type === "audio" || item.mimeType?.startsWith("audio/") === true;
    if (!isAudio) {
        if (input.includeImages && item.storageKey && item.mimeType)
            return {
                text: item.inputText ?? "",
                images: [await loadImage(item.storageKey, item.mimeType)],
            };
        return { text: item.inputText ?? "" };
    }
    if (input.prepareAudio === false) return { text: item.inputText ?? "" };
    if (!item.storageKey || !item.mimeType)
        throw new Error("Audio item is missing stored audio bytes.");
    if (!sttConfig?.modelId)
        throw new Error("Audio workflow runs require an STT model.");
    const prepared = await prepareWorkflowAudioItem({ ...input, sttConfig });
    return {
        text: item.inputText
            ? `${item.inputText}\n\nTranscript:\n${prepared.selectedTranscript}`
            : prepared.selectedTranscript,
        transcript: prepared.selectedTranscript,
        preparedAudio: prepared,
    };
}

async function prepareWorkflowAudioItem(
    input: PreparedAudioInput,
): Promise<IPreparedWorkflowAudio> {
    const { sttConfig } = input;
    const leaseOwner = randomUUID();
    const identity = transcriptIdentity(sttConfig.modelId, sttConfig.config);
    await ensurePreparationRow(input, identity);
    const claimedId = await claimPreparation(input, leaseOwner);
    if (!claimedId) return waitForPreparedWorkflowAudio(input, identity);

    try {
        const prepared = await transcribePreparedItem(
            input,
            claimedId,
            identity,
        );
        const completed = await completePreparation(
            claimedId,
            leaseOwner,
            prepared,
        );
        return completed
            ? prepared
            : waitForPreparedWorkflowAudio(input, identity);
    } catch (error) {
        return failPreparedWorkflowAudio(
            claimedId,
            leaseOwner,
            error instanceof Error ? error.message : String(error),
        );
    }
}

async function ensurePreparationRow(
    input: PreparedAudioInput,
    identity: ReturnType<typeof transcriptIdentity>,
) {
    await db
        .insert(workflowRunItems)
        .values({
            workflowRunId: input.workflowRunId,
            datasetItemId: input.item.id,
            sttModelId: input.sttConfig.modelId,
            providerId: identity.providerId,
            routeId: identity.routeId,
            canonicalModelId: identity.canonicalModelId,
            language: input.sttConfig.language ?? "",
            configHash: identity.configHash,
            configJson: identity.configJson,
        })
        .onConflictDoNothing();
}

async function claimPreparation(input: PreparedAudioInput, leaseOwner: string) {
    const leaseCutoff = new Date(Date.now() - workflowItemLeaseMs);
    const [claimed] = await db
        .update(workflowRunItems)
        .set({
            preparationStatus: "running",
            evaluationStatus: "pending",
            claimedAt: new Date(),
            leaseOwner,
            error: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(workflowRunItems.workflowRunId, input.workflowRunId),
                eq(workflowRunItems.datasetItemId, input.item.id),
                sql`(${workflowRunItems.preparationStatus} in ('pending', 'error') or (${workflowRunItems.preparationStatus} = 'running' and ${workflowRunItems.claimedAt} < ${leaseCutoff}))`,
            ),
        )
        .returning({ id: workflowRunItems.id });
    return claimed?.id;
}

async function transcribePreparedItem(
    input: PreparedAudioInput,
    workflowRunItemId: string,
    identity: ReturnType<typeof transcriptIdentity>,
): Promise<PreparedWithPersistence> {
    const { item, sttConfig } = input;
    if (!item.storageKey || !item.mimeType)
        throw new Error("Audio item is missing stored audio bytes.");
    const transcriptionStartedAt = Date.now();
    const { artifact, cacheHit, lookupLatencyMs } =
        await getOrCreateAudioTranscriptArtifactWithProvenance({
            datasetItemId: item.id,
            storageKey: item.storageKey,
            mimeType: item.mimeType,
            modelId: sttConfig.modelId,
            language: sttConfig.language,
            config: sttConfig.config,
            openaiApiKey: input.sttProviderKeys.openai,
            aiGatewayApiKey: input.sttProviderKeys.vercelGateway,
            sonioxApiKey: input.sttProviderKeys.soniox,
            geminiApiKey: input.sttProviderKeys.gemini,
            openrouterApiKey: input.sttProviderKeys.openrouter,
        });
    const variant = selectedVariant(sttConfig);
    const transliterationStartedAt = Date.now();
    const selectedTranscript =
        variant === "latin"
            ? await getOrCreateTransliteration({
                  datasetItemId: item.id,
                  storageKey: item.storageKey,
                  sourceTranscript: artifact.text,
                  config: sttConfig.transliteration!,
                  apiKeys: input.apiKeys,
              })
            : artifact.text;
    const metadata = artifact.providerMetadata;
    return {
        workflowRunItemId,
        artifact,
        selectedTranscript,
        variant,
        identity,
        artifactLatencyMs: metadata?.latencyMsTotal,
        artifactCostUsd: metadata?.costUsd,
        artifactCostSource: metadata?.costSource,
        persistence: {
            cacheHit,
            lookupLatencyMs,
            transcriptionLatencyMs: cacheHit
                ? 0
                : Date.now() - transcriptionStartedAt,
            transliterationLatencyMs:
                variant === "latin" ? Date.now() - transliterationStartedAt : 0,
        },
    };
}

async function completePreparation(
    id: string,
    leaseOwner: string,
    prepared: PreparedWithPersistence,
) {
    const { artifact, persistence } = prepared;
    const [completed] = await db
        .update(workflowRunItems)
        .set({
            selectedTranscript: prepared.selectedTranscript,
            transcriptVariant: prepared.variant,
            detectedLanguage: artifact.detectedLanguage,
            segmentsJson: artifact.segments,
            speakersJson: artifact.speakers,
            warnings: artifact.warnings,
            providerMetadata: safeProviderMetadata(artifact.providerMetadata),
            artifactLatencyMs: prepared.artifactLatencyMs,
            artifactCostUsd: prepared.artifactCostUsd,
            artifactCostSource: prepared.artifactCostSource,
            lookupLatencyMs: persistence.lookupLatencyMs,
            transcriptionLatencyMs: persistence.transcriptionLatencyMs,
            transliterationLatencyMs: persistence.transliterationLatencyMs,
            incurredCostUsd: persistence.cacheHit
                ? 0
                : prepared.artifactCostUsd,
            incurredCostSource: persistence.cacheHit
                ? "computed"
                : prepared.artifactCostSource,
            cacheHit: persistence.cacheHit,
            preparationStatus: "completed",
            claimedAt: null,
            leaseOwner: null,
            error: null,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(workflowRunItems.id, id),
                eq(workflowRunItems.leaseOwner, leaseOwner),
            ),
        )
        .returning({ id: workflowRunItems.id });
    return Boolean(completed);
}

function selectedVariant(sttConfig: PreparedAudioInput["sttConfig"]) {
    return sttConfig.transcriptVariant === "latin" &&
        sttConfig.transliteration?.enabled
        ? ("latin" as const)
        : ("raw" as const);
}

function safeProviderMetadata(
    metadata: ITranscriptArtifact["providerMetadata"],
) {
    if (!metadata?.raw || typeof metadata.raw !== "object") return undefined;
    const value = metadata.raw as Record<string, unknown>;
    return {
        ...(typeof value.requestId === "string"
            ? { requestId: value.requestId }
            : {}),
        ...(typeof value.providerMode === "string"
            ? { providerMode: value.providerMode }
            : {}),
        ...(typeof value.providerBaseUrl === "string"
            ? { providerBaseUrl: value.providerBaseUrl }
            : {}),
    };
}

async function waitForPreparedWorkflowAudio(
    input: PreparedAudioInput,
    identity: ReturnType<typeof transcriptIdentity>,
): Promise<IPreparedWorkflowAudio> {
    const deadline = Date.now() + workflowPreparationWaitMs;
    let delayMs = 50;
    while (Date.now() < deadline) {
        const [row] = await db
            .select()
            .from(workflowRunItems)
            .where(
                and(
                    eq(workflowRunItems.workflowRunId, input.workflowRunId),
                    eq(workflowRunItems.datasetItemId, input.item.id),
                ),
            )
            .limit(1);
        if (row?.preparationStatus === "completed" && row.selectedTranscript)
            return preparedFromRow(row, identity);
        if (row?.preparationStatus === "error")
            throw new Error(row.error ?? "Audio transcription failed.");
        if (row && preparationLeaseExpired(row, Date.now()))
            return prepareWorkflowAudioItem(input);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        delayMs = nextPreparationPollDelay(delayMs);
    }
    throw new Error("Timed out waiting for audio item preparation.");
}

function preparedFromRow(
    row: typeof workflowRunItems.$inferSelect,
    identity: ReturnType<typeof transcriptIdentity>,
): IPreparedWorkflowAudio {
    return {
        workflowRunItemId: row.id,
        artifact: {
            text: row.selectedTranscript!,
            segments: row.segmentsJson,
            speakers: row.speakersJson,
            detectedLanguage: row.detectedLanguage ?? undefined,
            providerMetadata: {
                provider: row.providerId ?? undefined,
                route: row.routeId ?? undefined,
                model: row.canonicalModelId ?? undefined,
                configHash: row.configHash ?? undefined,
                latencyMsTotal: row.artifactLatencyMs ?? undefined,
                costUsd: row.artifactCostUsd ?? undefined,
                costSource: row.artifactCostSource ?? undefined,
            },
            warnings: row.warnings,
        },
        selectedTranscript: row.selectedTranscript!,
        variant: row.transcriptVariant === "latin" ? "latin" : "raw",
        identity,
        artifactLatencyMs: row.artifactLatencyMs ?? undefined,
        artifactCostUsd: row.artifactCostUsd ?? undefined,
        artifactCostSource: row.artifactCostSource ?? undefined,
    };
}

async function failPreparedWorkflowAudio(
    id: string,
    leaseOwner: string,
    message: string,
): Promise<never> {
    await db
        .update(workflowRunItems)
        .set({
            preparationStatus: "error",
            evaluationStatus: "skipped",
            claimedAt: null,
            leaseOwner: null,
            error: message,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(workflowRunItems.id, id),
                eq(workflowRunItems.leaseOwner, leaseOwner),
            ),
        );
    throw new Error(message);
}
