type LogLevel = "info" | "warn" | "error";
type LogMetadata = Record<string, string | number | boolean | undefined>;

export function logApiEvent(
    level: LogLevel,
    event: string,
    metadata: LogMetadata = {},
): void {
    const payload = {
        level,
        event,
        service: "mosaic-api",
        timestamp: new Date().toISOString(),
        ...sanitizeMetadata(metadata),
    };

    const line = JSON.stringify(payload);
    if (level === "error") {
        console.error(line);
    } else if (level === "warn") {
        console.warn(line);
    } else {
        console.info(line);
    }
}

function sanitizeMetadata(metadata: LogMetadata): LogMetadata {
    return Object.fromEntries(
        Object.entries(metadata).filter(([, value]) => value !== undefined),
    );
}
