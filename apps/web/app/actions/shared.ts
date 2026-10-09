import { unstable_rethrow } from "next/navigation";
import { clientErrorMessage } from "@/server/lib/errors";
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
