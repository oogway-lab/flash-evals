import { createGateway } from "@ai-sdk/gateway";
import type { ITranscriptArtifact, ITranscriptionProviderInput } from "../types";
import {
    bufferToUint8Array,
    speakersFromSegments,
    stringConfig,
    transcriptSegments,
} from "./shared";

type GatewayTranscriptionInput = Parameters<
    ReturnType<ReturnType<typeof createGateway>["transcription"]>["doGenerate"]
>[0];

export async function transcribeWithVercelGateway(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    if (!input.aiGatewayApiKey) {
        throw new Error("Add AI_GATEWAY_API_KEY to run Vercel Gateway transcription.");
    }

    const gateway = createGateway({ apiKey: input.aiGatewayApiKey });
    const result = await gateway.transcription(input.canonicalModelId).doGenerate({
        audio: bufferToUint8Array(input.bytes),
        mediaType: input.mimeType,
        providerOptions: vercelProviderOptions(input.config),
    });
    const text = result.text.trim();
    if (!text) throw new Error("Vercel Gateway transcription returned empty text.");
    const segments = transcriptSegments(result.segments);
    const detectedLanguage = result.language?.trim() ?? "";
    return {
        text,
        segments,
        speakers: speakersFromSegments(segments),
        ...(detectedLanguage ? { detectedLanguage } : {}),
        providerMetadata: {
            raw: {
                providerMetadata: result.providerMetadata,
                response: result.response,
            },
            ...(typeof result.durationInSeconds === "number"
                ? { durationInSeconds: result.durationInSeconds }
                : {}),
            ...(detectedLanguage ? { detectedLanguage } : {}),
        },
        warnings: result.warnings.map((warning) => JSON.stringify(warning)),
    };
}

function vercelProviderOptions(
    config: Record<string, unknown> | undefined,
): NonNullable<GatewayTranscriptionInput["providerOptions"]> {
    const timestampGranularity = stringConfig(config, "timestampGranularity");
    if (!timestampGranularity) return {};
    return {
        openai: {
            timestampGranularities: [timestampGranularity],
        },
    };
}
