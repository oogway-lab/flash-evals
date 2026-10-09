import type { Route } from "next";
import { notFound } from "next/navigation";
import { MosaicApiError } from "@mosaic/api-contract";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { SttRunResults } from "@/components/stt-evals/stt-run-results";
import { RunProgressCard } from "@/components/runs/run-progress-card";
import { serverApiClient } from "@/server/api/client";
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
            if (err instanceof MosaicApiError && err.status === 404) notFound();
            throw err;
        });
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
            />
            <RunProgressCard
                progressUrl={`/api/workflows/${id}/runs/${runId}/progress`}
                initial={{
                    status: detail.workflowRun.status,
                    ...detail.progress,
                }}
            />
            <SttRunResults detail={detail} />
        </Page>
    );
}
