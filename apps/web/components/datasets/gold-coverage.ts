import type { LabelJson } from "@mosaic/api-contract";

export interface IGoldCoverage {
    transcript: boolean;
    latin: boolean;
    speakerTurns: boolean;
}

export function goldCoverage(label: LabelJson | undefined): IGoldCoverage {
    const source = isRecord(label?.stt) ? label.stt : label;
    return {
        transcript: Boolean(
            stringValue(source?.expectedTranscript) ??
            stringValue(source?.transcript) ??
            stringValue(source?.nativeTranscript),
        ),
        latin: Boolean(
            stringValue(source?.expectedTranscriptLatin) ??
            stringValue(source?.expectedLatinTranscript) ??
            stringValue(source?.latinTranscript),
        ),
        speakerTurns:
            Array.isArray(source?.expectedSpeakerTurns) &&
            source.expectedSpeakerTurns.length > 0 &&
            source.expectedSpeakerTurns.every(isValidSpeakerTurn),
    };
}

function isValidSpeakerTurn(value: unknown): boolean {
    if (!isRecord(value)) return false;
    if (!stringValue(value.speaker) || !stringValue(value.text)) return false;
    return [value.startMs, value.endMs].every(
        (timestamp) =>
            timestamp === undefined ||
            (typeof timestamp === "number" && Number.isFinite(timestamp)),
    );
}

function stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
