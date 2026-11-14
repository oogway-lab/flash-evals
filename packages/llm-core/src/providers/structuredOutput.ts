import type { ResponseSchema } from "../types.js";

export function parseStructuredOutput(
    text: string,
    schema: ResponseSchema | undefined,
): { parsed?: unknown; schemaViolation?: boolean } {
    if (!schema) return {};

    const trimmed = text.trim();
    if (trimmed.length === 0) return { schemaViolation: true };

    try {
        return { parsed: JSON.parse(trimmed) };
    } catch {
        // Some providers wrap JSON in markdown fences despite json mode — retry once.
        const fenced = stripCodeFence(trimmed);
        if (fenced !== trimmed) {
            try {
                return { parsed: JSON.parse(fenced) };
            } catch {
                return { schemaViolation: true };
            }
        }
        return { schemaViolation: true };
    }
}

function stripCodeFence(text: string): string {
    const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    return match ? match[1] : text;
}

/**
 * The JSON object in a model's reply, for steps that don't ask the provider
 * for strict JSON: the whole reply, a fenced ```json block anywhere in it,
 * or the text from the first `{` to the last `}`. Says why when there is none.
 */
export function extractJsonObject(
    text: string,
): { value: Record<string, unknown> } | { error: string } {
    const trimmed = text.trim();
    if (!trimmed) return { error: "The reply was empty." };
    const candidates = [trimmed];
    for (const match of trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi))
        if (match[1]) candidates.push(match[1].trim());
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first !== -1 && last > first)
        candidates.push(trimmed.slice(first, last + 1));
    let sawJson = false;
    for (const candidate of candidates) {
        try {
            const value = JSON.parse(candidate) as unknown;
            sawJson = true;
            if (
                typeof value === "object" &&
                value !== null &&
                !Array.isArray(value)
            )
                return { value: value as Record<string, unknown> };
        } catch {
            // Try the next candidate.
        }
    }
    return {
        error: sawJson
            ? "The reply's JSON is not an object."
            : "No JSON object was found in the reply.",
    };
}
