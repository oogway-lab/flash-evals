import { isRecord } from "../lib/objects";
import { audioReferenceFromLabel } from "./reference";
import {
    scoreDiarizationMetrics,
    type IDiarizationMetricDetails,
} from "./diarization";
import {
    assertTranscriptSize,
    editCounts,
    type IEditCounts,
} from "./editDistance";
import type { AudioReferenceKind, ITranscriptSegment } from "../db/jsonTypes";

export interface ITranscriptMetricDetails {
    metricKind: "mechanical_stt";
    layer: "stt";
    transcriptVariant: "raw" | "latin";
    sttModelId?: string;
    providerId?: string;
    routeId?: string;
    configHash?: string;
    referenceField: string;
    referenceKind: AudioReferenceKind;
    referenceText: string;
    candidateText: string;
    wer: number;
    cer: number;
    fillerStrippedWer: number;
    wordCounts: IEditCounts;
    characterCounts: IEditCounts;
    domainTermRecall?: IDomainTermRecallDetails;
    numericAccuracy?: INumericAccuracyDetails;
    diarization?: IDiarizationMetricDetails;
    latencyMsTotal?: number;
    costUsd?: number;
    costSource?: "computed" | "unavailable";
    hardFailures: TranscriptHardFailure[];
    normalization: {
        lowercase: true;
        stripPunctuation: true;
        collapseWhitespace: true;
        expandDigitWords: true;
        stripFillers: false;
        fillerTokens: string[];
    };
}

export interface ITranscriptMetricResult {
    score: number;
    details: ITranscriptMetricDetails;
}

export interface IDomainTermRecallDetails {
    matched: number;
    expected: number;
    recall: number;
    missed: string[];
}

export interface INumericAccuracyDetails {
    matched: number;
    expected: number;
    accuracy: number;
    missed: number[];
}

export type TranscriptHardFailure =
    | "empty_transcript"
    | "repetition"
    | "truncation"
    | "wrong_speaker_count"
    | "latency_sla_breached"
    | "cost_outlier"
    | "non_utf8_output";

/** Latin-script reference fields only — never fall back to native script. */
const LATIN_TRANSCRIPT_REFERENCE_FIELDS = [
    "expectedTranscriptLatin",
    "expectedLatinTranscript",
    "latinTranscript",
];

/** Native/raw reference fields only — never fall back to Latin script. */
const RAW_TRANSCRIPT_REFERENCE_FIELDS = [
    "expectedTranscript",
    "transcript",
    "nativeTranscript",
];

export function scoreTranscriptMetrics(input: {
    candidateText?: string;
    candidateSegments?: ITranscriptSegment[];
    label?: Record<string, unknown>;
    variant?: "raw" | "latin";
    sttModelId?: string;
    providerId?: string;
    routeId?: string;
    configHash?: string;
    latencyMsTotal?: number;
    costUsd?: number;
    costSource?: "computed" | "unavailable";
}): ITranscriptMetricResult | undefined {
    const transcriptVariant = input.variant ?? "raw";
    const reference = transcriptReference(input.label, transcriptVariant);
    const candidateText = input.candidateText;
    if (!reference || candidateText === undefined) return undefined;
    assertTranscriptSize(reference.text, "reference");
    assertTranscriptSize(candidateText, "candidate");
    const candidate = candidateText.trim();

    const normalizedReference = normalizeTranscript(reference.text);
    const normalizedCandidate = normalizeTranscript(candidate);
    const referenceTokens = tokens(normalizedReference);
    const candidateTokens = tokens(normalizedCandidate);
    const wordCounts = editCounts(referenceTokens, candidateTokens);
    const characterCounts = editCounts(
        [...normalizedReference],
        [...normalizedCandidate],
    );
    const wer = errorRate(wordCounts);
    const cer = errorRate(characterCounts);
    const audioReference = audioReferenceFromLabel(input.label);
    const fillerStrippedWer = errorRate(
        editCounts(
            stripFillers(referenceTokens),
            stripFillers(candidateTokens),
        ),
    );
    const domainTermRecall = scoreDomainTermRecall({
        domainTerms: audioReference?.domainTerms,
        candidateText: candidate,
    });
    const numericAccuracy = scoreNumericAccuracy({
        expectedNumbers: audioReference?.expectedNumbers,
        candidateText: candidate,
    });
    const diarization = scoreDiarizationMetrics({
        referenceTurns: audioReference?.expectedSpeakerTurns,
        candidateSegments: input.candidateSegments,
    });
    const hardFailures = transcriptHardFailures({
        candidateText: candidate,
        candidateTokens,
        referenceTokens,
        diarization,
        candidateHasSpeakers: (input.candidateSegments ?? []).some((segment) =>
            Boolean(segment.speaker),
        ),
        latencyMsTotal: input.latencyMsTotal,
        latencySlaMs: audioReference?.latencySlaMs,
        costUsd: input.costUsd,
        costOutlierUsd: audioReference?.costOutlierUsd,
    });

    return {
        score: Math.max(0, 1 - wer),
        details: transcriptMetricDetails({
            input,
            transcriptVariant,
            reference,
            candidate,
            wer,
            cer,
            fillerStrippedWer,
            wordCounts,
            characterCounts,
            domainTermRecall,
            numericAccuracy,
            diarization,
            hardFailures,
        }),
    };
}

