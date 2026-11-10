import Link from "next/link";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { RunsList } from "@/components/runs/runs-list";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function RunsPage() {
    const p = await requirePagePrincipal();
    const runs = await serverApiClient().listRuns(p.teamId, p.projectId);

    return (
        <Page>
            <PageHeader
                title="Runs"
                description="Evaluation runs across datasets and model candidates."
                action={
                    <div className="flex flex-col items-stretch gap-2 sm:flex-row">
                        <Link href="/runs/compare" className={buttonVariants()}>
                            Compare setups
                        </Link>
                        <Link
                            href="/runs/new"
                            className={buttonVariants({ variant: "secondary" })}
                        >
                            New run
                        </Link>
                    </div>
                }
            />

            {runs.length === 0 ? (
                <EmptyState
                    title="No runs yet"
                    description="Use New run to launch an evaluation and compare models on your dataset."
                />
            ) : (
                <RunsList runs={runs} />
            )}
        </Page>
    );
}
