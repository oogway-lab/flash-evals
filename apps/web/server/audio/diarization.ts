import type { IAudioSpeakerTurn, ITranscriptSegment } from "../db/jsonTypes";
import { assertTranscriptLength, editCounts } from "./editDistance";

export interface IDiarizationMetricDetails {
    speakerCountDelta: number;
    coverageRatio: number | null;
    der: number | null;
    falseAlarmRate: number | null;
    missedDetectionRate: number | null;
    speakerConfusionRate: number | null;
    cpWer: number | null;
    perSpeakerWer: Record<string, number> | null;
    /** Speaker-agnostic concatenated WER (not true ORC-WER). */
    concatenatedWer: number | null;
    config: {
        derCollarMs: 250;
        derSkipOverlap: false;
        sampleStepMs: 50;
    };
}

export function scoreDiarizationMetrics(input: {
    referenceTurns?: IAudioSpeakerTurn[];
    candidateSegments?: ITranscriptSegment[];
}): IDiarizationMetricDetails | undefined {
    const referenceTurns = input.referenceTurns ?? [];
    const candidateSegments = input.candidateSegments ?? [];
    if (referenceTurns.length === 0 || candidateSegments.length === 0) {
        return undefined;
    }
    assertDiarizationWorkload(referenceTurns, candidateSegments);
    assertTranscriptLength(
        joinedLength(referenceTurns.map((turn) => turn.text)),
        "reference",
        "Diarization",
    );
    assertTranscriptLength(
        joinedLength(candidateSegments.map((segment) => segment.text)),
        "candidate",
        "Diarization",
    );
    const referenceText = referenceTurns.map((turn) => turn.text).join(" ");
    const candidateText = candidateSegments
        .map((segment) => segment.text)
        .join(" ");
    const diarizationRates = diarizationErrorRates(
        referenceTurns,
        candidateSegments,
    );
    const speakerMetrics = speakerAttributedWer(
        referenceTurns,
        candidateSegments,
    );

    return {
        speakerCountDelta:
            speakerCount(candidateSegments.map((segment) => segment.speaker)) -
            speakerCount(referenceTurns.map((turn) => turn.speaker)),
        coverageRatio: coverageRatio(referenceTurns, candidateSegments),
        der: diarizationRates?.der ?? null,
        falseAlarmRate: diarizationRates?.falseAlarmRate ?? null,
        missedDetectionRate: diarizationRates?.missedDetectionRate ?? null,
        speakerConfusionRate: diarizationRates?.speakerConfusionRate ?? null,
        cpWer: speakerMetrics?.cpWer ?? null,
        perSpeakerWer: speakerMetrics?.perSpeakerWer ?? null,
        // Concatenated reference vs concatenated hypothesis; not true ORC-WER.
        concatenatedWer: wordErrorRate(referenceText, candidateText),
        config: DIARIZATION_CONFIG,
    };
}

const DIARIZATION_CONFIG = {
    derCollarMs: 250,
    derSkipOverlap: false,
    sampleStepMs: 50,
} as const;

function speakerAttributedWer(
    referenceTurns: IAudioSpeakerTurn[],
    candidateSegments: ITranscriptSegment[],
): { cpWer: number; perSpeakerWer: Record<string, number> } | null {
    const referenceSpeakers = unique(
        referenceTurns.map((turn) => turn.speaker),
    );
    const candidateSpeakers = unique(
        candidateSegments
            .map((segment) => segment.speaker)
            .filter((speaker): speaker is string => Boolean(speaker)),
    );
    if (referenceSpeakers.length === 0 || candidateSpeakers.length === 0) {
        return null;
    }

    let best:
        | {
              distance: number;
              referenceLength: number;
              perSpeakerWer: Record<string, number>;
          }
        | undefined;
    for (const mapping of speakerMappings(
        candidateSpeakers,
        referenceSpeakers,
    )) {
        let distance = 0;
        let referenceLength = 0;
        const perSpeakerWer: Record<string, number> = {};
        for (const referenceSpeaker of referenceSpeakers) {
            const referenceText = referenceTurns
                .filter((turn) => turn.speaker === referenceSpeaker)
                .map((turn) => turn.text)
                .join(" ");
            const candidateText = candidateSegments
                .filter(
                    (segment) =>
                        segment.speaker &&
                        mapping.get(segment.speaker) === referenceSpeaker,
                )
                .map((segment) => segment.text)
                .join(" ");
            const counts = editCounts(
                tokens(referenceText),
                tokens(candidateText),
            );
            const speakerDistance =
                counts.substitutions + counts.deletions + counts.insertions;
            distance += speakerDistance;
            referenceLength += counts.referenceLength;
            perSpeakerWer[referenceSpeaker] =
                counts.referenceLength > 0
                    ? speakerDistance / counts.referenceLength
                    : 0;
        }
        if (!best || distance < best.distance) {
            best = { distance, referenceLength, perSpeakerWer };
        }
    }
    if (!best || best.referenceLength === 0) return null;
    return {
        cpWer: best.distance / best.referenceLength,
        perSpeakerWer: best.perSpeakerWer,
    };
}

