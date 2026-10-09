import Link from "next/link";
import type { IWorkflowRunSummary } from "@mosaic/api-contract";
import { EmptyState } from "@/components/layout/empty-state";
import { SectionTitle } from "@/components/layout/section-title";
import { RelativeTime } from "@/components/ui/relative-time";
import { RunStatusBadge } from "@/components/ui/status-badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { shortId } from "@/lib/format";
import { Hint } from "@/components/ui/hint";

export function WorkflowRunHistory({
    workflowId,
    runs,
    basePath = "/multiworkflow",
}: {
    workflowId: string;
    runs: IWorkflowRunSummary[];
    basePath?: "/multiworkflow" | "/stt-evals" | "/workflows";
}) {
    return (
        <section className="flex flex-col gap-4">
            <SectionTitle>Run history</SectionTitle>
            {runs.length === 0 ? (
                <EmptyState
                    variant="plain"
                    title="No workflow runs yet"
                    description="Launch this workflow to see its progress and completed results here."
                />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Run</TableHead>
                            <TableHead>Dataset</TableHead>
                            <TableHead>Target</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead align="numeric">Progress</TableHead>
                            <TableHead>Created</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {runs.map((run) => (
                            <TableRow key={run.id}>
                                <TableCell>
                                    <Hint
                                        content={
                                            <span className="text-mono-13">
                                                {run.id}
                                            </span>
                                        }
                                    >
                                        <Link
                                            href={`${basePath}/${workflowId}/runs/${run.id}`}
                                            className="text-mono-13 hover:underline"
                                        >
                                            {shortId(run.id)}
                                        </Link>
                                    </Hint>
                                </TableCell>
                                <TableCell>{run.datasetName}</TableCell>
                                <TableCell>
                                    {run.runTarget === "single_item"
                                        ? "Single item"
                                        : "Whole dataset"}
                                </TableCell>
                                <TableCell>
                                    <RunStatusBadge status={run.status} />
                                </TableCell>
                                <TableCell align="numeric">
                                    {run.done}/{run.total}
                                    {run.failed
                                        ? ` · ${run.failed} failed`
                                        : ""}
                                </TableCell>
                                <TableCell>
                                    <RelativeTime value={run.createdAt} />
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            )}
        </section>
    );
}
