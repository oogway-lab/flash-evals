import Link from "next/link";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import {
    countItemFilterMatchesAction,
    createSetupComparisonAction,
    proposeBenchmarkTaskMapAction,
} from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { ComparisonSetup } from "@/components/runs/comparison-setup";
import { buttonVariants } from "@/components/ui/button";
import { BifrostModelListNotice } from "@/components/runs/bifrost-model-list-notice";

export const dynamic = "force-dynamic";

/**
 * The four-step setup for "can a cheaper model, or a chain of smaller
 * prompts, do this job?": one button starts every setup.
 */
export default async function CompareRunPage() {
    const p = await requirePagePrincipal();
    const client = serverApiClient();
    const [setup, pipelines] = await Promise.all([
        client.getRunSetup(p.teamId, p.projectId),
        client.listSetupComparisonPipelines(p.teamId, p.projectId),
    ]);
    return (
        <Page>
            <PageHeader
                title="Compare setups"
                description="Can a cheaper model, or a chain of smaller prompts, do the job of the model you use today? Compare them task by task and see what each would cost."
                breadcrumbs={[
                    { label: "Runs", href: "/runs" },
                    { label: "Compare setups" },
                ]}
                action={
                    <Link
                        href="/runs/new"
                        className={buttonVariants({ variant: "secondary" })}
                    >
                        Full form
                    </Link>
                }
            />
            <BifrostModelListNotice error={setup.bifrostModelListError} />
            <ComparisonSetup
                datasets={setup.datasets}
                versionOptions={setup.versionOptions}
                availableModels={setup.availableModels}
                pipelines={pipelines}
                savedKeyProviders={setup.savedKeyProviders}
                createRunAction={createSetupComparisonAction}
                proposeTaskMapAction={proposeBenchmarkTaskMapAction}
                countItemFilterAction={countItemFilterMatchesAction}
            />
        </Page>
    );
}