function transcriptMetricDetails(input: {
    input: Parameters<typeof scoreTranscriptMetrics>[0];
    transcriptVariant: "raw" | "latin";
    reference: {
        field: string;
        text: string;
        referenceKind: AudioReferenceKind;
    };
    candidate: string;
    wer: number;
    cer: number;
    fillerStrippedWer: number;
    wordCounts: IEditCounts;
    characterCounts: IEditCounts;
    domainTermRecall: IDomainTermRecallDetails | undefined;
    numericAccuracy: INumericAccuracyDetails | undefined;
    diarization: IDiarizationMetricDetails | undefined;
    hardFailures: TranscriptHardFailure[];
}): ITranscriptMetricDetails {
    return {
        metricKind: "mechanical_stt",
        layer: "stt",
        transcriptVariant: input.transcriptVariant,
        ...(input.input.sttModelId
            ? { sttModelId: input.input.sttModelId }
            : {}),
        ...(input.input.providerId
            ? { providerId: input.input.providerId }
            : {}),
        ...(input.input.routeId ? { routeId: input.input.routeId } : {}),
        ...(input.input.configHash
            ? { configHash: input.input.configHash }
            : {}),
        referenceField: input.reference.field,
        referenceKind: input.reference.referenceKind,
        referenceText: input.reference.text,
        candidateText: input.candidate,
        wer: input.wer,
        cer: input.cer,
        fillerStrippedWer: input.fillerStrippedWer,
        wordCounts: input.wordCounts,
        characterCounts: input.characterCounts,
        ...(input.domainTermRecall
            ? { domainTermRecall: input.domainTermRecall }
            : {}),
        ...(input.numericAccuracy
            ? { numericAccuracy: input.numericAccuracy }
            : {}),
        ...(input.diarization ? { diarization: input.diarization } : {}),
        ...(input.input.latencyMsTotal !== undefined
            ? { latencyMsTotal: input.input.latencyMsTotal }
            : {}),
        ...(input.input.costUsd !== undefined
            ? { costUsd: input.input.costUsd }
            : {}),
        ...(input.input.costSource
            ? { costSource: input.input.costSource }
            : {}),
        hardFailures: input.hardFailures,
        normalization: {
            lowercase: true,
            stripPunctuation: true,
            collapseWhitespace: true,
            expandDigitWords: true,
            stripFillers: false,
            fillerTokens: FILLER_TOKENS,
        },
    };
}

function transcriptHardFailures(input: {
    candidateText: string;
    candidateTokens: string[];
    referenceTokens: string[];
    diarization: IDiarizationMetricDetails | undefined;
    candidateHasSpeakers: boolean;
    latencyMsTotal: number | undefined;
    latencySlaMs: number | undefined;
    costUsd: number | undefined;
    costOutlierUsd: number | undefined;
}): TranscriptHardFailure[] {
    const failures = new Set<TranscriptHardFailure>();
    if (input.candidateTokens.length === 0) failures.add("empty_transcript");
    if (hasEncodingIssue(input.candidateText)) failures.add("non_utf8_output");
    if (hasRepetition(input.candidateTokens)) failures.add("repetition");
    if (isTruncated(input.referenceTokens, input.candidateTokens)) {
        failures.add("truncation");
    }
    if (
        input.latencySlaMs !== undefined &&
        input.latencyMsTotal !== undefined &&
        input.latencyMsTotal > input.latencySlaMs
    ) {
        failures.add("latency_sla_breached");
    }
    if (
        input.costOutlierUsd !== undefined &&
        input.costUsd !== undefined &&
        input.costUsd > input.costOutlierUsd
    ) {
        failures.add("cost_outlier");
    }
    // Only flag speaker-count failures when the candidate produced labels.
    // Providers that do not diarize report 0 speakers and would otherwise
    // always false-flag wrong_speaker_count against multi-speaker gold.
    if (
        input.diarization &&
        input.candidateHasSpeakers &&
        input.diarization.speakerCountDelta !== 0
    ) {
        failures.add("wrong_speaker_count");
    }
    return [...failures];
}

