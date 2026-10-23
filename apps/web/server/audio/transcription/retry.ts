import { openAiTransportErrorClass } from "@flash-evals/llm-core";
import { errorMessage } from "../../lib/errors";
import { retryAfterMs } from "../../lib/retryAfter";
import type { ITranscriptionAttemptRecord } from "../../db/jsonTypes";
import type { ITranscriptArtifact } from "./types";

export type TranscriptionErrorClass =
    | "timeout"
    | "rate_limit"
    | "upstream_unavailable"
    | "connection"
    | "permanent";

const RETRYABLE_STATUSES = new Map<number, TranscriptionErrorClass>([
    [408, "timeout"],
    [429, "rate_limit"],
    [500, "upstream_unavailable"],
    [502, "upstream_unavailable"],
    [503, "upstream_unavailable"],
    [504, "timeout"],
    [529, "upstream_unavailable"],
]);

const CONNECTION_CODES = new Set([
    "ECONNRESET",
    "ECONNREFUSED",
    "EPIPE",
    "ETIMEDOUT",
    "EAI_AGAIN",
    "UND_ERR_SOCKET",
    "UND_ERR_CONNECT_TIMEOUT",
]);

/**
 * Classify a provider failure. Invalid audio, credentials, configuration, and
 * other 4xx responses are permanent and fail without retrying.
 */
export function classifyTranscriptionError(
    error: unknown,
): TranscriptionErrorClass {
    if (!(error instanceof Error)) return "permanent";
    const status = statusOf(error);
    if (status !== undefined)
        return RETRYABLE_STATUSES.get(status) ?? "permanent";
    const transport = openAiTransportErrorClass(error);
    if (transport) return transport;
    if (
        error.name === "AbortError" ||
        error.name === "TimeoutError" ||
        /\btimed out\b|\btimeout\b/i.test(error.message)
    )
        return "timeout";
    if (
        errorCodes(error).some((code) => CONNECTION_CODES.has(code)) ||
        (error instanceof TypeError && /fetch failed/i.test(error.message))
    )
        return "connection";
    return "permanent";
}

function statusOf(error: Error): number | undefined {
    const direct = (error as { status?: unknown }).status;
    if (typeof direct === "number") return direct;
    // REST adapters report "<Provider> transcription failed (503): ...".
    const match = /\bfailed \((\d{3})\)/.exec(error.message);
    return match ? Number(match[1]) : undefined;
}

/** Socket codes on the error and its causes (fetch nests them two deep). */
function errorCodes(error: Error): string[] {
    const codes: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 4 && current; depth += 1) {
        const code = (current as { code?: unknown }).code;
        if (typeof code === "string") codes.push(code);
        current = (current as { cause?: unknown }).cause;
    }
    return codes;
}

/** A transcription that failed after every allowed attempt. */
export class TranscriptionAttemptsError extends Error {
    constructor(
        readonly attempts: ITranscriptionAttemptRecord[],
        readonly lastError: unknown,
    ) {
        const unknownBilling = attempts.filter(
            (attempt) => attempt.billingUnknown,
        ).length;
        super(
            [
                errorMessage(lastError),
                attempts.length > 1
                    ? `(after ${attempts.length} attempts)`
                    : "",
                unknownBilling > 0
                    ? `${unknownBilling} timed-out request${unknownBilling === 1 ? "" : "s"} may have been billed.`
                    : "",
            ]
                .filter(Boolean)
                .join(" "),
        );
        this.name = "TranscriptionAttemptsError";
    }
}

export interface ITranscriptionRetryPolicy {
    maxAttempts: number;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
}

/**
 * Run one provider request with bounded retries for transient failures. A
 * timed-out request may still be billed by the provider, so its attempt is
 * marked `billingUnknown` rather than counted as free.
 */
export async function transcribeWithRetry(
    run: () => Promise<ITranscriptArtifact>,
    policy: ITranscriptionRetryPolicy,
): Promise<{
    artifact: ITranscriptArtifact;
    attempts: ITranscriptionAttemptRecord[];
}> {
    const sleep =
        policy.sleep ??
        ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = policy.random ?? Math.random;
    const maxAttempts = Math.max(1, policy.maxAttempts);
    const attempts: ITranscriptionAttemptRecord[] = [];
    for (let attempt = 1; ; attempt += 1) {
        const startedAt = Date.now();
        try {
            const artifact = await run();
            attempts.push({
                attempt,
                outcome: "succeeded",
                latencyMs: Date.now() - startedAt,
            });
            return { artifact, attempts };
        } catch (error) {
            const errorClass = classifyTranscriptionError(error);
            attempts.push({
                attempt,
                outcome: "failed",
                errorClass,
                latencyMs: Date.now() - startedAt,
                ...(errorClass === "timeout" ? { billingUnknown: true } : {}),
            });
            if (errorClass === "permanent" || attempt >= maxAttempts)
                throw new TranscriptionAttemptsError(attempts, error);
            const backoff = 2_000 * 2 ** (attempt - 1) * (0.5 + random() / 2);
            await sleep(Math.min(retryAfterMs(error) ?? backoff, 30_000));
        }
    }
}
