import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { cn } from "@/lib/cn";

export interface IProgressProps extends Omit<
    ProgressPrimitive.Root.Props,
    "value" | "max" | "children"
> {
    value?: number;
    max?: number;
    /** Show an unknown amount of progress, e.g. a pending run or `total=0`. */
    indeterminate?: boolean;
}

export function Progress({
    className,
    value,
    max = 100,
    indeterminate = false,
    ...props
}: IProgressProps) {
    const safeMax = max > 0 ? max : 100;
    const clamped =
        indeterminate || value === undefined || !Number.isFinite(value)
            ? undefined
            : Math.min(Math.max(value, 0), safeMax);

    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            value={indeterminate ? null : (clamped ?? 0)}
            min={0}
            max={safeMax}
            {...props}
        >
            <ProgressPrimitive.Track
                data-slot="progress-track"
                className={cn(
                    "relative h-2 w-full overflow-hidden rounded-full bg-muted",
                    className,
                )}
            >
                <ProgressPrimitive.Indicator
                    data-slot="progress-indicator"
                    className={
                        indeterminate
                            ? "h-full w-1/3 rounded-full bg-primary motion-safe:animate-progress-indeterminate"
                            : "h-full bg-primary transition-[width] duration-300"
                    }
                />
            </ProgressPrimitive.Track>
        </ProgressPrimitive.Root>
    );
}
