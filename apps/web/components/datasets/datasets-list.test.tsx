import {
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import type { IDatasetListRow } from "@mosaic/api-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
    archiveDatasetAction: vi.fn(),
    deleteDatasetAction: vi.fn(),
    duplicateDatasetAction: vi.fn(),
    restoreDatasetAction: vi.fn(),
}));

vi.mock("sonner", () => ({
    toast: { success: vi.fn(), error: vi.fn() },
}));

const router = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
    useRouter: () => router,
}));

import { DatasetsList } from "./datasets-list";

afterEach(cleanup);

function dataset(
    id: string,
    modality: IDatasetListRow["modality"],
    overrides: Partial<IDatasetListRow> = {},
): IDatasetListRow {
    return {
        id,
        name: `${modality} dataset`,
        purpose: "evaluation",
        modality,
        createdAt: "2026-07-21T00:00:00.000Z",
        itemCount: 1,
        labeledItemCount: 0,
        isRunnable: true,
        archived: false,
        ...overrides,
    };
}

describe("DatasetsList", () => {
    it("shows modality and type as plain text, not badges", () => {
        render(
            <DatasetsList
                datasets={[
                    dataset("audio", "audio"),
                    dataset("image", "image", { purpose: "golden" }),
                    dataset("text", "text"),
                ]}
                showArchived={false}
            />,
        );

        expect(screen.getAllByText("Audio · Evaluation")).toHaveLength(2);
        expect(screen.getAllByText("Images · Golden")).toHaveLength(2);
        expect(screen.getAllByText("Text · Evaluation")).toHaveLength(2);
        expect(
            document.querySelector('[data-slot="badge"]'),
        ).not.toBeInTheDocument();
    });

    it("links the name to the dataset and right-aligns numeric columns", () => {
        render(
            <DatasetsList
                datasets={[dataset("ds-1", "text", { itemCount: 12 })]}
                showArchived={false}
            />,
        );

        expect(
            screen.getByRole("link", { name: "text dataset" }),
        ).toHaveAttribute("href", "/datasets/ds-1");
        expect(screen.getByRole("columnheader", { name: "Items" })).toHaveClass(
            "text-right",
        );
        expect(screen.getByRole("cell", { name: "12" })).toHaveClass(
            "text-right",
        );
    });

    it("shows labeled coverage for golden sets and an explained dash otherwise", () => {
        render(
            <DatasetsList
                datasets={[
                    dataset("g", "text", {
                        name: "Golden set",
                        purpose: "golden",
                        itemCount: 10,
                        labeledItemCount: 4,
                    }),
                    dataset("e", "text", { name: "Eval set" }),
                ]}
                showArchived={false}
            />,
        );

        const golden = screen.getByRole("row", { name: /Golden set/ });
        expect(within(golden).getByText("4 of 10")).toBeInTheDocument();
        const evaluation = screen.getByRole("row", { name: /Eval set/ });
        expect(
            within(evaluation).getByText("not available"),
        ).toBeInTheDocument();
    });

    it("keeps row actions in an overflow menu", () => {
        render(
            <DatasetsList
                datasets={[dataset("text", "text")]}
                showArchived={false}
            />,
        );

        expect(
            screen.queryByRole("button", { name: "Duplicate" }),
        ).not.toBeInTheDocument();
        expect(
            screen.queryByRole("button", { name: "Archive" }),
        ).not.toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for text dataset",
            }),
        );
        expect(
            screen.getByRole("menuitem", { name: "Duplicate" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("menuitem", { name: "Archive" }),
        ).toBeInTheDocument();
        expect(
            screen.getByRole("menuitem", { name: "Delete" }),
        ).toBeInTheDocument();
    });

    it("confirms before archiving", () => {
        render(
            <DatasetsList
                datasets={[dataset("text", "text")]}
                showArchived={false}
            />,
        );
        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for text dataset",
            }),
        );
        fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
        expect(
            screen.getByRole("alertdialog", { name: "Archive dataset?" }),
        ).toBeInTheDocument();
    });

    it("offers restore instead of duplicate and archive for archived datasets", () => {
        render(
            <DatasetsList
                datasets={[dataset("old", "text", { archived: true })]}
                showArchived
            />,
        );
        expect(screen.getByText("Archived")).toBeInTheDocument();
        fireEvent.click(
            screen.getByRole("button", {
                name: "More actions for text dataset",
            }),
        );
        expect(
            screen.getByRole("menuitem", { name: "Restore" }),
        ).toBeInTheDocument();
        expect(
            screen.queryByRole("menuitem", { name: "Duplicate" }),
        ).not.toBeInTheDocument();
    });

    it("shows a search empty state that clears the search", () => {
        render(
            <DatasetsList
                datasets={[dataset("text", "text")]}
                showArchived={false}
            />,
        );
        fireEvent.change(screen.getByLabelText("Search datasets by name"), {
            target: { value: "zzz" },
        });
        expect(screen.getByText("No datasets match “zzz”")).toBeInTheDocument();
        fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
        expect(screen.getAllByText("Text · Evaluation")).toHaveLength(2);
    });

    it("toggles archived datasets with the shared Checkbox", () => {
        render(
            <DatasetsList
                datasets={[dataset("text", "text")]}
                showArchived={false}
            />,
        );
        const toggle = screen.getByRole("checkbox", {
            name: "Show archived only",
        });
        expect(toggle).toHaveClass("appearance-none");
        fireEvent.click(toggle);
        expect(router.push).toHaveBeenCalledWith("/datasets?archived=true");
    });
});
