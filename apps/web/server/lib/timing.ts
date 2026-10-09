type TimingMetadata = Record<string, string | number | boolean | undefined>;

const DEFAULT_SLOW_MS = 1000;

export async function timedSpan<T>(
    span: string,
    fn: () => Promise<T>,
    metadata: TimingMetadata = {},
): Promise<T> {
    const start = performance.now();
    try {
        return await fn();
    } finally {
        const durationMs = performance.now() - start;
        if (shouldLogTiming(durationMs)) {
            console.info(formatTimingLog(span, durationMs, metadata));
        }
    }
}

function shouldLogTiming(durationMs: number): boolean {
    if (process.env.MOSAIC_TIMING_LOGS === "true") return true;
    return durationMs >= slowThresholdMs();
}

function slowThresholdMs(): number {
    const raw = process.env.MOSAIC_TIMING_SLOW_MS;
    if (!raw) return DEFAULT_SLOW_MS;

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_SLOW_MS;
}

function formatTimingLog(
    span: string,
    durationMs: number,
    metadata: TimingMetadata,
): string {
    const fields = [
        "mosaic_timing",
        `span=${sanitizeLogValue(span)}`,
        `duration_ms=${Math.round(durationMs)}`,
    ];

    for (const [key, value] of Object.entries(metadata)) {
        if (value === undefined) continue;
        fields.push(`${sanitizeLogValue(key)}=${sanitizeLogValue(String(value))}`);
    }

    return fields.join(" ");
}

function sanitizeLogValue(value: string): string {
    return value.replace(/[^a-zA-Z0-9._:/-]/g, "_");
}

