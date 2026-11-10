import { unstable_rethrow } from "next/navigation";
import type { IRunDataPolicy } from "@flash-evals/api-contract";
import { clientErrorMessage, UserFacingError } from "@/server/lib/errors";
import type { IActionState, IPromptWorkbenchState } from "./types";

export function parseJsonField<T>(
    raw: string,
    field: string,
    fallback: T,
): { ok: true; value: T } | { ok: false; error: string } {
    const trimmed = raw.trim();
    if (!trimmed) return { ok: true, value: fallback };
    try {
        return { ok: true, value: JSON.parse(trimmed) as T };
    } catch {
        const error = `Invalid JSON in "${field}"`;
        return { ok: false, error };
    }
}

export function jsonFieldError(
    field: string,
    error: string,
): IPromptWorkbenchState {
    return { fieldErrors: { [field]: [error] }, formError: error };
}

export async function withActionTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    timeoutMessage: string,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    reject(
                        Object.assign(new Error(timeoutMessage), {
                            name: "TimeoutError",
                        }),
                    );
                }, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Turn a failed mutation into an action result the form can show inline,
 * instead of throwing to the route error screen and losing the user's input.
 * Next.js control flow (redirect, notFound) is rethrown untouched.
 */
export function actionErrorState(err: unknown): IActionState {
    unstable_rethrow(err);
    return { formError: clientErrorMessage(err) };
}

/** A run's spend limit in USD from the form's `maxCostUsd`. Empty means no limit. */
export function parseRunMaxCostUsd(
    formData: FormData,
): number | "invalid" | undefined {
    const raw = String(formData.get("maxCostUsd") || "").trim();
    if (!raw) return undefined;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : "invalid";
}

/** The message shown when the spend limit field is not a positive amount. */
export const INVALID_SPEND_LIMIT_MESSAGE =
    "Enter a spend limit above $0, or leave it empty for no limit.";

// Sent as JSON only when a rule is set; the API checks host names and that
// every call runs through a gateway that can follow the rules.
export function parseRunDataPolicy(
    formData: FormData,
): IRunDataPolicy | undefined {
    const raw = String(formData.get("dataPolicy") || "").trim();
    if (!raw) return undefined;
    if (raw.length > 4_000)
        throw new UserFacingError("Data rules are too large.");
    const result = parseJsonField<IRunDataPolicy | undefined>(
        raw,
        "dataPolicy",
        undefined,
    );
    if (!result.ok) throw new UserFacingError(result.error);
    return result.value;
}
