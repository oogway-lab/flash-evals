import type { ITranscriptSegment } from "../../../db/jsonTypes";
import type {
    ITranscriptArtifact,
    ITranscriptionProviderInput,
} from "../types";
import {
    booleanConfig,
    bufferToUint8Array,
    fetchWithTimeout,
    isRecord,
    numberConfig,
    numberProperty,
    speakersFromSegments,
    stringConfig,
    stringProperty,
} from "./shared";

// Base64 expands audio by roughly one third; this keeps the full JSON request under 20 MB.
const INLINE_AUDIO_LIMIT = 14 * 1024 * 1024;
const MAX_OUTPUT_TOKENS = 32_768;

export async function transcribeWithGemini(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    if (!input.geminiApiKey) {
        throw new Error("Add a Gemini API key to run audio transcription.");
    }
    const mimeType = geminiMimeType(input.mimeType);
    if (!mimeType) {
        throw new Error(
            `Gemini transcription does not support ${input.mimeType}; use WAV, MP3, AAC, OGG, or FLAC audio.`,
        );
    }
    const audioPart =
        input.bytes.byteLength <= INLINE_AUDIO_LIMIT
            ? {
                  inlineData: {
                      mimeType,
                      data: input.bytes.toString("base64"),
                  },
              }
            : await uploadGeminiFile(input, mimeType);
    const response = await fetchWithTimeout(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(input.canonicalModelId)}:generateContent`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": input.geminiApiKey,
            },
            body: JSON.stringify({
                contents: [
                    {
                        parts: [
                            { text: transcriptionInstruction(input) },
                            audioPart,
                        ],
                    },
                ],
                generationConfig: generationConfig(input),
            }),
        },
    );
    const parsed = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
        throw new Error(
            `Gemini transcription failed (${response.status})${geminiErrorSuffix(parsed)}`,
        );
    }
    const result = geminiResult(parsed);
    const segments = geminiSegments(result.segments);
    const text =
        result.text?.trim() ||
        segments
            .map((segment) => segment.text)
            .join(" ")
            .trim();
    if (!text) throw new Error("Gemini transcription returned empty text.");
    const usage = geminiUsage(parsed);
    return {
        text,
        segments,
        speakers: speakersFromSegments(segments),
        providerMetadata: {
            raw: parsed,
            diarizationMode: booleanConfig(input.config, "diarization", false)
                ? "prompt-derived"
                : undefined,
            ...(usage ? { usage } : {}),
        },
        warnings: [],
    };
}

const GEMINI_AUDIO_MIME_TYPES = new Set([
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/aac",
    "audio/ogg",
    "audio/flac",
]);

function generationConfig(
    input: ITranscriptionProviderInput,
): Record<string, unknown> {
    const temperature = numberConfig(input.config, "temperature");
    const thinkingBudget = thinkingBudgetFor(input.config);
    return {
        responseMimeType: "application/json",
        responseSchema: {
            type: "OBJECT",
            properties: {
                text: { type: "STRING" },
                segments: {
                    type: "ARRAY",
                    items: {
                        type: "OBJECT",
                        properties: {
                            speaker: { type: "STRING" },
                            text: { type: "STRING" },
                            startMs: { type: "INTEGER" },
                            endMs: { type: "INTEGER" },
                        },
                        required: ["text"],
                    },
                },
            },
            required: ["text", "segments"],
        },
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        ...(temperature !== undefined ? { temperature } : {}),
        ...(thinkingBudget !== undefined
            ? { thinkingConfig: { thinkingBudget } }
            : {}),
    };
}

function transcriptionInstruction(input: ITranscriptionProviderInput): string {
    const prompt = stringConfig(input.config, "prompt");
    const language = input.language
        ? ` Use language hint ${input.language}.`
        : "";
    const diarization = booleanConfig(input.config, "diarization", false)
        ? " Identify speakers and include speaker labels; this is prompt-derived diarization."
        : "";
    const timestampGranularity = stringConfig(
        input.config,
        "timestampGranularity",
    );
    const timestamps =
        timestampGranularity === "word"
            ? " Return one segment per spoken word with startMs and endMs timestamps."
            : timestampGranularity === "segment"
              ? " Include startMs and endMs timestamps for each transcript segment."
              : "";
    return `Transcribe the supplied audio faithfully.${language}${diarization}${timestamps} Return only the requested JSON.${prompt ? ` Additional guidance: ${prompt}` : ""}`;
}

function thinkingBudgetFor(
    config: Record<string, unknown> | undefined,
): number | undefined {
    const explicit = numberConfig(config, "thinkingBudgetTokens");
    if (explicit !== undefined) return explicit;
    switch (stringConfig(config, "thinking")) {
        case "low":
            return 1024;
        case "medium":
            return 4096;
        case "high":
            return 8192;
        default:
            return undefined;
    }
}

async function uploadGeminiFile(
    input: ITranscriptionProviderInput,
    mimeType: string,
): Promise<{ fileData: { mimeType: string; fileUri: string } }> {
    const start = await fetchWithTimeout(
        "https://generativelanguage.googleapis.com/upload/v1beta/files",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": input.geminiApiKey!,
                "X-Goog-Upload-Protocol": "resumable",
                "X-Goog-Upload-Command": "start",
                "X-Goog-Upload-Header-Content-Length": String(
                    input.bytes.byteLength,
                ),
                "X-Goog-Upload-Header-Content-Type": mimeType,
            },
            body: JSON.stringify({ file: { displayName: "mosaic-stt-audio" } }),
        },
    );
    if (!start.ok) {
        throw new Error(`Gemini file upload start failed (${start.status}).`);
    }
    const uploadUrl = start.headers.get("x-goog-upload-url");
    if (!uploadUrl)
        throw new Error("Gemini file upload returned no upload URL.");
    const upload = await fetchWithTimeout(uploadUrl, {
        method: "POST",
        headers: {
            "Content-Type": mimeType,
            "X-Goog-Upload-Offset": "0",
            "X-Goog-Upload-Command": "upload, finalize",
        },
        body: bufferToUint8Array(input.bytes),
    });
    const parsed = (await upload.json().catch(() => undefined)) as unknown;
    if (!upload.ok || !isRecord(parsed) || !isRecord(parsed.file)) {
        throw new Error(
            `Gemini file upload failed (${upload.status})${geminiErrorSuffix(parsed)}`,
        );
    }
    const fileUri = stringProperty(parsed.file, "uri");
    if (!fileUri) throw new Error("Gemini file upload returned no file URI.");
    return { fileData: { mimeType, fileUri } };
}

function geminiMimeType(mimeType: string): string | undefined {
    if (mimeType === "audio/mpeg") return "audio/mp3";
    if (mimeType === "audio/x-wav") return "audio/wav";
    return GEMINI_AUDIO_MIME_TYPES.has(mimeType) ? mimeType : undefined;
}

function geminiResult(value: unknown): { text?: string; segments?: unknown } {
    if (!isRecord(value) || !Array.isArray(value.candidates)) return {};
    const candidate = value.candidates[0];
    if (
        !isRecord(candidate) ||
        !isRecord(candidate.content) ||
        !Array.isArray(candidate.content.parts)
    )
        return {};
    const part = candidate.content.parts.find(
        (item) => isRecord(item) && typeof item.text === "string",
    );
    if (!isRecord(part)) return {};
    try {
        const parsed = JSON.parse(String(part.text)) as unknown;
        if (!isRecord(parsed)) return {};
        return {
            text: stringProperty(parsed, "text"),
            segments: parsed.segments,
        };
    } catch {
        return {};
    }
}

function geminiSegments(value: unknown): ITranscriptSegment[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const text = stringProperty(item, "text")?.trim();
        if (!text) return [];
        return [
            {
                text,
                ...(stringProperty(item, "speaker")
                    ? { speaker: stringProperty(item, "speaker") }
                    : {}),
                ...(numberProperty(item, "startMs") !== undefined
                    ? { startMs: numberProperty(item, "startMs") }
                    : {}),
                ...(numberProperty(item, "endMs") !== undefined
                    ? { endMs: numberProperty(item, "endMs") }
                    : {}),
            },
        ];
    });
}

function geminiUsage(
    value: unknown,
): NonNullable<ITranscriptArtifact["providerMetadata"]>["usage"] | undefined {
    if (!isRecord(value) || !isRecord(value.usageMetadata)) return undefined;
    const usage = value.usageMetadata;
    const inputTokens = numberProperty(usage, "promptTokenCount");
    const outputTokens = numberProperty(usage, "candidatesTokenCount");
    const thinkingTokens = numberProperty(usage, "thoughtsTokenCount");
    const totalTokens = numberProperty(usage, "totalTokenCount");
    if (
        [inputTokens, outputTokens, thinkingTokens, totalTokens].every(
            (item) => item === undefined,
        )
    )
        return undefined;
    return { inputTokens, outputTokens, thinkingTokens, totalTokens };
}

function geminiErrorSuffix(value: unknown): string {
    if (!isRecord(value)) return "";
    const error = isRecord(value.error) ? value.error : value;
    const message = stringProperty(error, "message");
    return message ? `: ${message}` : "";
}
