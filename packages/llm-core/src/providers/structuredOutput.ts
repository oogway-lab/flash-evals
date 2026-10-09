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
