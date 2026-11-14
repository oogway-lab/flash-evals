import type { Route } from "next";
import Link from "next/link";
import {
    pipelineSetupLabel,
    type ISetupComparisonMember,
} from "@flash-evals/api-contract";
import { RunStatusBadge } from "@/components/ui/status-badge";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";

/** A member run's own page: a pipeline run's under its pipeline. */
export function runPageHref(runId: string, workflowId?: string): Route {
    return (
        workflowId
            ? `/multiworkflow/${workflowId}/runs/${runId}`
            : `/runs/${runId}`
    ) as Route;
}

export function memberHref(member: ISetupComparisonMember): Route {
    return runPageHref(
        member.runId,
        member.kind === "pipeline" ? member.workflowId : undefined,
    );
}

export function memberLabel(
    member: ISetupComparisonMember,
    modelName: (modelId: string) => string = (id) => id,
): string {
    return member.kind === "pipeline"
        ? pipelineSetupLabel(
              member.name,
              (member.stepModels ?? []).map(modelName),
          )
        : "Eval run: the reference and the single models";
}

/**
 * What a member is doing when its status alone doesn't say: waiting for
 * the eval run before scoring, not picked up by a worker, or failed to
 * start.
 */
export function memberNote(member: ISetupComparisonMember): string | undefined {
    if (member.waitingForEvalRun)
        return "Steps done. Its answers are scored once the eval run finishes.";
    if (member.waitingForWorker)
        return member.enqueueStatus === "queued"
            ? "No worker has picked this run up. Is the worker running? Open the run to retry."
            : "This run is still being queued. Open the run to retry.";
    if (member.status === "failed" && member.error)
        return `Failed to start: ${member.error}`;
    return undefined;
}

/** Every run in the comparison, with its status and a link to its page. */
export function ComparisonMembers({
    members,
    modelName,
}: {
    members: ISetupComparisonMember[];
    modelName?: (modelId: string) => string;
}) {
    return (
        <Table>
            <TableHeader>
                <TableRow className="bg-muted hover:bg-muted">
                    <TableHead>Run</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Note</TableHead>
                </TableRow>
            </TableHeader>
            <TableBody>
                {members.map((member) => {
                    const note = memberNote(member);
                    return (
                        <TableRow key={member.runId}>
                            <TableCell className="min-w-48">
                                <Link
                                    href={memberHref(member)}
                                    className="text-label-14 text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                                >
                                    {memberLabel(member, modelName)}
                                </Link>
                            </TableCell>
                            <TableCell>
                                <RunStatusBadge
                                    status={member.status}
                                    stopReason={member.stopReason}
                                />
                            </TableCell>
                            <TableCell className="min-w-48 text-copy-14 text-muted-foreground">
                                {note ?? ""}
                            </TableCell>
                        </TableRow>
                    );
                })}
            </TableBody>
        </Table>
    );
}
