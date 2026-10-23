import Link from "next/link";
import type { Route } from "next";
import type { IDashboardRun, IRunProgress } from "@flash-evals/api-contract";
import { shortId } from "@/lib/format";
import { runNoteTitle } from "@/components/runs/run-title";

/**
 * The run's name as a link with its short ID under it; just the mono ID when
 * the run has no note. Shared by the runs list and the dashboard's recent runs.
 */
export function RunLinkCell({
    id,
    noteTitle,
    workflow,
}: {
    id: string;
    noteTitle?: string;
    workflow?: IDashboardRun["workflow"];
}) {
    const title = runNoteTitle(noteTitle);
    const bases = {
        multi: "/multiworkflow",
        stt: "/stt-evals",
        prompt: "/workflows",
    } as const;
    const href = workflow
        ? (`${bases[workflow.kind]}/${workflow.id}/runs/${id}` as Route)
        : (`/runs/${id}` as Route);
    return (
        <div className="flex min-w-0 max-w-44 flex-col gap-1 sm:max-w-96">
            <Link
                href={href}
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
