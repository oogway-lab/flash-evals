import { REDACTED, redactSecrets } from "@flash-evals/secrets";
import { errorMessage } from "../lib/errors";

/** The most of a provider's message a failed step keeps (as run errors). */
export const MAX_STEP_ERROR_CHARS = 1_000;

/**
 * A provider's message for a failed step, safe to store and show: the key
 * the call used and anything shaped like a key or token removed, white space
 * folded, and capped at `MAX_STEP_ERROR_CHARS`. Undefined when there is none.
 */
export function stepErrorText(
    error: unknown,
    activeCredential?: string,
): string | undefined {
    if (error === undefined || error === null) return undefined;
    let text = errorMessage(error);
    if (activeCredential && activeCredential.length >= 4)
        text = text.split(activeCredential).join(REDACTED);
    text = redactSecrets(text).replace(/\s+/g, " ").trim();
    if (!text) return undefined;
    return text.length > MAX_STEP_ERROR_CHARS
        ? `${text.slice(0, MAX_STEP_ERROR_CHARS)}…`
        : text;
}

/** What a failed step stores as its error (see `stepErrorText`). */
export function failedStepMessage(error: unknown): string {
    return (
        stepErrorText(error instanceof Error ? error.message : String(error)) ??
        "The step failed."
    );
}
