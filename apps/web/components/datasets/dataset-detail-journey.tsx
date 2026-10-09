import { Card } from "@/components/ui/card";
import { SectionTitle } from "@/components/layout/section-title";
import { type IJourneyStep } from "@/components/datasets/journey";
import { DatasetAddItemsSection } from "@/components/datasets/dataset-add-items-section";
import {
    GoldenAnswersImport,
    SttGoldenAnswersImport,
} from "@/components/datasets/golden-answers-import";
import type { IActionState } from "@/app/actions";
import type { IDatasetDetailResponse } from "@mosaic/api-contract";
import type {
    IAnswerImportPreview,
    IImportSummary,
} from "@mosaic/api-contract";

export function DatasetDetailJourney({
    detail,
    addItemAction,
    importTextItemsAction,
    importPairedItemsAction,
    importImagesAction,
    importAudioAction,
    importImageAnswersAction,
    importGoldenAnswersAction,
    previewGoldenAnswersAction,
    commitGoldenAnswersAction,
}: {
    detail: IDatasetDetailResponse;
    addItemAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importTextItemsAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importPairedItemsAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importImagesAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importAudioAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importImageAnswersAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    importGoldenAnswersAction: (
        prevState: IActionState,
        formData: FormData,
    ) => Promise<IActionState>;
    previewGoldenAnswersAction: (
        formData: FormData,
    ) => Promise<
        | { ok: true; preview: IAnswerImportPreview }
        | { ok: false; error: string }
    >;
    commitGoldenAnswersAction: (
        formData: FormData,
    ) => Promise<
        { ok: true; result: IImportSummary } | { ok: false; error: string }
    >;
}) {
    const isGolden = detail.labelMode !== "evaluation";
    const itemsLabel =
        detail.dataset.modality === "text"
            ? "text items"
            : detail.dataset.modality === "audio"
              ? "audio files"
              : "images";
    const exampleLabel =
        detail.dataset.modality === "text"
            ? "text examples"
            : detail.dataset.modality === "audio"
              ? "audio examples"
              : "image examples";
    const { itemCount, labeledItemCount } = detail;

    const steps: IJourneyStep[] = [
        {
            title: isGolden
                ? "Choose how to add examples"
                : `Add ${itemsLabel}`,
            description: isGolden
                ? `Add ${exampleLabel} in bulk, or create one complete example with its expected answer.`
                : `Upload the ${itemsLabel} to evaluate.`,
            status: itemCount > 0 ? "done" : "active",
            children: (
                <DatasetAddItemsSection
                    detail={detail}
                    addItemAction={addItemAction}
                    importTextItemsAction={importTextItemsAction}
                    importPairedItemsAction={importPairedItemsAction}
                    importImagesAction={importImagesAction}
                    importAudioAction={importAudioAction}
                    importImageAnswersAction={importImageAnswersAction}
                />
            ),
        },
    ];

    if (detail.labelMode === "independent") {
        steps.push({
            title: "Upload golden answers",
            description:
                "Pair items with expected outputs from JSON, JSONL, or one JSON file per audio item.",
            status:
                itemCount === 0
                    ? "todo"
                    : labeledItemCount > 0
                      ? "done"
                      : "active",
            children:
                itemCount > 0 ? (
                    detail.dataset.modality === "audio" ? (
                        <SttGoldenAnswersImport
                            datasetId={detail.dataset.id}
                            previewAction={previewGoldenAnswersAction}
                            commitAction={commitGoldenAnswersAction}
                        />
                    ) : (
                        <GoldenAnswersImport
                            datasetId={detail.dataset.id}
                            action={importGoldenAnswersAction}
                        />
                    )
                ) : (
                    <p className="text-copy-14 text-muted-foreground">
                        Add items first, then import golden answers keyed by
                        item id, input text, or filename.
                    </p>
                ),
        });
    }

    return (
        <div className="flex flex-col gap-6">
            {steps.map((step) => (
                <Card
                    key={step.title}
                    variant="inset"
                    className="flex flex-col gap-4 p-6"
                >
                    <SectionTitle as="h2" description={step.description}>
                        {step.title}
                    </SectionTitle>
                    {step.children}
                </Card>
            ))}
        </div>
    );
}
