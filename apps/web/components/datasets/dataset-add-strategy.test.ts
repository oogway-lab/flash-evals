import { describe, expect, it } from "vitest";
import type { IDatasetDetailResponse } from "@mosaic/api-contract";
import { resolveDatasetAddStrategy } from "./dataset-add-strategy";

function detail(opts: {
    modality: "audio" | "text" | "image";
    labelMode: IDatasetDetailResponse["labelMode"];
    freeformLabel: boolean;
}): IDatasetDetailResponse {
    return {
        dataset: { modality: opts.modality },
        labelMode: opts.labelMode,
        freeformLabel: opts.freeformLabel,
    } as unknown as IDatasetDetailResponse;
}

describe("resolveDatasetAddStrategy", () => {
    it("routes evaluation text datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "text",
                    labelMode: "evaluation",
                    freeformLabel: false,
                }),
            ),
        ).toEqual({ kind: "evaluation-text" });
    });

    it("routes evaluation image datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "image",
                    labelMode: "evaluation",
                    freeformLabel: false,
                }),
            ),
        ).toEqual({ kind: "evaluation-images" });
    });

    it("routes evaluation audio datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "audio",
                    labelMode: "evaluation",
                    freeformLabel: false,
                }),
            ),
        ).toEqual({ kind: "evaluation-audio" });
    });

    it("routes structured golden text datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "text",
                    labelMode: "pipeline",
                    freeformLabel: false,
                }),
            ),
        ).toEqual({ kind: "golden-text-structured" });
    });

    it("routes freeform golden text datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "text",
                    labelMode: "independent",
                    freeformLabel: true,
                }),
            ),
        ).toEqual({ kind: "golden-text-freeform" });
    });

    it("routes structured golden image datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "image",
                    labelMode: "legacySchema",
                    freeformLabel: false,
                }),
            ),
        ).toEqual({ kind: "golden-images-structured" });
    });

    it("routes structured golden audio datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "audio",
                    labelMode: "legacySchema",
                    freeformLabel: false,
                }),
            ),
        ).toEqual({ kind: "golden-audio-structured" });
    });

    it("routes freeform golden image datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "image",
                    labelMode: "independent",
                    freeformLabel: true,
                }),
            ),
        ).toEqual({ kind: "golden-images-freeform" });
    });

    it("routes freeform golden audio datasets", () => {
        expect(
            resolveDatasetAddStrategy(
                detail({
                    modality: "audio",
                    labelMode: "independent",
                    freeformLabel: true,
                }),
            ),
        ).toEqual({ kind: "golden-audio-freeform" });
    });
});
