import { TRANSCRIPT_CHUNK_KEY_MARKER } from "@mosaic/api-contract";
import type {
    IAudioPreparationMetadata,
    ITranscriptionAttemptRecord,
} from "../../db/jsonTypes";
import {
    AUDIO_PREPARATION_VERSION,
    prepareAudioForTranscription,
    type IPreparedAudioChunk,
    type PreparedAudio,
} from "../preparation";
import { dispatchTranscription } from "./dispatcher";
import type { ISttExecutionPolicy } from "./policy";
import { transcribeWithRetry, type ITranscriptionRetryPolicy } from "./retry";
import type { ITranscriptArtifact, ITranscriptionProviderInput } from "./types";

type ProviderRequest = Omit<ITranscriptionProviderInput, "bytes" | "mimeType">;

/** Persists chunk transcripts so a retry resumes after the last completed chunk. */
export interface IChunkTranscriptStore {
    read(chunkKey: string): Promise<ITranscriptArtifact | undefined>;
    write(
        chunkKey: string,
        artifact: ITranscriptArtifact,
        latencyMsTotal: number,
    ): Promise<ITranscriptArtifact>;
}

export interface IExecuteTranscriptionDeps {
    dispatch?: typeof dispatchTranscription;
    prepare?: typeof prepareAudioForTranscription;
    retry?: Partial<ITranscriptionRetryPolicy>;
}

/** True when a cached transcript was made under the current audio preparation. */
export function cachedPreparationIsCurrent(
    artifact: ITranscriptArtifact,
): boolean {
    const version = artifact.providerMetadata?.audioPreparation?.version;
    return version === undefined || version === AUDIO_PREPARATION_VERSION;
}

/**
 * Key for one prepared chunk; includes version and span so plans never mix.
 * Readers that list an item's transcripts exclude keys with the marker.
 */
export function chunkStorageKey(
    storageKey: string,
    prepared: Extract<PreparedAudio, { kind: "prepared" }>,
    chunk: { index: number; startMs: number; endMs: number },
): string {
    return `${storageKey}${TRANSCRIPT_CHUNK_KEY_MARKER}${prepared.version}/${chunk.index + 1}-of-${prepared.chunks.length}@${chunk.startMs}-${chunk.endMs}`;
}

/**
 * Transcribe stored audio within the route's budget: send it unchanged when it
 * fits, otherwise send a prepared copy chunk by chunk, reusing chunks completed
 * by an earlier attempt, and assemble one transcript in source order.
 */
export async function executeTranscription(
    input: {
        request: ProviderRequest;
        storageKey: string;
        bytes: Buffer;
        mimeType: string;
        policy: ISttExecutionPolicy;
        chunkStore: IChunkTranscriptStore;
    },
    deps: IExecuteTranscriptionDeps = {},
): Promise<ITranscriptArtifact> {
    const dispatch = deps.dispatch ?? dispatchTranscription;
    const prepare = deps.prepare ?? prepareAudioForTranscription;
    const retryPolicy = {
        maxAttempts: input.policy.maxAttempts,
        ...deps.retry,
    };
    const request: ProviderRequest = {
        ...input.request,
        ...(input.policy.timeoutMs !== undefined
            ? { timeoutMs: input.policy.timeoutMs }
            : {}),
        ...(input.policy.maxAudioBytes !== undefined
            ? { maxAudioBytes: input.policy.maxAudioBytes }
            : {}),
    };
    const prepared = await prepare({
        bytes: input.bytes,
        mimeType: input.mimeType,
        policy: input.policy.preparation,
    });
    if (prepared.kind === "original") {
        const { artifact, attempts } = await transcribeWithRetry(
            () =>
                dispatch({
                    ...request,
                    bytes: input.bytes,
                    mimeType: input.mimeType,
                }),
            retryPolicy,
        );
        // Routes without a retry policy keep their existing stored metadata.
        return input.policy.maxAttempts > 1
            ? withAttemptAccounting(artifact, attempts)
            : artifact;
    }

    const results: Array<{
        chunk: IPreparedAudioChunk;
        artifact: ITranscriptArtifact;
        cacheHit: boolean;
        attempts: ITranscriptionAttemptRecord[];
    }> = [];
    for (const chunk of prepared.chunks) {
        if (chunk.silent) {
            results.push({
                chunk,
                artifact: SILENT_CHUNK,
                cacheHit: false,
                attempts: [],
            });
            continue;
        }
        const key = chunkStorageKey(input.storageKey, prepared, chunk);
        const cached = await input.chunkStore.read(key);
        if (cached) {
            results.push({
                chunk,
                artifact: cached,
                cacheHit: true,
                attempts: [],
            });
            continue;
        }
        const startedAt = Date.now();
        const { artifact, attempts } = await transcribeWithRetry(
            () =>
                dispatch({
                    ...request,
                    bytes: chunk.bytes,
                    mimeType: chunk.mimeType,
                }),
            retryPolicy,
        );
        const stored = await input.chunkStore.write(
            key,
            withAttemptAccounting(artifact, attempts),
            Date.now() - startedAt,
        );
        results.push({ chunk, artifact: stored, cacheHit: false, attempts });
    }
    return assembleChunkTranscripts(prepared, input, results);
}

