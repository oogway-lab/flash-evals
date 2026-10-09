import { isRecord } from "../lib/objects";
import type {
    AudioReferenceKind,
    IAudioReferenceLabel,
    IAudioSpeakerTurn,
    LabelJson,
} from "../db/jsonTypes";

export function audioReferenceFromLabel(
    label: LabelJson | undefined,
): IAudioReferenceLabel | undefined {
    if (!label) return undefined;
    const source = isRecord(label.stt) ? label.stt : label;
    const reference = compactReference({
        referenceKind: referenceKindValue(source.referenceKind),
        expectedTranscript: firstStringValue(source, [
            "expectedTranscript",
            "transcript",
            "nativeTranscript",
        ]),
        expectedTranscriptLatin: firstStringValue(source, [
            "expectedTranscriptLatin",
            "expectedLatinTranscript",
            "latinTranscript",
        ]),
        expectedLanguage: stringValue(source.expectedLanguage),
        audioDurationMs: numberValue(source.audioDurationMs ?? source.audioDuration),
        expectedSpeakerTurns: speakerTurnsValue(source.expectedSpeakerTurns),
        domainTerms: stringArrayValue(
            source.domainTerms ?? source.expectedDomainTerms,
        ),
        expectedNumbers: numberArrayValue(source.expectedNumbers ?? source.numbers),
        latencySlaMs: numberValue(source.latencySlaMs),
        costOutlierUsd: numberValue(source.costOutlierUsd),
    });
    return Object.keys(reference).length > 0 ? reference : undefined;
}

function compactReference(
    reference: IAudioReferenceLabel,
): IAudioReferenceLabel {
    return Object.fromEntries(
        Object.entries(reference).filter(([, value]) => value !== undefined),
    ) as IAudioReferenceLabel;
}

function referenceKindValue(value: unknown): AudioReferenceKind | undefined {
    const referenceKind = stringValue(value);
    return isAudioReferenceKind(referenceKind) ? referenceKind : undefined;
}

function firstStringValue(
    source: Record<string, unknown>,
    keys: string[],
): string | undefined {
    for (const key of keys) {
        const value = stringValue(source[key]);
        if (value) return value;
    }
    return undefined;
}

export function validateAudioReferenceLabel(label: LabelJson): string[] {
    const source = isRecord(label.stt) ? label.stt : label;
    const errors: string[] = [];
    const referenceKind = stringValue(source.referenceKind);
    if (referenceKind && !isAudioReferenceKind(referenceKind)) {
        errors.push(
            "referenceKind must be one of human_gold, silver, or prod_reference.",
        );
    }
    if (
        source.expectedSpeakerTurns !== undefined &&
        !speakerTurnsValue(source.expectedSpeakerTurns)
    ) {
        errors.push(
            "expectedSpeakerTurns must contain speaker/text objects with optional numeric startMs/endMs.",
        );
    }
    if (
        source.domainTerms !== undefined &&
        !stringArrayValue(source.domainTerms)
    ) {
        errors.push("domainTerms must be an array of non-empty strings.");
    }
    if (
        source.expectedNumbers !== undefined &&
        !numberArrayValue(source.expectedNumbers)
    ) {
        errors.push("expectedNumbers must be an array of finite numbers.");
    }
    if (
        source.latencySlaMs !== undefined &&
        numberValue(source.latencySlaMs) === undefined
    ) {
        errors.push("latencySlaMs must be a finite number.");
    }
    if (
        source.costOutlierUsd !== undefined &&
        numberValue(source.costOutlierUsd) === undefined
    ) {
        errors.push("costOutlierUsd must be a finite number.");
    }
    return errors;
}

function speakerTurnsValue(value: unknown): IAudioSpeakerTurn[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const turns: IAudioSpeakerTurn[] = [];
    for (const item of value) {
        if (!isRecord(item)) return undefined;
        const speaker = stringValue(item.speaker);
        const text = stringValue(item.text);
        if (!speaker || !text) return undefined;
        const startMs = numberValue(item.startMs);
        const endMs = numberValue(item.endMs);
        turns.push({
            speaker,
            text,
            ...(startMs !== undefined ? { startMs } : {}),
            ...(endMs !== undefined ? { endMs } : {}),
        });
    }
    return turns;
}

function isAudioReferenceKind(
    value: string | undefined,
): value is AudioReferenceKind {
    return (
        value === "human_gold" ||
        value === "silver" ||
        value === "prod_reference"
    );
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const strings = value
        .map((item) => stringValue(item))
        .filter((item): item is string => item !== undefined);
    return strings.length === value.length && strings.length > 0 ? strings : undefined;
}

function numberArrayValue(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const numbers = value
        .map((item) => numberValue(item))
        .filter((item): item is number => item !== undefined);
    return numbers.length === value.length && numbers.length > 0 ? numbers : undefined;
}
