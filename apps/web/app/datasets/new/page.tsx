import { requirePagePrincipal } from "@/server/auth/session";
import { createDatasetAction } from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { DatasetCreateForm } from "@/components/datasets/dataset-create-form";

export const dynamic = "force-dynamic";

export default async function NewDatasetPage({
    searchParams,
}: {
    searchParams: Promise<{ modality?: string }>;
}) {
    await requirePagePrincipal();
    const { modality } = await searchParams;

    return (
        <Page>
            <PageHeader
                title="New dataset"
                description="Name your dataset, pick a purpose and modality, then create."
                breadcrumbs={[
                    { label: "Datasets", href: "/datasets" },
                    { label: "New dataset" },
                ]}
            />
            <DatasetCreateForm
                createDatasetAction={createDatasetAction}
                initialModality={modality}
            />
        </Page>
    );
}
