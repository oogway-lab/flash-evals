import { cn } from "@/lib/cn";
import { fmtScore } from "@/lib/format";

export function ScorePill({
    score,
    label,
    className,
}: {
    score: number | null | undefined;
    label?: string;
    className?: string;
}) {
    const s = score ?? -1;
    const color =
        s < 0
            ? "bg-muted text-muted-foreground"
            : s >= 0.8
              ? "bg-eval-success-muted text-eval-success"
              : s >= 0.5
                ? "bg-eval-warning-muted text-eval-warning"
                : "bg-eval-danger-muted text-eval-danger";

    return (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-sm px-2 py-0.5 text-label-12 tabular-nums",
                color,
                className,
            )}
        >
            {label && <span className="text-muted-foreground">{label}</span>}
            {fmtScore(score)}
        </span>
    );
}
