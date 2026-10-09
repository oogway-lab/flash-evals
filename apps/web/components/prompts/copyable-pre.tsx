import { cn } from "@/lib/cn";
import { CopyButton } from "@/components/ui/copy-button";

export function CopyablePre({
    text,
    label = "Copy text",
    className,
}: {
    text: string;
    label?: string;
    className?: string;
}) {
    return (
        <div className={cn("relative rounded-sm bg-surface", className)}>
            <CopyButton
                value={text}
                label={label}
                className="absolute right-2 top-2"
            />
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap p-3 pr-12 text-mono-13 text-on-surface">
                {text}
            </pre>
        </div>
    );
}
