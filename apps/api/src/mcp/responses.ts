export function ok(message: string, data: unknown) {
    const serialized = JSON.stringify(data) ?? "null";
    return {
        content: [
            {
                type: "text" as const,
                text: `${message}\n\n${serialized}`,
            },
        ],
        structuredContent: { data },
    };
}

export function recoverableError(
    error: {
        code: string;
        message: string;
        status: number;
        retryAfterSeconds?: number;
        field?: string;
        remediation?: string;
    },
    requestId: string,
) {
    const details = {
        code: error.code,
        message: error.message,
        status: error.status,
        retryable: error.status === 429 || error.status >= 500,
        ...(error.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        ...(error.field ? { field: error.field } : {}),
        ...(error.remediation ? { remediation: error.remediation } : {}),
        requestId,
    };
    return {
        content: [
            { type: "text" as const, text: JSON.stringify({ error: details }) },
        ],
        structuredContent: { error: details },
        isError: true,
    };
}

export function resourceJson(uri: string, data: unknown) {
    return {
        contents: [
            {
                uri,
                mimeType: "application/json",
                text: JSON.stringify(data),
            },
        ],
    };
}
