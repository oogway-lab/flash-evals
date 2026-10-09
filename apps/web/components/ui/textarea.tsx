import * as React from "react";
import { cn } from "@/lib/cn";

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    invalid?: boolean;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
    function Textarea(
        { className, invalid, "aria-invalid": ariaInvalidProp, ...props },
        ref,
    ) {
        const ariaInvalid = invalid ?? ariaInvalidProp;

        return (
            <textarea
                ref={ref}
                aria-invalid={ariaInvalid || undefined}
                className={cn(
                    "flex min-h-[96px] w-full rounded-sm border border-input bg-neutral px-3 py-2 text-copy-14 transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
                    ariaInvalid &&
                        "border-error text-error focus-visible:border-error",
                    className,
                )}
                {...props}
            />
        );
    },
);
