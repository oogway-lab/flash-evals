import {
    act,
    cleanup,
    fireEvent,
    render,
    screen,
    within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { MatrixView } from "./matrix-view";
import type { CellData } from "./types";

afterEach(cleanup);

const models = [{ id: "rm-1", modelId: "gpt-5", isReference: false }];
const items = [
    {
        id: "item-1",
        type: "text",
        inputText: "one",
        storageKey: null,
        mimeType: null,
    },
    {
        id: "item-2",
        type: "text",
        inputText: "two",
        storageKey: null,
        mimeType: null,
    },
    {
        id: "item-3",
        type: "text",
        inputText: "three",
        storageKey: null,
        mimeType: null,
    },
];

function cell(itemId: string, status: CellData["status"]): CellData {
    const done = status === "succeeded";
    return {
        id: `cell-${itemId}`,
        datasetItemId: itemId,
        runModelId: "rm-1",
        status,
        outputJson: null,
        latencyMs: done ? 1200 : null,
        costUsd: done ? 0.001 : null,
        promptTokens: done ? 100 : null,
        completionTokens: done ? 20 : null,
        error: null,
    };
}

describe("MatrixView live cell states", () => {
    it("shows skeleton metrics for in-flight cells and a pulsing running badge", () => {
        render(
            <MatrixView
                models={models}
                items={items}
                cells={[
                    cell("item-1", "succeeded"),
                    cell("item-2", "running"),
                    cell("item-3", "pending"),
                ]}
                scoresByCell={{}}
                saveCellAnnotationAction={vi.fn()}
            />,
        );

        const rows = screen.getAllByRole("row").slice(1);
        const skeletons = (row: HTMLElement) =>
            row.querySelectorAll('[data-slot="skeleton"]').length;

        // Finished cell: real metrics, no skeleton.
        expect(skeletons(rows[0])).toBe(0);
        expect(within(rows[0]).getByText(/tok/)).toBeInTheDocument();

        // In-flight cells: metrics line and score pill are skeletons.
        expect(skeletons(rows[1])).toBe(2);
        expect(skeletons(rows[2])).toBe(2);
        expect(within(rows[1]).queryByText(/tok/)).not.toBeInTheDocument();

        const running = within(rows[1]).getByLabelText("Cell status: Running");
        expect(
            running.querySelector('[data-slot="status-running-dot"]'),
        ).toBeInTheDocument();
        const pending = within(rows[2]).getByLabelText("Cell status: Pending");
        expect(
            pending.querySelector('[data-slot="status-running-dot"]'),
        ).not.toBeInTheDocument();
    });

    it("shows a quick-review verdict at once and reverts it with a toast if the save fails", async () => {
        let finish!: (value: { formError: string }) => void;
        const save = vi.fn(
            () =>
                new Promise<{ formError: string }>(
                    (resolve) => (finish = resolve),
                ),
        );
        render(
            <MatrixView
                models={models}
                items={[items[0]]}
                cells={[cell("item-1", "succeeded")]}
                scoresByCell={{}}
                saveCellAnnotationAction={save}
            />,
        );
        const approve = screen.getByRole("button", { name: "Mark approve" });
        expect(approve).toHaveAttribute("aria-pressed", "false");

        await act(async () => {
            fireEvent.click(approve);
        });
        expect(approve).toHaveAttribute("aria-pressed", "true");

        await act(async () => finish({ formError: "Cell not found" }));
        expect(approve).toHaveAttribute("aria-pressed", "false");
        expect(toastError).toHaveBeenCalledWith("Cell not found");
    });
});

describe("MatrixView layout", () => {
    function renderMatrix(
        overrides: Partial<React.ComponentProps<typeof MatrixView>> = {},
    ) {
        return render(
            <MatrixView
                models={models}
                items={items}
                cells={items.map((i) => cell(i.id, "succeeded"))}
                scoresByCell={{}}
                saveCellAnnotationAction={vi.fn()}
                {...overrides}
            />,
        );
    }

    it("builds on the Table primitives with a sticky, opaque header", () => {
        const { container } = renderMatrix();
        const thead = container.querySelector("thead")!;
        expect(thead).toHaveClass("sticky", "top-0");
        const corner = screen.getByRole("columnheader", { name: "Item" });
        expect(corner).toHaveClass("sticky", "left-0", "bg-muted");
        expect(corner.className).not.toMatch(/bg-muted\//);
        expect(
            container.querySelector('[data-slot="table-container"]'),
        ).toHaveClass("max-h-[75dvh]");
    });

    it("marks the reference model with a badge instead of “(ref)”", () => {
        renderMatrix({
            models: [{ id: "rm-1", modelId: "gpt-5", isReference: true }],
        });
        const header = screen.getAllByRole("columnheader")[1];
        expect(within(header).getByText("Reference")).toBeInTheDocument();
        expect(header.textContent).not.toContain("(ref)");
    });

    it("filters with tabs and offers to clear an empty filter", () => {
        renderMatrix();
        const failed = screen.getByRole("tab", { name: "Failed" });
        fireEvent.click(failed);
        expect(failed).toHaveAttribute("aria-selected", "true");
        expect(
            screen.getByText("No items match this filter"),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByRole("button", { name: "Clear filter" }));
        expect(screen.getByRole("tab", { name: "All" })).toHaveAttribute(
            "aria-selected",
            "true",
        );
        expect(screen.getAllByRole("row")).toHaveLength(items.length + 1);
    });

    it("says the run has no items instead of blaming the filter", () => {
        renderMatrix({ items: [], cells: [] });
        expect(screen.getByText("No items in this run")).toBeInTheDocument();
        expect(
            screen.queryByText("No items match this filter"),
        ).not.toBeInTheDocument();
    });

    it("uses tooltips, not native title attributes", () => {
        const { container } = renderMatrix();
        expect(container.querySelectorAll("[title]")).toHaveLength(0);
    });

    it("uses an icon rather than a text arrow on View details", () => {
        renderMatrix();
        const [details] = screen.getAllByRole("button", {
            name: "View details",
        });
        expect(details.textContent).not.toContain("→");
        expect(details.querySelector("svg")).toBeInTheDocument();
    });

    it("clamps a cell error behind Show more", () => {
        renderMatrix({
            cells: [
                { ...cell("item-1", "failed"), error: "Provider timed out" },
            ],
            items: [items[0]],
        });
        expect(screen.getByText("Provider timed out")).toHaveClass(
            "line-clamp-3",
        );
    });
});