function diarizationErrorRates(
    referenceTurns: IAudioSpeakerTurn[],
    candidateSegments: ITranscriptSegment[],
): {
    der: number;
    falseAlarmRate: number;
    missedDetectionRate: number;
    speakerConfusionRate: number;
} | null {
    const originalTimedReference = referenceTurns.filter(hasTiming);
    const timedReference = originalTimedReference.map(applyBoundaryCollar);
    const timedCandidate = candidateSegments.filter(hasTiming);
    if (timedReference.length === 0 || timedCandidate.length === 0) return null;

    const mapping = bestOverlapSpeakerMapping(timedReference, timedCandidate);
    let missed = 0;
    let falseAlarm = 0;
    let confusion = 0;
    const totalReference = timedReference.reduce(
        (sum, turn) => sum + duration(turn),
        0,
    );
    if (totalReference <= 0) return null;

    for (const ref of timedReference) {
        let covered = 0;
        for (const cand of timedCandidate) {
            const overlapMs = overlap(ref, cand);
            if (overlapMs <= 0) continue;
            covered += overlapMs;
            if (cand.speaker && mapping.get(cand.speaker) !== ref.speaker) {
                confusion += overlapMs;
            }
        }
        missed += Math.max(0, duration(ref) - covered);
    }

    for (const cand of timedCandidate) {
        const covered = originalTimedReference.reduce(
            (sum, ref) => sum + overlap(ref, cand),
            0,
        );
        falseAlarm += Math.max(0, duration(cand) - covered);
    }

    return {
        der: (missed + falseAlarm + confusion) / totalReference,
        falseAlarmRate: falseAlarm / totalReference,
        missedDetectionRate: missed / totalReference,
        speakerConfusionRate: confusion / totalReference,
    };
}

function applyBoundaryCollar(
    turn: IAudioSpeakerTurn & { startMs: number; endMs: number },
): IAudioSpeakerTurn & { startMs: number; endMs: number } {
    const collar = DIARIZATION_CONFIG.derCollarMs;
    if (duration(turn) <= collar * 2) return turn;
    return {
        ...turn,
        startMs: turn.startMs + collar,
        endMs: turn.endMs - collar,
    };
}

function bestOverlapSpeakerMapping(
    referenceTurns: Array<
        IAudioSpeakerTurn & { startMs: number; endMs: number }
    >,
    candidateSegments: Array<
        ITranscriptSegment & { startMs: number; endMs: number }
    >,
): Map<string, string> {
    const referenceSpeakers = unique(
        referenceTurns.map((turn) => turn.speaker),
    );
    const candidateSpeakers = unique(
        candidateSegments
            .map((segment) => segment.speaker)
            .filter((speaker): speaker is string => Boolean(speaker)),
    );
    let bestMapping = new Map<string, string>();
    let bestScore = -1;
    for (const mapping of speakerMappings(
        candidateSpeakers,
        referenceSpeakers,
    )) {
        let score = 0;
        for (const ref of referenceTurns) {
            for (const cand of candidateSegments) {
                if (cand.speaker && mapping.get(cand.speaker) === ref.speaker) {
                    score += overlap(ref, cand);
                }
            }
        }
        if (score > bestScore) {
            bestScore = score;
            bestMapping = mapping;
        }
    }
    return bestMapping;
}

function coverageRatio(
    referenceTurns: IAudioSpeakerTurn[],
    candidateSegments: ITranscriptSegment[],
): number | null {
    const referenceWords = tokens(
        referenceTurns.map((turn) => turn.text).join(" "),
    ).length;
    const candidateWords = tokens(
        candidateSegments.map((segment) => segment.text).join(" "),
    ).length;
    return referenceWords > 0 ? candidateWords / referenceWords : null;
}

function wordErrorRate(reference: string, candidate: string): number | null {
    const counts = editCounts(tokens(reference), tokens(candidate));
    if (counts.referenceLength === 0) return null;
    return (
        (counts.substitutions + counts.deletions + counts.insertions) /
        counts.referenceLength
    );
}

