"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";
import { cn } from "@/lib/cn";

/**
 * Wrap a form's fields so every control inside is disabled while the form is
 * submitting, preventing edits that the in-flight submission won't include.
 * Renders an unstyled `<fieldset>`; pass the form's layout classes to it.
 */
export function PendingFieldset({
    className,
    disabled,
    ...props
}: React.FieldsetHTMLAttributes<HTMLFieldSetElement>) {
    const { pending } = useFormStatus();
    return (
        <fieldset
            data-slot="pending-fieldset"
            disabled={disabled || pending}
            className={cn("m-0 min-w-0 border-0 p-0", className)}
            {...props}
        />
    );
}
