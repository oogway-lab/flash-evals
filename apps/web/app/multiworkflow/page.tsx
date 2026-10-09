import { Suspense } from "react";
import Link from "next/link";
import { deleteWorkflowAction } from "@/app/actions";
import { EmptyState } from "@/components/layout/empty-state";
import { WorkflowRowActions } from "@/components/stt-evals/workflow-row-actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Num } from "@/components/ui/num";
import { RelativeTime } from "@/components/ui/relative-time";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { MISSING_VALUE } from "@/lib/format";
import { serverApiClient } from "@/server/api/client";
import { requireActiveProject } from "@/server/projects/activeProject";
import { RecentRuns, RecentRunsSkeleton } from "./recent-runs";

export const dynamic = "force-dynamic";

// User-facing name is "Pipelines". The route (`/multiworkflow`) and code
// identifiers keep the old name; renaming the URL is a separate change.
export const metadata = { title: "Pipelines" };

export default async function MultiworkflowPage() {
    const principal = await requireActiveProject();
    const workflows = await serverApiClient().listWorkflows(
        principal.teamId,
        principal.projectId,
    );
    return (
        <Page>
            <PageHeader
                title="Pipelines"
                description="Build multi-modal evaluation graphs from reusable input, prompt, model, and scoring blocks."
                action={
                    <Link
                        href="/multiworkflow/new"
                        className={buttonVariants()}
                    >
                        New pipeline
                    </Link>
                }
            />
            {workflows.length ? (
                <>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Description</TableHead>
                                <TableHead align="numeric">Nodes</TableHead>
                                <TableHead>Created</TableHead>
                                <TableHead className="w-12">
                                    <span className="sr-only">Actions</span>
                                </TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {workflows.map((workflow) => (
                                <TableRow key={workflow.id}>
                                    <TableCell>
                                        <Link
                                            href={`/multiworkflow/${workflow.id}`}
                                            className="rounded-sm text-label-14 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                        >
                                            {workflow.name}
                                        </Link>
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        {workflow.description || (
                                            <Num>{MISSING_VALUE}</Num>
                                        )}
                                    </TableCell>
                                    <TableCell
                                        align="numeric"
                                        className="text-muted-foreground"
                                    >
                                        {workflow.nodeCount}
                                    </TableCell>
                                    <TableCell className="text-muted-foreground">
                                        <RelativeTime
                                            value={workflow.createdAt}
                                        />
                                    </TableCell>
                                    <TableCell className="py-1 text-right align-middle">
                                        <WorkflowRowActions
                                            workflowId={workflow.id}
                                            workflowName={workflow.name}
                                            deleteAction={deleteWorkflowAction}
                                        />
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                    <Suspense fallback={<RecentRunsSkeleton />}>
                        <RecentRuns
                            teamId={principal.teamId}
                            projectId={principal.projectId}
                            workflowIds={workflows.map(
                                (workflow) => workflow.id,
                            )}
                        />
                    </Suspense>
                </>
            ) : (
                // The header's "New pipeline" is the one primary action.
                <EmptyState
                    title="No pipelines yet"
                    description="Create a pipeline to connect dataset inputs with model and evaluation blocks."
                />
            )}
        </Page>
    );
}
