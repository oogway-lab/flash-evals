import { elevenLabsKeyterms } from "@flash-evals/api-contract";
import type { ITranscriptSegment } from "../../../db/jsonTypes";
import {
    EmptyTranscriptError,
    type ITranscriptArtifact,
    type ITranscriptionProviderInput,
} from "../types";
import {
    audioUploadForm,
    booleanConfig,
    fetchWithTimeout,
    isRecord,
    numberProperty,
    speakersFromSegments,
    stringProperty,
} from "./shared";

export const ELEVENLABS_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text";

// The endpoint answers synchronously with the whole transcript, so the request
// stays open while the audio is processed. Long files need a generous budget.
const DEFAULT_TIMEOUT_MS = 10 * 60_000;

// A new segment starts when the speaker changes, after a pause this long, or
// after a word that ends a sentence.
const SEGMENT_PAUSE_MS = 1_000;
const SENTENCE_END = /[.!?।]["')\]]*$/u;

/**
 * ElevenLabs Scribe batch transcription (POST /v1/speech-to-text).
 * API reference: https://elevenlabs.io/docs/api-reference/speech-to-text/convert
 */
export async function transcribeWithElevenLabs(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    if (!input.elevenlabsApiKey) {
        throw new Error(
            "Add your ElevenLabs API key in Settings (or ELEVENLABS_API_KEY in the app's .env) to run ElevenLabs transcription.",
        );
    }
    const diarize = booleanConfig(input.config, "diarization", false);
    const keyterms = elevenLabsKeyterms(input.config?.keywords);
    const form = audioUploadForm(input.bytes, input.mimeType);
    form.append("model_id", input.canonicalModelId);
    const languageCode = elevenLabsLanguageCode(input.language);
    if (languageCode) form.append("language_code", languageCode);
    form.append("diarize", String(diarize));
    form.append("timestamps_granularity", "word");
    // Event tags such as "(laughter)" are not speech and would count as
    // insertions against a reference transcript.
    form.append("tag_audio_events", "false");
    for (const term of keyterms.terms) form.append("keyterms", term);

    const response = await fetchWithTimeout(
        ELEVENLABS_STT_URL,
        {
            method: "POST",
            headers: { "xi-api-key": input.elevenlabsApiKey },
            body: form,
        },
        input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );
    const parsed = await parseElevenLabsJson(response);
    return elevenLabsTranscriptArtifact(parsed, {
        diarize,
        rejectedKeyterms: keyterms.rejected,
    });
}

/**
 * ElevenLabs takes an ISO 639 language code ("hi", "hin"), not a locale; the
 * stored language is lower-cased, so "hi-IN" arrives as "hi-in" and is sent
 * as "hi".
 */
export function elevenLabsLanguageCode(
    language: string | undefined,
): string | undefined {
    const primary = language?.trim().split(/[-_]/)[0]?.toLowerCase();
    return primary || undefined;
}

export function elevenLabsTranscriptArtifact(
    parsed: unknown,
    options: { diarize: boolean; rejectedKeyterms?: string[] },
): ITranscriptArtifact {
    if (isRecord(parsed) && Array.isArray(parsed.transcripts)) {
        throw new Error(
            "ElevenLabs returned a multichannel transcript, which this route does not request.",
        );
    }
    const text = stringProperty(parsed, "text")?.trim() ?? "";
    if (!text)
        throw new EmptyTranscriptError(
            "ElevenLabs transcription returned empty text.",
            { durationMs: elevenLabsDurationMs(parsed) },
        );
    const segments = elevenLabsSegments(parsed);
    const language = stringProperty(parsed, "language_code");
    const durationMs = elevenLabsDurationMs(parsed);
    const rejected = options.rejectedKeyterms ?? [];
    return {
        text,
        segments,
        speakers: speakersFromSegments(segments),
        ...(language ? { detectedLanguage: language } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        providerMetadata: {
            ...(options.diarize ? { diarizationMode: "native" as const } : {}),
            raw: parsed,
        },
        warnings:
            rejected.length > 0
                ? [
                      `ElevenLabs keyword boost skipped ${rejected.length} term(s) over its limits (50 characters, 5 words, no < > { } [ ] \\): ${rejected.join(", ")}.`,
                  ]
                : [],
    };
}

// The response states the billed audio length; the last word's end time is
// the fallback when it is missing.
function elevenLabsDurationMs(parsed: unknown): number | undefined {
    const seconds = numberProperty(parsed, "audio_duration_secs");
    if (seconds !== undefined && seconds > 0) return Math.round(seconds * 1000);
    if (!isRecord(parsed) || !Array.isArray(parsed.words)) return undefined;
    let end: number | undefined;
    for (const word of parsed.words) {
        const value = numberProperty(word, "end");
        if (value !== undefined) end = Math.max(end ?? 0, value);
    }
    return end === undefined ? undefined : Math.round(end * 1000);
}

/**
 * Groups Scribe's word list (words, spacing and audio events, timed in
 * seconds) into transcript segments per speaker turn and sentence.
 */
export function elevenLabsSegments(parsed: unknown): ITranscriptSegment[] {
    if (!isRecord(parsed) || !Array.isArray(parsed.words)) return [];
    const segments: ITranscriptSegment[] = [];
    let current: ITranscriptSegment | undefined;
    let pendingSpace = false;
    for (const entry of parsed.words) {
        const word = scribeWord(entry);
        if (word === "spacing") {
            pendingSpace = current !== undefined;
            continue;
        }
        if (!word) continue;
        if (!current || startsNewSegment(current, word.speaker, word.startMs)) {
            current = word;
            segments.push(current);
        } else {
            current.text = `${current.text}${pendingSpace ? " " : ""}${word.text}`;
            current.endMs = word.endMs ?? current.endMs;
            current.startMs ??= word.startMs;
        }
        pendingSpace = false;
    }
    return segments;
}

/** One Scribe word as a one-word segment; spacing and audio events are not words. */
function scribeWord(
    entry: unknown,
): ITranscriptSegment | "spacing" | undefined {
    if (!isRecord(entry)) return undefined;
    const type = stringProperty(entry, "type") ?? "word";
    if (type === "spacing") return "spacing";
    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (type !== "word" || !text) return undefined;
    const speaker = stringProperty(entry, "speaker_id");
    const startMs = secondsToMs(numberProperty(entry, "start"));
    const endMs = secondsToMs(numberProperty(entry, "end"));
    return {
        text,
        ...(speaker ? { speaker } : {}),
        ...(startMs !== undefined ? { startMs } : {}),
        ...(endMs !== undefined ? { endMs } : {}),
    };
}

function startsNewSegment(
    current: ITranscriptSegment,
    speaker: string | undefined,
    startMs: number | undefined,
): boolean {
    if (current.speaker !== speaker) return true;
    if (SENTENCE_END.test(current.text)) return true;
    return (
        current.endMs !== undefined &&
        startMs !== undefined &&
        startMs - current.endMs > SEGMENT_PAUSE_MS
    );
}

function secondsToMs(value: number | undefined): number | undefined {
    return value === undefined ? undefined : Math.round(value * 1000);
}

async function parseElevenLabsJson(response: Response): Promise<unknown> {
    const parsed = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
        const message = elevenLabsErrorMessage(parsed);
        throw new Error(
            `ElevenLabs transcription failed (${response.status})${message ? `: ${message}` : ""}`,
        );
    }
    return parsed;
}

// Errors arrive as {detail: {message}}, {detail: "text"}, or, for validation
// failures (422), {detail: [{loc, msg}]}.
function elevenLabsErrorMessage(parsed: unknown): string {
    if (!isRecord(parsed)) return "";
    const detail = parsed.detail;
    if (typeof detail === "string") return detail;
    if (isRecord(detail)) return stringProperty(detail, "message") ?? "";
    if (Array.isArray(detail)) {
        return detail
            .map((entry) => stringProperty(entry, "msg"))
            .filter(Boolean)
            .join("; ");
    }
    return stringProperty(parsed, "message") ?? "";
}
