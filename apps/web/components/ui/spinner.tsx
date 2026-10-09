import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

export const spinnerVariants = cva("shrink-0 animate-spin", {
    variants: {
        size: {
            sm: "size-3.5",
            default: "size-4",
        },
    },
    defaultVariants: {
        size: "default",
    },
});

export interface ISpinnerProps
    extends
        Omit<React.SVGProps<SVGSVGElement>, "ref">,
        VariantProps<typeof spinnerVariants> {
    /**
     * Accessible label. When omitted the spinner is decorative (`aria-hidden`)
     * and the surrounding control should announce the busy state itself.
     */
    label?: string;
}

export function Spinner({ className, size, label, ...props }: ISpinnerProps) {
    return (
        <Loader2
            data-slot="spinner"
            role={label ? "status" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
            className={cn(spinnerVariants({ size }), className)}
            {...props}
        />
    );
}
