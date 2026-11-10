import type { Route } from "next";
import { notFound } from "next/navigation";
import { FlashEvalsApiError } from "@flash-evals/api-contract";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SttRunResults } from "@/components/stt-evals/stt-run-results";
import { PipelineComparison } from "@/components/stt-evals/pipeline-comparison";
import { WorkflowRunSettings } from "@/components/stt-evals/run-settings";
import { RetryFailedCellsForm } from "@/components/runs/retry-failed-cells-form";
import { RunHeaderActions } from "@/components/runs/run-header-actions";
import { RunProgressCard } from "@/components/runs/run-progress-card";
import { serverApiClient } from "@/server/api/client";
import { modelInfoFor } from "@/server/runs/modelInfo";
import { requireActiveProject } from "@/server/projects/activeProject";

export const dynamic = "force-dynamic";

export default async function SttEvalRunPage({
    params,
}: {
    params: Promise<{ id: string; runId: string }>;
}) {
    const { id, runId } = await params;
    const principal = await requireActiveProject();
    const detail = await serverApiClient()
        .getWorkflowRunDetail(principal.teamId, principal.projectId, id, runId)
        .catch((err: unknown) => {
            if (err instanceof FlashEvalsApiError && err.status === 404)
                notFound();
            throw err;
        });
    const run = detail.workflowRun;
    const comparison = detail.comparison;
    const referenceModelId = comparison?.referenceModelId;
    const referenceInfo = referenceModelId
        ? (await modelInfoFor([referenceModelId]))[referenceModelId]
        : undefined;
    return (
        <Page>
            <PageHeader
                title="Pipeline run"
                description="Compare branch metrics, artifacts, cost, and failures."
                breadcrumbs={[
                    { label: "Pipelines", href: "/multiworkflow" },
                    { label: "Canvas", href: `/multiworkflow/${id}` as Route },
                    { label: "Run" },
                ]}
                action={
                    <RunHeaderActions
                        runId={runId}
                        workflowId={id}
                        status={run.status}
                        stopReason={run.stopReason}
                        answersToRejudge={detail.answersToRejudge}
                    />
                }
            />
            <RunProgressCard
                progressUrl={`/api/workflows/${id}/runs/${runId}/progress`}
                initial={{
                    ...detail.progress,
                    status: run.status,
                    ...(run.stopReason ? { stopReason: run.stopReason } : {}),
                    ...(run.error ? { error: run.error } : {}),
                }}
                maxCostUsd={run.configSnapshot?.maxCostUsd}
                retryAction={
                    <RetryFailedCellsForm
                        runId={runId}
                        workflowId={id}
                        variant="stuck"
                    />
                }
            />
            <WorkflowRunSettings config={run.configSnapshot} />
            {comparison ? (
                <PipelineComparison
                    comparison={comparison}
                    pipelineName={run.workflowSnapshot.name}
                    {...(referenceInfo
                        ? {
                              referenceName: referenceInfo.label,
                              referenceInfo,
                          }
                        : {})}
                    runStatus={run.status}
                />
            ) : null}
            <SttRunResults detail={detail} />
        </Page>
    );
}
