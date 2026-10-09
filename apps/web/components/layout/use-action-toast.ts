"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

type IToastOptions = Parameters<typeof toast.success>[1];

/**
 * Toast once per new successful action result. `useActionState` returns a new
 * state object for every submission, so identity marks "a new result"; the
 * initial state never toasts. A string message toasts when `state.ok`; a
 * function decides for itself and returns `undefined` to stay quiet.
 */
export function useActionToast<TState extends { ok?: boolean }>(
    state: TState,
    message: string | ((state: TState) => string | undefined),
    options?: IToastOptions | ((state: TState) => IToastOptions),
) {
    const initial = useRef(state);
    const last = useRef(state);
    useEffect(() => {
        if (state === initial.current || state === last.current) return;
        last.current = state;
        const text =
            typeof message === "function"
                ? message(state)
                : state.ok
                  ? message
                  : undefined;
        if (!text) return;
        toast.success(
            text,
            typeof options === "function" ? options(state) : options,
        );
    }, [state, message, options]);
}

/**
 * Wrap an action so its success toast fires as soon as it resolves. Use this
 * when success unmounts the component that ran it (e.g. deleting a list row),
 * where an effect-based toast would never run.
 */
export function withSuccessToast<TState extends { ok?: boolean }, TPayload>(
    action: (state: TState, payload: TPayload) => Promise<TState>,
    message: string,
): (state: TState, payload: TPayload) => Promise<TState> {
    return async (state, payload) => {
        const result = await action(state, payload);
        if (result.ok) toast.success(message);
        return result;
    };
}
