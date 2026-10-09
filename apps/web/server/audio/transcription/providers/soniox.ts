import type { ITranscriptSegment } from "../../../db/jsonTypes";
import type {
    ITranscriptArtifact,
    ITranscriptionProviderInput,
} from "../types";
import {
    audioUploadForm,
    booleanConfig,
    fetchWithTimeout,
    firstNumberProperty,
    firstStringProperty,
    isRecord,
    sleep,
    speakersFromSegments,
    stringConfig,
    stringProperty,
} from "./shared";
import { parseSttKeywords } from "../keywords";

export async function transcribeWithSoniox(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    if (!input.sonioxApiKey) {
        throw new Error("Add SONIOX_API_KEY to run Soniox transcription.");
    }
    const fileId = await uploadSonioxFile(input);
    const transcriptionId = await createSonioxTranscription({
        fileId,
        canonicalModelId: input.canonicalModelId,
        language: input.language,
        config: input.config,
        sonioxApiKey: input.sonioxApiKey,
    });
    await waitForSonioxTranscription({
        transcriptionId,
        sonioxApiKey: input.sonioxApiKey,
    });
    return getSonioxTranscript({
        transcriptionId,
        sonioxApiKey: input.sonioxApiKey,
    });
}

async function uploadSonioxFile(
    input: ITranscriptionProviderInput,
): Promise<string> {
    const form = audioUploadForm(input.bytes, input.mimeType);
    const response = await fetchWithTimeout("https://api.soniox.com/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${input.sonioxApiKey}` },
        body: form,
    });
    const parsed = await parseSonioxJson(response, "Soniox file upload");
    const id = stringProperty(parsed, "id");
    if (!id) throw new Error("Soniox file upload returned no file id.");
    return id;
}

