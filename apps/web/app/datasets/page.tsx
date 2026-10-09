import Link from "next/link";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/layout/empty-state";
import { DatasetsList } from "@/components/datasets/datasets-list";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function DatasetsPage({
    searchParams,
}: {
    searchParams: Promise<{ archived?: string }>;
}) {
    const { archived } = await searchParams;
    const showArchived = archived === "true";
    const p = await requirePagePrincipal();
    const datasets = await serverApiClient().listDatasets(
        p.teamId,
        p.projectId,
        {
            archivedOnly: showArchived,
        },
    );

    return (
        <Page>
            <PageHeader
                title="Datasets"
                description="Golden sets (items + answers) and evaluation sets (items only). Prompt bundles are chosen at run time."
                action={
                    <Link href="/datasets/new" className={buttonVariants()}>
                        New dataset
                    </Link>
                }
            />

            {datasets.length === 0 && showArchived ? (
                // The archive toggle lives in DatasetsList, which isn't rendered
                // here, so offer the way back to the active view directly.
                <EmptyState
                    variant="filter-empty"
                    title="No archived datasets"
                    description="Archived datasets appear here. Switch back to see your active datasets."
                    actionLabel="Show active datasets"
                    actionHref="/datasets"
                />
            ) : datasets.length === 0 ? (
                <EmptyState
                    title="No datasets yet"
                    description="Use New dataset to create a golden or evaluation dataset, add items, and pair golden answers when needed."
                />
            ) : (
                <DatasetsList datasets={datasets} showArchived={showArchived} />
            )}
        </Page>
    );
}
