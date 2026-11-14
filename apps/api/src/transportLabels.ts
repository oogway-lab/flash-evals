import type { ProviderTransport } from "@flash-evals/api-contract";

/** Provider names as they appear in messages and the app. */
export const TRANSPORT_LABELS_FOR_MESSAGES: Record<ProviderTransport, string> =
    {
        gateway: "Vercel AI Gateway",
        openrouter: "OpenRouter",
        openai: "OpenAI",
        anthropic: "Anthropic",
        google: "Gemini API",
        bifrost: "Bifrost",
    };

/** "a Vercel AI Gateway key", "an OpenRouter key", "an OpenAI key". */
export function keyPhrase(transport: ProviderTransport): string {
    const label = TRANSPORT_LABELS_FOR_MESSAGES[transport];
    return `${/^[AEIOU]/.test(label) ? "an" : "a"} ${label} key`;
}
