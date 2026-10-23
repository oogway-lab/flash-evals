import type { IDatasetListRow } from "@flash-evals/api-contract";

export function filterDatasets(
    rows: IDatasetListRow[],
    query: string,
    showArchived: boolean,
): IDatasetListRow[] {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((row) => {
        if (!showArchived && row.archived) return false;
        if (!normalizedQuery) return true;
        return row.name.toLowerCase().includes(normalizedQuery);
    });
}