function speakerMappings(
    candidateSpeakers: string[],
    referenceSpeakers: string[],
): Iterable<Map<string, string>> {
    return speakerMappingsAt(
        candidateSpeakers,
        referenceSpeakers,
        0,
        new Map(),
    );
}

function* speakerMappingsAt(
    candidateSpeakers: string[],
    referenceSpeakers: string[],
    index: number,
    mapping: Map<string, string>,
): Generator<Map<string, string>> {
    if (index === candidateSpeakers.length) {
        yield new Map(mapping);
        return;
    }
    const speaker = candidateSpeakers[index];
    for (const referenceSpeaker of referenceSpeakers) {
        mapping.set(speaker, referenceSpeaker);
        yield* speakerMappingsAt(
            candidateSpeakers,
            referenceSpeakers,
            index + 1,
            mapping,
        );
    }
    mapping.delete(speaker);
}

function tokens(text: string): string[] {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
}

function joinedLength(parts: string[]): number {
    return parts.reduce(
        (length, part, index) => length + part.length + (index === 0 ? 0 : 1),
        0,
    );
}

const MAX_SPEAKER_MAPPINGS = 100_000;
const MAX_TIMING_PAIRS = 5_000_000;
const MAX_DIARIZATION_WORK = 20_000_000;
const MAX_SPEAKERS = 64;

function assertDiarizationWorkload(
    referenceTurns: IAudioSpeakerTurn[],
    candidateSegments: ITranscriptSegment[],
): void {
    const referenceSpeakerCount = unique(
        referenceTurns.map((turn) => turn.speaker),
    ).length;
    const candidateSpeakerCount = unique(
        candidateSegments
            .map((segment) => segment.speaker)
            .filter((speaker): speaker is string => Boolean(speaker)),
    ).length;
    if (
        referenceSpeakerCount > MAX_SPEAKERS ||
        candidateSpeakerCount > MAX_SPEAKERS
    ) {
        throw new Error(
            `Diarization scoring rejected ${referenceSpeakerCount} reference and ${candidateSpeakerCount} candidate speakers; maximum accepted speaker count is ${MAX_SPEAKERS}.`,
        );
    }
    let mappings = 1;
    for (let index = 0; index < candidateSpeakerCount; index += 1) {
        if (mappings > MAX_SPEAKER_MAPPINGS / referenceSpeakerCount) {
            throw new Error(
                `Diarization scoring rejected ${referenceSpeakerCount} reference and ${candidateSpeakerCount} candidate speakers; speaker mapping exceeds the safe limit of ${MAX_SPEAKER_MAPPINGS}.`,
            );
        }
        mappings *= referenceSpeakerCount;
    }
    const workPerMapping =
        referenceSpeakerCount *
        (referenceTurns.length + candidateSegments.length);
    const timedReferenceCount = referenceTurns.filter(hasTiming).length;
    const timedCandidateCount = candidateSegments.filter(hasTiming).length;
    const timingPairs = timedReferenceCount * timedCandidateCount;
    if (
        mappings > MAX_DIARIZATION_WORK / workPerMapping ||
        (timingPairs > 0 && mappings > MAX_DIARIZATION_WORK / timingPairs)
    ) {
        throw new Error(
            `Diarization scoring rejected a speaker attribution workload above the safe limit of ${MAX_DIARIZATION_WORK}.`,
        );
    }
    if (
        timedCandidateCount > 0 &&
        timedReferenceCount > MAX_TIMING_PAIRS / timedCandidateCount
    ) {
        throw new Error(
            `Diarization scoring rejected ${referenceTurns.length} reference turns and ${candidateSegments.length} candidate segments; timing comparison exceeds the safe limit of ${MAX_TIMING_PAIRS}.`,
        );
    }
}

function speakerCount(speakers: Array<string | undefined>): number {
    return new Set(speakers.filter(Boolean)).size;
}

function unique(values: string[]): string[] {
    return [...new Set(values)];
}

function hasTiming<T extends { startMs?: number; endMs?: number }>(
    value: T,
): value is T & { startMs: number; endMs: number } {
    return (
        typeof value.startMs === "number" &&
        typeof value.endMs === "number" &&
        value.endMs > value.startMs
    );
}

function duration(value: { startMs: number; endMs: number }): number {
    return value.endMs - value.startMs;
}

function overlap(
    a: { startMs: number; endMs: number },
    b: { startMs: number; endMs: number },
): number {
    return Math.max(
        0,
        Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs),
    );
}