async function createSonioxTranscription(input: {
    fileId: string;
    canonicalModelId: string;
    language: string | undefined;
    config?: Record<string, unknown>;
    sonioxApiKey: string;
}): Promise<string> {
    const contextText = stringConfig(input.config, "context");
    const contextTerms = parseSttKeywords(input.config?.keywords);
    const context =
        contextText || contextTerms.length > 0
            ? {
                  ...(contextText ? { text: contextText } : {}),
                  ...(contextTerms.length > 0 ? { terms: contextTerms } : {}),
              }
            : undefined;
    const response = await fetchWithTimeout(
        "https://api.soniox.com/v1/transcriptions",
        {
            method: "POST",
            headers: {
                Authorization: `Bearer ${input.sonioxApiKey}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                model: input.canonicalModelId,
                file_id: input.fileId,
                ...(input.language ? { language_hints: [input.language] } : {}),
                enable_speaker_diarization: booleanConfig(
                    input.config,
                    "diarization",
                    false,
                ),
                enable_language_identification: true,
                ...(context ? { context } : {}),
            }),
        },
    );
    const parsed = await parseSonioxJson(
        response,
        "Soniox transcription create",
    );
    const id = stringProperty(parsed, "id");
    if (!id) throw new Error("Soniox transcription create returned no id.");
    return id;
}

async function waitForSonioxTranscription(input: {
    transcriptionId: string;
    sonioxApiKey: string;
}): Promise<void> {
    const maxWaitMs = 10 * 60_000;
    const startedAt = Date.now();
    let delayMs = 1_000;
    while (Date.now() - startedAt < maxWaitMs) {
        const response = await fetchWithTimeout(
            `https://api.soniox.com/v1/transcriptions/${input.transcriptionId}`,
            {
                method: "GET",
                headers: { Authorization: `Bearer ${input.sonioxApiKey}` },
            },
        );
        const parsed = await parseSonioxJson(
            response,
            "Soniox transcription status",
        );
        const status = stringProperty(parsed, "status");
        if (status === "completed") return;
        if (status === "error") {
            throw new Error(
                `Soniox transcription failed: ${
                    stringProperty(parsed, "error_message") ?? "Unknown error"
                }`,
            );
        }
        await sleep(delayMs);
        delayMs = Math.min(delayMs + 1_000, 5_000);
    }
    throw new Error("Soniox transcription timed out.");
}

async function getSonioxTranscript(input: {
    transcriptionId: string;
    sonioxApiKey: string;
}): Promise<ITranscriptArtifact> {
    const response = await fetchWithTimeout(
        `https://api.soniox.com/v1/transcriptions/${input.transcriptionId}/transcript`,
        {
            method: "GET",
            headers: { Authorization: `Bearer ${input.sonioxApiKey}` },
        },
    );
    const parsed = await parseSonioxJson(response, "Soniox transcript fetch");
    const text = stringProperty(parsed, "text")?.trim() ?? "";
    if (!text) throw new Error("Soniox transcription returned empty text.");
    const segments = sonioxSegments(parsed);
    const language = segments.find((segment) => segment.language)?.language;
    const durationMs = sonioxDurationMs(parsed);
    return {
        text,
        segments,
        speakers: speakersFromSegments(segments),
        ...(language ? { detectedLanguage: language } : {}),
        ...(durationMs !== undefined ? { durationMs } : {}),
        providerMetadata: { raw: parsed },
        warnings: [],
    };
}

// Soniox reports no explicit audio length; the final token's end offset is the
// closest thing to one, and it is what the per-hour price applies to.
function sonioxDurationMs(parsed: unknown): number | undefined {
    if (!isRecord(parsed) || !Array.isArray(parsed.tokens)) return undefined;
    let end: number | undefined;
    for (const token of parsed.tokens) {
        if (!isRecord(token)) continue;
        const value = token.end_ms;
        if (typeof value === "number" && Number.isFinite(value))
            end = end === undefined ? value : Math.max(end, value);
    }
    return end;
}

function sonioxSegments(parsed: unknown): ITranscriptSegment[] {
    if (!isRecord(parsed) || !Array.isArray(parsed.tokens)) return [];
    const segments: ITranscriptSegment[] = [];
    for (const token of parsed.tokens) {
        const segment = segmentFromSonioxToken(token);
        if (!segment) continue;
        const previous = segments[segments.length - 1];
        if (previous && canMergeSonioxSegments(previous, segment)) {
            previous.text = `${previous.text}${tokenJoiner(previous.text, segment.text)}${segment.text}`;
            previous.endMs = segment.endMs ?? previous.endMs;
            continue;
        }
        segments.push(segment);
    }
    return segments;
}

function segmentFromSonioxToken(
    token: unknown,
): ITranscriptSegment | undefined {
    if (!isRecord(token)) return undefined;
    const text = firstStringProperty(token, ["text", "word", "token"]);
    if (!text) return undefined;
    const speaker = firstStringProperty(token, [
        "speaker",
        "speaker_id",
        "speakerId",
    ]);
    const language = firstStringProperty(token, [
        "language",
        "language_code",
        "languageCode",
    ]);
    const startMs = firstNumberProperty(token, ["start_ms", "startMs"]);
    const endMs = firstNumberProperty(token, ["end_ms", "endMs"]);
    return {
        text,
        ...(speaker ? { speaker } : {}),
        ...(language ? { language } : {}),
        ...(startMs !== undefined ? { startMs } : {}),
        ...(endMs !== undefined ? { endMs } : {}),
    };
}

function canMergeSonioxSegments(
    previous: ITranscriptSegment,
    next: ITranscriptSegment,
): boolean {
    return (
        previous.speaker === next.speaker &&
        previous.language === next.language &&
        previous.endMs !== undefined &&
        next.startMs !== undefined &&
        next.startMs - previous.endMs <= 250
    );
}

function tokenJoiner(left: string, right: string): string {
    return /^[.,!?;:)]/.test(right) || left.endsWith("(") ? "" : " ";
}

async function parseSonioxJson(
    response: Response,
    label: string,
): Promise<unknown> {
    const parsed = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
        const message =
            (isRecord(parsed) && stringProperty(parsed, "message")) || "";
        throw new Error(
            `${label} failed (${response.status})${message ? `: ${message}` : ""}`,
        );
    }
    return parsed;
}