function hasEncodingIssue(text: string): boolean {
    return text.includes("\uFFFD");
}

function hasRepetition(candidateTokens: string[]): boolean {
    if (candidateTokens.length < 6) return false;
    let runLength = 1;
    for (let i = 1; i < candidateTokens.length; i += 1) {
        if (candidateTokens[i] === candidateTokens[i - 1]) {
            runLength += 1;
            if (runLength >= 5) return true;
        } else {
            runLength = 1;
        }
    }

    const counts = new Map<string, number>();
    for (const token of candidateTokens) {
        counts.set(token, (counts.get(token) ?? 0) + 1);
    }
    const mostCommon = Math.max(...counts.values());
    return (
        candidateTokens.length >= 8 &&
        mostCommon / candidateTokens.length >= 0.6
    );
}

function isTruncated(
    referenceTokens: string[],
    candidateTokens: string[],
): boolean {
    return (
        referenceTokens.length >= 4 &&
        candidateTokens.length > 0 &&
        candidateTokens.length / referenceTokens.length < 0.5
    );
}

function transcriptReference(
    label: Record<string, unknown> | undefined,
    variant: "raw" | "latin",
):
    | { field: string; text: string; referenceKind: AudioReferenceKind }
    | undefined {
    if (!label) return undefined;
    const audioReference = audioReferenceFromLabel(label);
    const referenceKind = audioReference?.referenceKind ?? "human_gold";
    if (variant === "latin" && audioReference?.expectedTranscriptLatin) {
        return {
            field: "expectedTranscriptLatin",
            text: audioReference.expectedTranscriptLatin,
            referenceKind,
        };
    }
    if (variant === "raw" && audioReference?.expectedTranscript) {
        return {
            field: "expectedTranscript",
            text: audioReference.expectedTranscript,
            referenceKind,
        };
    }
    for (const field of transcriptReferenceFields(variant)) {
        const value = label[field];
        if (typeof value === "string" && value.trim()) {
            return { field, text: value.trim(), referenceKind };
        }
    }
    const nested = label.stt ?? label.transcription;
    if (isRecord(nested)) {
        for (const field of transcriptReferenceFields(variant)) {
            const value = nested[field];
            if (typeof value === "string" && value.trim()) {
                return {
                    field: `stt.${field}`,
                    text: value.trim(),
                    referenceKind,
                };
            }
        }
    }
    return undefined;
}

function transcriptReferenceFields(variant: "raw" | "latin"): string[] {
    if (variant === "latin") return LATIN_TRANSCRIPT_REFERENCE_FIELDS;
    return RAW_TRANSCRIPT_REFERENCE_FIELDS;
}

// Private-use placeholder so digit-internal decimals survive punctuation strip.
const DECIMAL_PLACEHOLDER = "\uE000";

