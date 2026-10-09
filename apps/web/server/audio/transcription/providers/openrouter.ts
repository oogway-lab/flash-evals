import type { ITranscriptSegment } from "../../../db/jsonTypes";
import { transcribeOpenRouterAudio } from "@mosaic/llm-core";
import type {
    ITranscriptArtifact,
    ITranscriptionProviderInput,
} from "../types";
import {
    audioUploadForm,
    fetchWithTimeout,
    isRecord,
    numberConfig,
    numberProperty,
    stringConfig,
    stringProperty,
} from "./shared";

export async function transcribeWithOpenRouter(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    if (!input.openrouterApiKey) {
        throw new Error(
            "Add an OpenRouter API key to run audio transcription.",
        );
    }
    if (input.canonicalModelId === "google/gemini-3.8-flash") {
        const result = await transcribeOpenRouterAudio({
            apiKey: input.openrouterApiKey,
            modelId: input.canonicalModelId,
            base64Data: input.bytes.toString("base64"),
            mimeType: input.mimeType,
            language: input.language,
            prompt: stringConfig(input.config, "prompt"),
        });
        return {
            text: result.text,
            segments: [],
            speakers: [],
            warnings: [],
            providerMetadata: {
                promptSupported: true,
                usage: result.usage,
                ...(result.costUsd !== undefined
                    ? {
                          costUsd: result.costUsd,
                          costSource: "computed" as const,
                      }
                    : {}),
            },
        };
    }
    const form = audioUploadForm(input.bytes, input.mimeType);
    form.append("model", `openai/${input.canonicalModelId}`);
    form.append("response_format", "verbose_json");
    if (input.language) form.append("language", input.language);
    const temperature = numberConfig(input.config, "temperature");
    if (temperature !== undefined)
        form.append("temperature", String(temperature));
    if (stringConfig(input.config, "timestampGranularity") === "word") {
        form.append("timestamp_granularities[]", "word");
    }

    const response = await fetchWithTimeout(
        "https://openrouter.ai/api/v1/audio/transcriptions",
        {
            method: "POST",
            headers: { Authorization: `Bearer ${input.openrouterApiKey}` },
            body: form,
        },
    );
    const parsed = (await response.json().catch(() => undefined)) as unknown;
    if (!response.ok) {
        throw new Error(
            `OpenRouter transcription failed (${response.status})${providerErrorSuffix(parsed)}`,
        );
    }
    if (!isRecord(parsed))
        throw new Error("OpenRouter returned an invalid response.");
    const text = stringProperty(parsed, "text")?.trim();
    if (!text) throw new Error("OpenRouter transcription returned empty text.");
    const usage = openRouterUsage(parsed);
    const costUsd = isRecord(parsed.usage)
        ? numberProperty(parsed.usage, "cost")
        : undefined;
    return {
        text,
        segments: openRouterSegments(parsed),
        speakers: [],
        ...(stringProperty(parsed, "language")
            ? { detectedLanguage: stringProperty(parsed, "language") }
            : {}),
        providerMetadata: {
            raw: parsed,
            promptSupported: false,
            ...(usage ? { usage } : {}),
            ...(costUsd !== undefined
                ? { costUsd, costSource: "computed" as const }
                : {}),
        },
        warnings: [],
    };
}

function openRouterUsage(
    parsed: Record<string, unknown>,
): NonNullable<ITranscriptArtifact["providerMetadata"]>["usage"] | undefined {
    if (!isRecord(parsed.usage)) return undefined;
    const inputTokens = numberProperty(parsed.usage, "input_tokens");
    const outputTokens = numberProperty(parsed.usage, "output_tokens");
    const totalTokens = numberProperty(parsed.usage, "total_tokens");
    if (
        [inputTokens, outputTokens, totalTokens].every(
            (value) => value === undefined,
        )
    ) {
        return undefined;
    }
    return { inputTokens, outputTokens, totalTokens };
}

function openRouterSegments(
    parsed: Record<string, unknown>,
): ITranscriptSegment[] {
    const values = Array.isArray(parsed.words)
        ? parsed.words
        : Array.isArray(parsed.segments)
          ? parsed.segments
          : [];
    return values.flatMap((value) => {
        if (!isRecord(value)) return [];
        const text =
            stringProperty(value, "word")?.trim() ??
            stringProperty(value, "text")?.trim();
        if (!text) return [];
        const start = numberProperty(value, "start");
        const end = numberProperty(value, "end");
        return [
            {
                text,
                ...(start !== undefined
                    ? { startMs: Math.round(start * 1000) }
                    : {}),
                ...(end !== undefined ? { endMs: Math.round(end * 1000) } : {}),
            },
        ];
    });
}

function providerErrorSuffix(value: unknown): string {
    if (!isRecord(value)) return "";
    const error = value.error;
    const message = isRecord(error)
        ? stringProperty(error, "message")
        : stringProperty(value, "message");
    return message ? `: ${message}` : "";
}
