import type { ITranscriptSegment } from "../../../db/jsonTypes";
import type {
    ITranscriptArtifact,
    ITranscriptionProviderInput,
} from "../types";
import {
    audioUploadForm,
    fetchWithTimeout,
    isRecord,
    numberProperty,
    numberConfig,
    speakersFromSegments,
    stringConfig,
    stringProperty,
} from "./shared";
import { promptWithKeywords } from "../keywords";

export async function transcribeWithOpenAI(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    if (!input.openaiApiKey) {
        throw new Error("Add OPENAI_API_KEY to run audio transcription.");
    }

    const form = audioUploadForm(input.bytes, input.mimeType);
    form.append("model", input.canonicalModelId);
    if (input.language) form.append("language", input.language);
    const isDiarize = input.canonicalModelId === "gpt-4o-transcribe-diarize";
    const timestampGranularity = appendOpenAIOptions(form, input, isDiarize);

    const response = await fetchWithTimeout(
        "https://api.openai.com/v1/audio/transcriptions",
        {
            method: "POST",
            headers: { Authorization: `Bearer ${input.openaiApiKey}` },
            body: form,
        },
    );
    if (!response.ok) {
        const bodyText = await response.text().catch(() => "");
        throw new Error(
            `Audio transcription failed (${response.status})${bodyText ? `: ${bodyText}` : ""}`,
        );
    }

    const parsed = (await response.json()) as Record<string, unknown>;
    const text = typeof parsed.text === "string" ? parsed.text.trim() : "";
    if (!text) throw new Error("Audio transcription returned empty text.");
    const diarizedSegments = isDiarize ? openAIDiarizedSegments(parsed) : [];
    const usage = openAIUsage(parsed);
    return {
        text,
        segments: isDiarize
            ? diarizedSegments
            : openAITranscriptSegments(parsed, timestampGranularity),
        speakers: isDiarize ? speakersFromSegments(diarizedSegments) : [],
        ...(typeof parsed.language === "string" && parsed.language.trim()
            ? { detectedLanguage: parsed.language.trim() }
            : {}),
        // Only the verbose_json response carries `duration`, and that format is
        // requested solely when a timestamp granularity is configured — so cost
        // stays unpriced for a default-config OpenAI run. gpt-4o-transcribe does
        // not support verbose_json at all, so this cannot simply be forced on.
        ...(typeof parsed.duration === "number" && parsed.duration > 0
            ? { durationMs: Math.round(parsed.duration * 1000) }
            : {}),
        providerMetadata: {
            raw: parsed,
            ...(isDiarize ? { diarizationMode: "native" as const } : {}),
            ...(typeof parsed.duration === "number"
                ? { durationInSeconds: parsed.duration }
                : {}),
            ...(usage ? { usage } : {}),
        },
        warnings: [],
    };
}

// gpt-4o-transcribe(+mini) return a token usage block; whisper-1 and the
// diarize model return none (or duration-based usage), which stays undefined
// so the UI renders "unavailable" rather than zero.
function openAIUsage(
    parsed: Record<string, unknown>,
): NonNullable<ITranscriptArtifact["providerMetadata"]>["usage"] | undefined {
    if (!isRecord(parsed.usage)) return undefined;
    const usage = parsed.usage;
    if (stringProperty(usage, "type") === "duration") return undefined;
    const inputTokens = numberProperty(usage, "input_tokens");
    const outputTokens = numberProperty(usage, "output_tokens");
    const totalTokens = numberProperty(usage, "total_tokens");
    if (
        inputTokens === undefined &&
        outputTokens === undefined &&
        totalTokens === undefined
    ) {
        return undefined;
    }
    return {
        ...(inputTokens !== undefined ? { inputTokens } : {}),
        ...(outputTokens !== undefined ? { outputTokens } : {}),
        ...(totalTokens !== undefined ? { totalTokens } : {}),
    };
}

function appendOpenAIOptions(
    form: FormData,
    input: ITranscriptionProviderInput,
    isDiarize: boolean,
): string | undefined {
    if (isDiarize) {
        form.append("response_format", "diarized_json");
        form.append("chunking_strategy", "auto");
    } else {
        const prompt = promptWithKeywords(
            stringConfig(input.config, "prompt"),
            input.config?.keywords,
        );
        if (prompt) form.append("prompt", prompt);
    }
    const temperature = numberConfig(input.config, "temperature");
    if (temperature !== undefined)
        form.append("temperature", String(temperature));
    const timestampGranularity = stringConfig(
        input.config,
        "timestampGranularity",
    );
    if (timestampGranularity && !isDiarize) {
        form.append("response_format", "verbose_json");
        form.append("timestamp_granularities[]", timestampGranularity);
    }
    return timestampGranularity;
}

function openAIDiarizedSegments(
    parsed: Record<string, unknown>,
): ITranscriptSegment[] {
    if (!Array.isArray(parsed.segments)) return [];
    return parsed.segments.flatMap((item) => {
        if (!isRecord(item)) return [];
        const text = stringProperty(item, "text")?.trim();
        if (!text) return [];
        const speaker = stringProperty(item, "speaker");
        return [
            {
                text,
                ...(speaker ? { speaker } : {}),
                ...secondsToMsRange(item),
            },
        ];
    });
}

function openAITranscriptSegments(
    parsed: Record<string, unknown>,
    timestampGranularity: string | undefined,
): ITranscriptSegment[] {
    if (timestampGranularity === "word") {
        return openAITimedTextSegments(parsed.words, "word");
    }
    if (timestampGranularity === "segment") {
        return openAITimedTextSegments(parsed.segments, "text");
    }
    return [];
}

function openAITimedTextSegments(
    value: unknown,
    textKey: "text" | "word",
): ITranscriptSegment[] {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
        if (!isRecord(item)) return [];
        const text = stringProperty(item, textKey)?.trim();
        if (!text) return [];
        return [{ text, ...secondsToMsRange(item) }];
    });
}

function secondsToMsRange(value: Record<string, unknown>): {
    startMs?: number;
    endMs?: number;
} {
    const start = numberProperty(value, "start");
    const end = numberProperty(value, "end");
    return {
        ...(start !== undefined ? { startMs: Math.round(start * 1000) } : {}),
        ...(end !== undefined ? { endMs: Math.round(end * 1000) } : {}),
    };
}
