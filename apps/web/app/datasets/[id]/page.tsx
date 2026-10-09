import { notFound } from "next/navigation";
import { MosaicApiError } from "@mosaic/api-contract";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import {
    addItemAction,
    editItemAction,
    deleteItemAction,
    importAudioAction,
    importPairedItemsAction,
    importImagesAction,
    importImageAnswersAction,
    importTextItemsAction,
    importGoldenAnswersAction,
    previewGoldenAnswersAction,
    commitGoldenAnswersAction,
} from "@/app/actions";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { DatasetActionsMenu } from "@/components/datasets/dataset-actions-menu";
import { DatasetDescription } from "@/components/datasets/dataset-description";
import { DatasetDetailJourney } from "@/components/datasets/dataset-detail-journey";
import { DatasetItemsView } from "@/components/datasets/dataset-items-view";
import { datasetTypeLabel } from "@/components/datasets/dataset-labels";
import { DatasetName } from "@/components/datasets/dataset-name";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Num } from "@/components/ui/num";
import { IdLabel } from "@/components/ui/id-label";

export const dynamic = "force-dynamic";

export default async function DatasetPage({
    params,
}: {
    params: Promise<{ id: string }>;
}) {
    const { id } = await params;
    const p = await requirePagePrincipal();
    const detail = await serverApiClient()
        .getDatasetDetail(p.teamId, p.projectId, id)
        .catch((err: unknown) => {
            if (err instanceof MosaicApiError && err.status === 404) notFound();
            throw err;
        });

    const isGolden = detail.labelMode !== "evaluation";
    const isArchived = detail.dataset.archivedAt != null;

    return (
        <Page>
            <PageHeader
                title={detail.dataset.name}
                titleContent={
                    <DatasetName
                        datasetId={detail.dataset.id}
                        name={detail.dataset.name}
                        editable={!isArchived}
                    />
                }
                meta={
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-copy-14 text-muted-foreground">
                        <span>{datasetTypeLabel(detail.dataset)}</span>
                        <span>
                            <Num>{detail.itemCount}</Num>{" "}
                            {detail.itemCount === 1 ? "item" : "items"}
                            {isGolden && (
                                <>
                                    {", "}
                                    <Num>{detail.labeledItemCount}</Num> labeled
                                </>
                            )}
                        </span>
                        <IdLabel id={detail.dataset.id} noun="dataset ID" />
                    </div>
                }
                breadcrumbs={[
                    { label: "Datasets", href: "/datasets" },
                    { label: detail.dataset.name },
                ]}
                action={
                    <DatasetActionsMenu
                        datasetId={detail.dataset.id}
                        datasetName={detail.dataset.name}
                        archived={isArchived}
                    />
                }
            />

            <div className="flex flex-col gap-4">
                {isArchived && (
                    <Alert role="status">
                        <AlertDescription>
                            This dataset is archived. It is hidden from the list
                            and run setup, but its items and run history are
                            preserved.
                        </AlertDescription>
                    </Alert>
                )}

                <DatasetDescription
                    datasetId={detail.dataset.id}
                    description={detail.dataset.description}
                    editable={!isArchived}
                />

                <p className="text-copy-14 text-muted-foreground">
                    {isGolden
                        ? `Golden ${detail.dataset.modality} dataset. Each example can include the expected answer used for scoring. Prompts are selected when you start a run.`
                        : `Evaluation ${detail.dataset.modality} dataset. Add inputs now; model outputs are generated when you start a run. You can also add an expected output to any item.`}
                </p>
            </div>

            {!isArchived && (
                <div className="max-w-2xl">
                    <DatasetDetailJourney
                        detail={detail}
                        addItemAction={addItemAction}
                        importTextItemsAction={importTextItemsAction}
                        importPairedItemsAction={importPairedItemsAction}
                        importImagesAction={importImagesAction}
                        importAudioAction={importAudioAction}
                        importImageAnswersAction={importImageAnswersAction}
                        importGoldenAnswersAction={importGoldenAnswersAction}
                        previewGoldenAnswersAction={previewGoldenAnswersAction}
                        commitGoldenAnswersAction={commitGoldenAnswersAction}
                    />
                </div>
            )}

            {(isArchived || detail.itemCount > 0) && (
                <DatasetItemsView
                    detail={detail}
                    isGolden={isGolden}
                    readOnly={isArchived}
                    editAction={editItemAction}
                    deleteAction={deleteItemAction}
                />
            )}
        </Page>
    );
}