export function normalizeTranscript(text: string): string {
    const plainText = text
        .toLowerCase()
        .replace(/[’`']/g, "'")
        // Protect digit-internal decimals so "2.5" / "2,5" survive punctuation
        // stripping as "2.5" instead of being split into "2 5".
        .replace(/(\d)[.,](\d)/g, `$1${DECIMAL_PLACEHOLDER}$2`)
        .replace(
            new RegExp(`[^\\p{L}\\p{N}'\\s${DECIMAL_PLACEHOLDER}]`, "gu"),
            " ",
        )
        .replace(new RegExp(DECIMAL_PLACEHOLDER, "g"), ".")
        .replace(/\s+/g, " ")
        .trim();
    return normalizeNumberWords(plainText);
}

const FILLER_TOKENS = [
    "ah",
    "eh",
    "er",
    "haan",
    "hmm",
    "hm",
    "like",
    "matlab",
    "bas",
    "uh",
    "uhh",
    "um",
    "umm",
    "yaani",
    "yani",
];

const FILLER_WORDS = new Set(FILLER_TOKENS);

const NUMBER_WORD_VALUES = new Map<string, number>([
    ["zero", 0],
    ["one", 1],
    ["two", 2],
    ["three", 3],
    ["four", 4],
    ["five", 5],
    ["six", 6],
    ["seven", 7],
    ["eight", 8],
    ["nine", 9],
    ["ten", 10],
    ["eleven", 11],
    ["twelve", 12],
    ["thirteen", 13],
    ["fourteen", 14],
    ["fifteen", 15],
    ["sixteen", 16],
    ["seventeen", 17],
    ["eighteen", 18],
    ["nineteen", 19],
    ["twenty", 20],
    ["thirty", 30],
    ["forty", 40],
    ["fifty", 50],
    ["sixty", 60],
    ["seventy", 70],
    ["eighty", 80],
    ["ninety", 90],
]);

function normalizeNumberWords(text: string): string {
    const words = tokens(text);
    const result: string[] = [];
    for (let i = 0; i < words.length; i += 1) {
        const parsed = numberPhraseAt(words, i);
        if (parsed) {
            result.push(String(parsed.value));
            i = parsed.endIndex;
        } else {
            result.push(words[i]);
        }
    }
    return result.join(" ").trim();
}

function numberPhraseAt(
    words: string[],
    startIndex: number,
): { value: number; endIndex: number } | undefined {
    const first = NUMBER_WORD_VALUES.get(words[startIndex]);
    if (first === undefined) return undefined;
    if (words[startIndex + 1] !== "hundred") {
        const second = NUMBER_WORD_VALUES.get(words[startIndex + 1]);
        if (
            first >= 20 &&
            first % 10 === 0 &&
            second !== undefined &&
            second < 10
        ) {
            return { value: first + second, endIndex: startIndex + 1 };
        }
        return { value: first, endIndex: startIndex };
    }
    const tail = NUMBER_WORD_VALUES.get(words[startIndex + 2]);
    if (tail !== undefined && tail < 100) {
        return { value: first * 100 + tail, endIndex: startIndex + 2 };
    }
    return { value: first * 100, endIndex: startIndex + 1 };
}

function stripFillers(values: string[]): string[] {
    return values.filter((value) => !FILLER_WORDS.has(value));
}

function scoreDomainTermRecall(input: {
    domainTerms?: string[];
    candidateText: string;
}): IDomainTermRecallDetails | undefined {
    const domainTerms = input.domainTerms ?? [];
    if (domainTerms.length === 0) return undefined;
    const candidateTokens = tokens(normalizeTranscript(input.candidateText));
    const missed = domainTerms.filter((term) => {
        const termTokens = tokens(normalizeTranscript(term));
        return (
            termTokens.length > 0 &&
            !containsTokenSequence(candidateTokens, termTokens)
        );
    });
    const matched = domainTerms.length - missed.length;
    return {
        matched,
        expected: domainTerms.length,
        recall: matched / domainTerms.length,
        missed,
    };
}

/** True when `needle` appears as consecutive tokens in `haystack`. */
function containsTokenSequence(haystack: string[], needle: string[]): boolean {
    if (needle.length === 0) return true;
    if (needle.length > haystack.length) return false;
    for (let i = 0; i <= haystack.length - needle.length; i += 1) {
        let matched = true;
        for (let j = 0; j < needle.length; j += 1) {
            if (haystack[i + j] !== needle[j]) {
                matched = false;
                break;
            }
        }
        if (matched) return true;
    }
    return false;
}

function scoreNumericAccuracy(input: {
    expectedNumbers?: number[];
    candidateText: string;
}): INumericAccuracyDetails | undefined {
    const expectedNumbers = input.expectedNumbers ?? [];
    if (expectedNumbers.length === 0) return undefined;
    const candidateNumbers = numbersInText(input.candidateText);
    const remaining = [...candidateNumbers];
    const missed: number[] = [];
    let matched = 0;
    for (const expected of expectedNumbers) {
        const index = remaining.findIndex((value) => value === expected);
        if (index >= 0) {
            matched += 1;
            remaining.splice(index, 1);
        } else {
            missed.push(expected);
        }
    }
    return {
        matched,
        expected: expectedNumbers.length,
        accuracy: matched / expectedNumbers.length,
        missed,
    };
}

function numbersInText(text: string): number[] {
    return [...normalizeTranscript(text).matchAll(/\b\d+(?:\.\d+)?\b/g)].map(
        (match) => Number(match[0]),
    );
}

function tokens(text: string): string[] {
    return text ? text.split(" ") : [];
}

function errorRate(counts: IEditCounts): number {
    if (counts.referenceLength === 0) {
        return counts.insertions > 0 ? 1 : 0;
    }
    return (
        (counts.substitutions + counts.deletions + counts.insertions) /
        counts.referenceLength
    );
}
