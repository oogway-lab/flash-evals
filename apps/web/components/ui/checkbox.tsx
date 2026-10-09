import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

export function Checkbox({
    className,
    ...props
}: React.ComponentProps<"input">) {
    return (
        <span className="relative inline-flex size-4 shrink-0">
            <input
                type="checkbox"
                className={cn(
                    "peer size-4 appearance-none rounded-sm border border-border bg-background transition-colors",
                    "checked:border-primary checked:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    className,
                )}
                {...props}
            />
            <Check
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 hidden size-4 stroke-background p-0.5 peer-checked:block"
            />
        </span>
    );
}
