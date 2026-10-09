import { cn } from "@/lib/cn";
import { shortId } from "@/lib/format";
import { CopyButton } from "@/components/ui/copy-button";
import { Hint } from "@/components/ui/hint";

/**
 * A short ID in mono. Hovering shows the full ID; the copy button copies it
 * and names it in its tooltip for keyboard users.
 */
export function IdLabel({
    id,
    noun = "ID",
    className,
}: {
    id: string;
    /** What the ID identifies, for the copy button's label: "run ID". */
    noun?: string;
    className?: string;
}) {
    return (
        <span
            data-slot="id-label"
            className={cn(
                "inline-flex items-center gap-1 text-mono-13 text-muted-foreground",
                className,
            )}
        >
            <Hint content={id}>
                <span>{shortId(id)}</span>
            </Hint>
            <CopyButton
                value={id}
                what={noun}
                hint={
                    <>
                        Copy <span className="text-mono-13">{id}</span>
                    </>
                }
            />
        </span>
    );
}
