import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const badgeVariants = cva(
    "inline-flex items-center rounded-sm border px-2 py-0.5 text-label-12 transition-colors",
    {
        variants: {
            variant: {
                default: "border-transparent bg-muted text-on-surface",
                success:
                    "border-transparent bg-eval-success-muted text-eval-success",
                warning:
                    "border-transparent bg-eval-warning-muted text-eval-warning",
                danger: "border-transparent bg-eval-danger-muted text-eval-danger",
                outline: "border-border text-on-surface",
                ref: "border-transparent bg-eval-ref-muted text-eval-ref",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

export interface BadgeProps
    extends
        React.HTMLAttributes<HTMLSpanElement>,
        VariantProps<typeof badgeVariants> {}

// A <span>, not a <div>: badges sit inline, often inside <p> or <button>.
export function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <span
            data-slot="badge"
            className={cn(badgeVariants({ variant }), className)}
            {...props}
        />
    );
}
