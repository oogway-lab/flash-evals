type WorkerLogLevel = "info" | "warn" | "error";

const SAFE_ERROR_NAMES = new Set([
    "Error",
    "TypeError",
    "RangeError",
    "ReferenceError",
    "SyntaxError",
    "URIError",
    "EvalError",
    "AggregateError",
    "AbortError",
    "TimeoutError",
    "DatabaseError",
]);

const SAFE_ERROR_CODES = new Set([
    "08000",
    "08001",
    "08003",
    "08006",
    "08P01",
    "22001",
    "22003",
    "22P02",
    "23502",
    "23503",
    "23505",
    "23514",
    "25P02",
    "28P01",
    "40001",
    "40P01",
    "42601",
    "42703",
    "42P01",
    "42P07",
    "42883",
    "57014",
    "57P01",
    "57P02",
    "ECONNABORTED",
    "ECONNREFUSED",
    "ECONNRESET",
    "EHOSTUNREACH",
    "EPIPE",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "ENOTFOUND",
]);

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
        errorName: SAFE_ERROR_NAMES.has(error.name) ? error.name : "Error",
        ...(typeof code === "string" && SAFE_ERROR_CODES.has(code)
            ? { errorCode: code }
            : {}),
    };
}
