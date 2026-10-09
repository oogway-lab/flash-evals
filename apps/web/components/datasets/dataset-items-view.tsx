"use client";

import { ItemCard } from "@/components/datasets/item-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IActionState } from "@/app/actions";
import type { IDatasetDetailResponse } from "@mosaic/api-contract";
import { goldCoverage } from "./gold-coverage";
import { SectionTitle } from "@/components/layout/section-title";
import { EmptyState } from "@/components/layout/empty-state";

export function DatasetItemsView({
    detail,
    isGolden,
    readOnly,
    editAction,
    deleteAction,
}: {
    detail: IDatasetDetailResponse;
    isGolden: boolean;
    readOnly: boolean;
    editAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    deleteAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
}) {
    const showGoldCoverage = isGolden && detail.dataset.modality === "audio";
    const coverage = detail.labels.map(goldCoverage);
    const transcriptCoverage = coverage.filter(
        (item) => item.transcript,
    ).length;

    if (detail.itemCount === 0) {
        return (
            <section className="flex flex-col gap-4">
                <SectionTitle>Items</SectionTitle>
                <EmptyState
                    title="No items yet"
                    description="Add items to this dataset to start evaluating models against it."
                />
            </section>
        );
    }

    return (
        <section>
            <Tabs defaultValue="grid">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <SectionTitle
                        description={
                            <>
                                Review examples as visual cards or switch to a
                                compact list for larger datasets.
                                {showGoldCoverage &&
                                    ` ${transcriptCoverage} of ${detail.itemCount} items have a gold transcript.`}
                            </>
                        }
                    >
                        Items
                    </SectionTitle>
                    <TabsList className="h-8 w-full shrink-0 p-0.5 sm:w-auto">
                        <TabsTrigger
                            value="grid"
                            className="h-7 px-2.5 py-0 text-label-12"
                        >
                            Grid
                        </TabsTrigger>
                        <TabsTrigger
                            value="list"
                            className="h-7 px-2.5 py-0 text-label-12"
                        >
                            List
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="grid">
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                        {detail.items.map((item, i) => (
                            <ItemCard
                                key={item.id}
                                id={item.id}
                                datasetId={detail.dataset.id}
                                type={item.type}
                                storageKey={item.storageKey}
                                mimeType={item.mimeType}
                                inputText={item.inputText}
                                label={detail.labels[i]}
                                goldCoverage={
                                    showGoldCoverage ? coverage[i] : undefined
                                }
                                schema={detail.answerSchema}
                                freeformLabel={detail.freeformLabel}
                                isGolden={isGolden}
                                readOnly={readOnly}
                                editAction={editAction}
                                deleteAction={deleteAction}
                            />
                        ))}
                    </div>
                </TabsContent>

                <TabsContent value="list">
                    <div className="flex flex-col gap-2">
                        {detail.items.map((item, i) => (
                            <ItemCard
                                key={item.id}
                                id={item.id}
                                datasetId={detail.dataset.id}
                                type={item.type}
                                storageKey={item.storageKey}
                                mimeType={item.mimeType}
                                inputText={item.inputText}
                                label={detail.labels[i]}
                                goldCoverage={
                                    showGoldCoverage ? coverage[i] : undefined
                                }
                                schema={detail.answerSchema}
                                freeformLabel={detail.freeformLabel}
                                isGolden={isGolden}
                                readOnly={readOnly}
                                variant="list"
                                editAction={editAction}
                                deleteAction={deleteAction}
                            />
                        ))}
                    </div>
                </TabsContent>
            </Tabs>
        </section>
    );
}
