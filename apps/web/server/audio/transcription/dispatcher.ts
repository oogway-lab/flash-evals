import { transcribeWithGemini } from "./providers/gemini";
import { transcribeWithOpenAI } from "./providers/openai";
import { transcribeWithOpenRouter } from "./providers/openrouter";
import { transcribeWithSoniox } from "./providers/soniox";
import { transcribeWithVercelGateway } from "./providers/vercel-gateway";
import type { ITranscriptArtifact, ITranscriptionProviderInput } from "./types";

export async function dispatchTranscription(
    input: ITranscriptionProviderInput,
): Promise<ITranscriptArtifact> {
    switch (input.providerId) {
        case "vercel-gateway":
            return transcribeWithVercelGateway(input);
        case "soniox":
            return transcribeWithSoniox(input);
        case "gemini":
            return transcribeWithGemini(input);
        case "openrouter":
            return transcribeWithOpenRouter(input);
        case "bifrost":
            throw new Error(
                "Bifrost uploaded-audio transcription is not enabled until its STT route and response shape are verified.",
            );
        default:
            return transcribeWithOpenAI(input);
    }
}
