type WorkerLogLevel = "info" | "warn" | "error";

export interface IWorkerLogMetadata {
    queue?: string;
    runId?: string;
    workflowRunId?: string;
    jobId?: string;
    cellId?: string;
    phase?: string;
    readiness?: "ready" | "not_ready";
    signal?: string;
    errorName?: string;
    errorCode?: string;
    retryCount?: number;
    retryLimit?: number;
    durationMs?: number;
    drainTimeoutMs?: number;
    remainingInFlight?: number;
    recoveredCount?: number;
}

export function logWorkerEvent(
    level: WorkerLogLevel,
    event: string,
    metadata: IWorkerLogMetadata = {},
): void {
    const payload = {
        timestamp: new Date().toISOString(),
        level,
        service: "mosaic-worker",
        event,
        ...metadata,
    };
    const line = JSON.stringify(payload);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
}

export function safeWorkerError(error: unknown): {
    errorName: string;
    errorCode?: string;
} {
    if (!(error instanceof Error)) return { errorName: "UnknownError" };

    const code =
        typeof error === "object" && "code" in error
            ? (error as Error & { code?: unknown }).code
            : undefined;
    return {
        errorName: safeIdentifier(error.name) ?? "Error",
        ...(typeof code === "string" && safeIdentifier(code)
            ? { errorCode: code }
            : {}),
    };
}

function safeIdentifier(value: string): string | undefined {
    return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/.test(value) ? value : undefined;
}
