import { createSttEvalAction } from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { NewEvalForm } from "@/components/stt-evals/new-eval-form";
import { serverApiClient } from "@/server/api/client";
import { requireActiveProject } from "@/server/projects/activeProject";

export const dynamic = "force-dynamic";

export const metadata = { title: "New pipeline" };

export default async function NewMultiworkflowPage() {
    const principal = await requireActiveProject();
    const setup = await serverApiClient().getRunSetup(
        principal.teamId,
        principal.projectId,
    );
    return (
        <Page>
            <PageHeader
                title="New pipeline"
                description="Pick the input modality and dataset the canvas starts from."
                breadcrumbs={[
                    { label: "Pipelines", href: "/multiworkflow" },
                    { label: "New" },
                ]}
            />
            <div className="max-w-2xl">
                <NewEvalForm
                    datasets={setup.datasets}
                    sttModels={setup.sttModels.filter(
                        (model) => model.available,
                    )}
                    action={createSttEvalAction}
                />
            </div>
        </Page>
    );
}
