export function ok(message: string, data: unknown) {
    return {
        content: [
            {
                type: "text" as const,
                text: `${message}\n\n${JSON.stringify(data, null, 2)}`,
            },
        ],
        structuredContent: { data },
    };
}

export function resourceJson(uri: string, data: unknown) {
    return {
        contents: [
            {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
}