const SILENT_CHUNK: ITranscriptArtifact = {
    text: "",
    segments: [],
    speakers: [],
    warnings: [],
    providerMetadata: { costUsd: 0, costSource: "computed" },
};

function withAttemptAccounting(
    artifact: ITranscriptArtifact,
    attempts: ITranscriptionAttemptRecord[],
): ITranscriptArtifact {
    const costUncertain = attempts.some((attempt) => attempt.billingUnknown);
    const costUsd = artifact.providerMetadata?.costUsd;
    return {
        ...artifact,
        providerMetadata: {
            ...artifact.providerMetadata,
            attempts,
            ...(costUsd !== undefined ? { incurredCostUsd: costUsd } : {}),
            ...(costUncertain ? { costUncertain } : {}),
        },
        warnings: costUncertain
            ? [...artifact.warnings, unknownBillingWarning(attempts)]
            : artifact.warnings,
    };
}

function unknownBillingWarning(
    attempts: ITranscriptionAttemptRecord[],
): string {
    const count = attempts.filter((attempt) => attempt.billingUnknown).length;
    return `${count} timed-out transcription request${count === 1 ? "" : "s"} may have been billed; reported cost excludes ${count === 1 ? "it" : "them"}.`;
}

export function assembleChunkTranscripts(
    prepared: Extract<PreparedAudio, { kind: "prepared" }>,
    source: { bytes: Buffer; mimeType: string },
    results: Array<{
        chunk: IPreparedAudioChunk;
        artifact: ITranscriptArtifact;
        cacheHit: boolean;
        attempts: ITranscriptionAttemptRecord[];
    }>,
): ITranscriptArtifact {
    const ordered = [...results].sort((a, b) => a.chunk.index - b.chunk.index);
    const costs = ordered.map(
        (result) => result.artifact.providerMetadata?.costUsd,
    );
    const allCostsKnown = costs.every((cost) => cost !== undefined);
    const sum = (values: Array<number | undefined>) =>
        values.reduce<number>((total, value) => total + (value ?? 0), 0);
    const incurred = ordered
        .filter((result) => !result.cacheHit)
        .map((result) => result.artifact.providerMetadata?.costUsd);
    // Reused chunks still carry their own cost uncertainty into the total.
    const costUncertain = ordered.some(
        (result) => result.artifact.providerMetadata?.costUncertain,
    );
    const usageTotal = (
        key: "inputTokens" | "outputTokens" | "thinkingTokens" | "totalTokens",
    ) => {
        const values = ordered.map(
            (result) => result.artifact.providerMetadata?.usage?.[key],
        );
        return values.some((value) => value !== undefined)
            ? sum(values)
            : undefined;
    };
    // Each chunk is diarized on its own, so its labels only mean something
    // within that chunk; scope them by part instead of merging by id.
    const multiPart = ordered.length > 1;
    const speakerId = (part: number, id: string) =>
        multiPart ? `part${part + 1}:${id}` : id;
    const speakers = ordered.flatMap((result) =>
        result.artifact.speakers.map((speaker) => ({
            ...speaker,
            id: speakerId(result.chunk.index, speaker.id),
            ...(multiPart
                ? {
                      label: `${speaker.label ?? speaker.id} (part ${result.chunk.index + 1})`,
                  }
                : {}),
        })),
    );
    const hardCuts = ordered.filter((result) => result.chunk.hardCut).length;
    const audioPreparation: IAudioPreparationMetadata = {
        version: prepared.version,
        sourceBytes: source.bytes.byteLength,
        sourceMimeType: source.mimeType,
        sourceDurationMs: prepared.probe.durationMs,
        ...(prepared.probe.codec ? { sourceCodec: prepared.probe.codec } : {}),
        ...(prepared.probe.channels
            ? { sourceChannels: prepared.probe.channels }
            : {}),
        ...(prepared.probe.sampleRate
            ? { sourceSampleRate: prepared.probe.sampleRate }
            : {}),
        chunks: ordered.map((result) => ({
            index: result.chunk.index,
            startMs: result.chunk.startMs,
            endMs: result.chunk.endMs,
            bytes: result.chunk.bytes.byteLength,
            cacheHit: result.cacheHit,
            hardCut: result.chunk.hardCut,
            ...(result.chunk.silent ? { silent: true } : {}),
            attempts: result.attempts.length,
            ...(result.artifact.providerMetadata?.costUsd !== undefined
                ? { costUsd: result.artifact.providerMetadata.costUsd }
                : {}),
        })),
    };
    const first = ordered.find((result) => !result.chunk.silent)?.artifact
        .providerMetadata;
    return {
        text: ordered
            .map((result) => result.artifact.text.trim())
            .filter(Boolean)
            .join("\n"),
        segments: ordered.flatMap((result) =>
            result.artifact.segments.map((segment) => ({
                ...segment,
                ...(segment.speaker
                    ? {
                          speaker: speakerId(
                              result.chunk.index,
                              segment.speaker,
                          ),
                      }
                    : {}),
                ...(segment.startMs !== undefined
                    ? { startMs: segment.startMs + result.chunk.startMs }
                    : {}),
                ...(segment.endMs !== undefined
                    ? { endMs: segment.endMs + result.chunk.startMs }
                    : {}),
            })),
        ),
        speakers,
        ...(ordered.find((result) => result.artifact.detectedLanguage)
            ? {
                  detectedLanguage: ordered.find(
                      (result) => result.artifact.detectedLanguage,
                  )!.artifact.detectedLanguage,
              }
            : {}),
        durationMs: prepared.probe.durationMs,
        providerMetadata: {
            ...(first?.promptSupported !== undefined
                ? { promptSupported: first.promptSupported }
                : {}),
            usage: {
                inputTokens: usageTotal("inputTokens"),
                outputTokens: usageTotal("outputTokens"),
                thinkingTokens: usageTotal("thinkingTokens"),
                totalTokens: usageTotal("totalTokens"),
            },
            ...(allCostsKnown
                ? { costUsd: sum(costs), costSource: "computed" as const }
                : { costSource: "unavailable" as const }),
            ...(incurred.every((cost) => cost !== undefined)
                ? { incurredCostUsd: sum(incurred) }
                : {}),
            ...(costUncertain ? { costUncertain } : {}),
            audioPreparation,
        },
        warnings: [
            ...new Set(ordered.flatMap((result) => result.artifact.warnings)),
            ...(multiPart && speakers.length > 0
                ? [
                      "Speaker labels are assigned per chunk; the same person can appear under different labels in different parts.",
                  ]
                : []),
            ...(hardCuts > 0
                ? [
                      `${hardCuts} chunk boundar${hardCuts === 1 ? "y" : "ies"} had no nearby silence; check the transcript around ${hardCuts === 1 ? "that cut" : "those cuts"}.`,
                  ]
                : []),
        ],
    };
}
