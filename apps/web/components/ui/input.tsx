import * as React from "react";
import { cn } from "@/lib/cn";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
    function Input(
        { className, type, invalid, "aria-invalid": ariaInvalidProp, ...props },
        ref,
    ) {
        const ariaInvalid = invalid ?? ariaInvalidProp;

        return (
            <input
                ref={ref}
                type={type}
                aria-invalid={ariaInvalid || undefined}
                className={cn(
                    "flex h-10 w-full rounded-sm border border-input bg-neutral px-3 text-copy-14 transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
                    ariaInvalid &&
                        "border-error text-error focus-visible:border-error",
                    className,
                )}
                {...props}
            />
        );
    },
);
