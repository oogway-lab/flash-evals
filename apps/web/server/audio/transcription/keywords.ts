export function parseSttKeywords(value: unknown): string[] {
    if (typeof value !== "string") return [];
    const seen = new Set<string>();
    return value.split(",").flatMap((entry) => {
        const term = entry.trim();
        if (!term || seen.has(term)) return [];
        seen.add(term);
        return [term];
    });
}

export function promptWithKeywords(
    prompt: string | undefined,
    keywordValue: unknown,
): string | undefined {
    const keywords = parseSttKeywords(keywordValue);
    if (keywords.length === 0) return prompt;
    return [prompt?.trim(), keywords.join(", ")].filter(Boolean).join("\n");
}
