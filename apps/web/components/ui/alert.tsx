import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

const alertVariants = cva(
    "relative w-full rounded-sm border px-3 py-2 text-copy-14 [&>svg]:absolute [&>svg]:left-3 [&>svg]:top-2.5 [&>svg]:size-4 [&>svg~*]:pl-8",
    {
        variants: {
            variant: {
                default:
                    "border-border bg-surface text-on-surface [&>svg]:text-muted-foreground",
                destructive:
                    "border-error/30 bg-eval-danger-muted text-error [&>svg]:text-error [&_[data-slot=alert-description]]:text-inherit [&_[data-slot=alert-title]]:text-inherit",
            },
        },
        defaultVariants: {
            variant: "default",
        },
    },
);

export interface AlertProps
    extends
        React.HTMLAttributes<HTMLDivElement>,
        VariantProps<typeof alertVariants> {}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
    function Alert({ className, variant, role = "alert", ...props }, ref) {
        return (
            <div
                ref={ref}
                role={role}
                className={cn(alertVariants({ variant, className }))}
                {...props}
            />
        );
    },
);

export const AlertTitle = React.forwardRef<
    HTMLHeadingElement,
    React.HTMLAttributes<HTMLHeadingElement>
>(function AlertTitle({ className, ...props }, ref) {
    return (
        <h5
            ref={ref}
            data-slot="alert-title"
            className={cn("pb-1 text-label-14 text-on-surface", className)}
            {...props}
        />
    );
});

export const AlertDescription = React.forwardRef<
    HTMLDivElement,
    React.HTMLAttributes<HTMLDivElement>
>(function AlertDescription({ className, ...props }, ref) {
    return (
        <div
            ref={ref}
            data-slot="alert-description"
            className={cn(
                "text-copy-14 text-muted-foreground [&_a]:underline [&_a]:underline-offset-4 [&_a]:hover:text-on-surface [&_code]:font-mono [&_code]:text-on-surface",
                className,
            )}
            {...props}
        />
    );
});
