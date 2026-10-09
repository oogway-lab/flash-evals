import { describe, expect, it } from "vitest";
import type { IDatasetListRow } from "@mosaic/api-contract";
import { filterDatasets } from "./datasets-list-filter";

function row(
    overrides: Partial<IDatasetListRow> & Pick<IDatasetListRow, "name">,
): IDatasetListRow {
    return {
        id: "id-1",
        purpose: "golden",
        modality: "image",
        createdAt: "2026-07-06T08:00:00.000Z",
        itemCount: 0,
        labeledItemCount: 0,
        isRunnable: false,
        archived: false,
        ...overrides,
    };
}

describe("filterDatasets", () => {
    const rows = [
        row({ id: "1", name: "Food plates v1" }),
        row({ id: "2", name: "bg-17742" }),
        row({ id: "3", name: "Archived set", archived: true }),
    ];

    it("filters rows by name case-insensitively", () => {
        expect(filterDatasets(rows, "food", false)).toEqual([rows[0]]);
        expect(filterDatasets(rows, "FOOD", false)).toEqual([rows[0]]);
    });

    it("returns all non-archived rows when the query is empty", () => {
        expect(filterDatasets(rows, "", false)).toEqual([rows[0], rows[1]]);
    });

    it("excludes archived rows unless showArchived is true", () => {
        expect(filterDatasets(rows, "", false)).not.toContainEqual(rows[2]);
        expect(filterDatasets(rows, "", true)).toEqual(rows);
    });

    it("does not surface an archived row that only matches by name", () => {
        expect(filterDatasets(rows, "archived", false)).toEqual([]);
        expect(filterDatasets(rows, "archived", true)).toEqual([rows[2]]);
    });
});
