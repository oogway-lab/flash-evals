import type { IDatasetListRow } from "@mosaic/api-contract";

export const MODALITY_LABELS: Record<IDatasetListRow["modality"], string> = {
    audio: "Audio",
    image: "Images",
    text: "Text",
};

export const PURPOSE_LABELS: Record<IDatasetListRow["purpose"], string> = {
    evaluation: "Evaluation",
    golden: "Golden",
};

/** "Images · Evaluation": modality and purpose as plain text. */
export function datasetTypeLabel(dataset: {
    modality: IDatasetListRow["modality"];
    purpose: IDatasetListRow["purpose"];
}) {
    return `${MODALITY_LABELS[dataset.modality]} · ${PURPOSE_LABELS[dataset.purpose]}`;
}
