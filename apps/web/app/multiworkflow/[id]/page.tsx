import { notFound } from "next/navigation";
import { MosaicApiError } from "@mosaic/api-contract";
import {
    createSttEvalRunAction,
    createWorkflowLlmRouteForNode,
    loadWorkflowLlmModelsForNode,
    saveSttEvalAction,
} from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { SttWorkflowEditor } from "@/components/stt-evals/stt-workflow-editor";
import { WorkflowRunHistory } from "@/components/stt-evals/workflow-run-history";
import { serverApiClient } from "@/server/api/client";
import { requireActiveProject } from "@/server/projects/activeProject";

export const dynamic = "force-dynamic";

export default async function SttEvalCanvasPage({
    params,
    searchParams,
}: {
    params: Promise<{ id: string }>;
    searchParams: Promise<{ datasetId?: string }>;
}) {
    const { id } = await params;
    const { datasetId } = await searchParams;
    const principal = await requireActiveProject();
    const [workflow, setup, runs] = await Promise.all([
        serverApiClient().getWorkflow(
            principal.teamId,
            principal.projectId,
            id,
        ),
        serverApiClient().getRunSetup(principal.teamId, principal.projectId),
        serverApiClient().listWorkflowRuns(
            principal.teamId,
            principal.projectId,
            id,
        ),
    ]).catch((err: unknown) => {
        if (err instanceof MosaicApiError && err.status === 404) notFound();
        throw err;
    });
    if (workflow.kind !== "stt" && workflow.kind !== "multi") notFound();
    const routing = await loadLlmRouting(principal.teamId, principal.projectId);
    return (
        <Page>
            <PageHeader
                title={workflow.name}
                description="Connect one independent downstream branch to each input block."
                breadcrumbs={[
                    { label: "Pipelines", href: "/multiworkflow" },
                    { label: workflow.name },
                ]}
            />
            {routing.notice ? (
                <Alert>
                    <AlertTitle>Routing status</AlertTitle>
                    <AlertDescription>{routing.notice}</AlertDescription>
                </Alert>
            ) : null}
            <SttWorkflowEditor
                launch={{
                    workflow,
                    datasets: setup.datasets,
                    initialDatasetId: datasetId,
                    action: createSttEvalRunAction,
                }}
                canvas={{
                    workflow,
                    setup,
                    saveAction: saveSttEvalAction,
                    llmRoutes: routing.routes,
                    projectDefault: routing.projectDefault,
                    onCreateLlmRoute: createWorkflowLlmRouteForNode,
                    onLoadLlmModels: loadWorkflowLlmModelsForNode,
                }}
            />
            <WorkflowRunHistory
                workflowId={id}
                runs={runs}
                basePath="/multiworkflow"
            />
        </Page>
    );
}

async function loadLlmRouting(teamId: string, projectId: string) {
    try {
        const [routes, projectDefault] = await Promise.all([
            serverApiClient().listWorkflowLlmRoutes(teamId, projectId),
            serverApiClient().getWorkflowLlmProjectDefault(teamId, projectId),
        ]);
        return {
            routes,
            projectDefault: projectDefault.default,
            notice: undefined,
        };
    } catch {
        return {
            routes: [],
            projectDefault: undefined,
            notice: "LLM routing is temporarily unavailable. The canvas can still be edited, but model routes can't be listed right now.",
        };
    }
}
