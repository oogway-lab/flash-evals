import Link from "next/link";
import {
    LoadingRegion,
    SectionHeadingSkeleton,
    TableSkeleton,
} from "@/components/layout/skeletons";
import { SectionTitle } from "@/components/layout/section-title";
import { RelativeTime } from "@/components/ui/relative-time";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { serverApiClient } from "@/server/api/client";
import { Hint } from "@/components/ui/hint";

export function RecentRunsSkeleton() {
    return (
        <LoadingRegion label="recent runs" className="gap-4">
            <SectionHeadingSkeleton />
            <TableSkeleton columns={4} rows={3} card={false} />
        </LoadingRegion>
    );
}

// One listWorkflowRuns call per workflow, so this streams in after the
// workflow list instead of holding up the whole page.
export async function RecentRuns({
    teamId,
    projectId,
    workflowIds,
}: {
    teamId: string;
    projectId: string;
    workflowIds: string[];
}) {
    const runResults = await Promise.allSettled(
        workflowIds.map((workflowId) =>
            serverApiClient().listWorkflowRuns(teamId, projectId, workflowId),
        ),
    );
    const runsFailed = runResults.some(
        (result) => result.status === "rejected",
    );
    const recentRuns = runResults
        .flatMap((result) =>
            result.status === "fulfilled" ? result.value : [],
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, 8);
    return (
        <>
            {runsFailed ? (
                <Alert>
                    <AlertTitle>Recent runs unavailable</AlertTitle>
                    <AlertDescription>
                        Some recent runs could not be loaded. Refresh the page
                        to try again.
                    </AlertDescription>
                </Alert>
            ) : null}
            {recentRuns.length ? (
                <section className="flex flex-col gap-4">
                    <SectionTitle>Recent runs</SectionTitle>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Run</TableHead>
                                <TableHead>Dataset</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead>Created</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {recentRuns.map((run) => (
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
                                                className="text-mono-13 hover:underline"
                                                href={`/multiworkflow/${run.workflowId}/runs/${run.id}`}
                                            >
                                                {shortId(run.id)}
                                            </Link>
                                        </Hint>
                                    </TableCell>
                                    <TableCell>{run.datasetName}</TableCell>
                                    <TableCell>
                                        <RunStatusBadge status={run.status} />
                                    </TableCell>
                                    <TableCell>
                                        <RelativeTime value={run.createdAt} />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </section>
            ) : null}
        </>
    );
}
