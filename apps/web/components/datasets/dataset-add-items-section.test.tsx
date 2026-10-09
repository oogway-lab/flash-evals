import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { IDatasetDetailResponse } from "@mosaic/api-contract";
import { DatasetAddItemsSection } from "./dataset-add-items-section";

afterEach(cleanup);

const noopAction = vi.fn(async () => ({ ok: true }));

function audioDetail(input: {
    labelMode: IDatasetDetailResponse["labelMode"];
    freeformLabel: boolean;
}): IDatasetDetailResponse {
    return {
        dataset: {
            id: "dataset-1",
            name: "Audio dataset",
            purpose: "golden",
            modality: "audio",
            createdAt: new Date().toISOString(),
            archivedAt: null,
            description: null,
        },
        labelMode: input.labelMode,
        freeformLabel: input.freeformLabel,
        answerSchema: undefined,
        itemCount: 0,
        labeledItemCount: 0,
        items: [],
    } as unknown as IDatasetDetailResponse;
}

function renderSection(detail: IDatasetDetailResponse) {
    return render(
        <DatasetAddItemsSection
            detail={detail}
            addItemAction={noopAction}
            importTextItemsAction={noopAction}
            importPairedItemsAction={noopAction}
            importImagesAction={noopAction}
            importAudioAction={noopAction}
            importImageAnswersAction={noopAction}
        />,
    );
}

describe("DatasetAddItemsSection audio imports", () => {
    it("uses the upload-first flow before mapped answers for freeform audio", () => {
        renderSection(
            audioDetail({ labelMode: "independent", freeformLabel: true }),
        );

        expect(screen.getByText("Upload audio files")).toBeTruthy();
        expect(
            screen.getByText(/map and preview STT reference answers/),
        ).toBeTruthy();
        expect(screen.getByRole("button", { name: "Add audio" })).toBeTruthy();
    });

    it("keeps structured golden audio on the upload-first flow", () => {
        renderSection(
            audioDetail({ labelMode: "legacySchema", freeformLabel: false }),
        );

        expect(screen.getByText("Upload audio files")).toBeTruthy();
        expect(
            screen.queryByText("Answers keyed by audio filename"),
        ).toBeNull();
        expect(screen.getByRole("button", { name: "Add audio" })).toBeTruthy();
    });
});
