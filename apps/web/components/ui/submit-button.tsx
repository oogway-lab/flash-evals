"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { Button, type ButtonProps } from "@/components/ui/button";

type ISubmitButtonBaseProps = Omit<ButtonProps, "type">;

/**
 * `intent` scopes the pending state to this button when a form has several
 * submit buttons: the button submits `intent=<value>` and only shows loading
 * while the in-flight submission carries the same intent.
 *
 * `intent` cannot be combined with a function `formAction`: React reserves
 * `name` on such buttons to encode the action, so the intent would be lost.
 */
export type ISubmitButtonProps =
    | (Omit<ISubmitButtonBaseProps, "formAction"> & {
          intent: string;
          formAction?: string;
      })
    | (ISubmitButtonBaseProps & { intent?: undefined });

/**
 * Submit button for a `<form action={…}>`. Reads `useFormStatus()`: shows the
 * Button loading state while the parent form is submitting (this button's
 * intent, if it has one), and is disabled during any submission of the form.
 */
export const SubmitButton = React.forwardRef<
    HTMLButtonElement,
    ISubmitButtonProps
>(function SubmitButton(
    { intent, loading, disabled, name, value, ...props },
    ref,
) {
    const { pending, data } = useFormStatus();
    const isPending =
        pending && (intent === undefined || data?.get("intent") === intent);
    return (
        <Button
            ref={ref}
            type="submit"
            name={intent === undefined ? name : "intent"}
            value={intent === undefined ? value : intent}
            loading={loading || isPending}
            // Any in-flight submission of the form blocks a second one.
            disabled={disabled || pending}
            {...props}
        />
    );
});
