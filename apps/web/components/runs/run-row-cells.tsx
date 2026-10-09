import Link from "next/link";
import type { IRunProgress } from "@mosaic/api-contract";
import { shortId } from "@/lib/format";
import { runNoteTitle } from "@/components/runs/run-title";

/**
 * The run's name as a link with its short ID under it; just the mono ID when
 * the run has no note. Shared by the runs list and the dashboard's recent runs.
 */
export function RunLinkCell({
    id,
    noteTitle,
}: {
    id: string;
    noteTitle?: string;
}) {
    const title = runNoteTitle(noteTitle);
    return (
        <div className="flex min-w-0 max-w-44 flex-col gap-1 sm:max-w-96">
            <Link
                href={`/runs/${id}`}
                className={
                    title
                        ? "truncate rounded-sm text-label-14 text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        : "w-fit rounded-sm text-mono-13 text-on-surface hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                }
            >
                {title ?? shortId(id)}
            </Link>
            {title && (
                <span className="text-mono-13 text-muted-foreground">
                    {shortId(id)}
                </span>
            )}
        </div>
    );
}

/** "done / total", with failed cells called out: `38 / 40 · 2 failed`. */
export function RunCellsProgress({ progress }: { progress: IRunProgress }) {
    return (
        <>
            {progress.done} / {progress.total}
            {progress.failed > 0 && (
                <span className="text-error">
                    {` · ${progress.failed} failed`}
                </span>
            )}
        </>
    );
}
