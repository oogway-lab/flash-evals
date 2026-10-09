import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Plain `<label>`, as in shadcn's Base UI style. Base UI's own label is
 * `<Field.Label>`, which needs a `Field.Root`; Flash Evals's server-action forms
 * pair labels and controls with `htmlFor`/`id` instead.
 */
export function Label({ className, ...props }: React.ComponentProps<"label">) {
    return (
        <label
            data-slot="label"
            className={cn(
                "text-label-14 text-on-surface peer-disabled:cursor-not-allowed peer-disabled:opacity-70",
                className,
            )}
            {...props}
        />
    );
}
