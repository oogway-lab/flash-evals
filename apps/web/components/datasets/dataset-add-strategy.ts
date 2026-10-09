import type { IDatasetDetailResponse } from "@mosaic/api-contract";

export type DatasetAddStrategy =
    | { kind: "evaluation-audio" }
    | { kind: "evaluation-text" }
    | { kind: "evaluation-images" }
    | { kind: "golden-audio-structured" }
    | { kind: "golden-audio-freeform" }
    | { kind: "golden-text-structured" }
    | { kind: "golden-text-freeform" }
    | { kind: "golden-images-structured" }
    | { kind: "golden-images-freeform" };

export function resolveDatasetAddStrategy(
    detail: IDatasetDetailResponse,
): DatasetAddStrategy {
    const isText = detail.dataset.modality === "text";
    const isAudio = detail.dataset.modality === "audio";
    if (detail.labelMode === "evaluation") {
        if (isText) return { kind: "evaluation-text" };
        if (isAudio) return { kind: "evaluation-audio" };
        return { kind: "evaluation-images" };
    }
    if (isText) {
        return detail.freeformLabel
            ? { kind: "golden-text-freeform" }
            : { kind: "golden-text-structured" };
    }
    if (isAudio) {
        return detail.freeformLabel
            ? { kind: "golden-audio-freeform" }
            : { kind: "golden-audio-structured" };
    }
    return detail.freeformLabel
        ? { kind: "golden-images-freeform" }
        : { kind: "golden-images-structured" };
}
