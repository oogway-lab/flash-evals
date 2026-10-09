import type { IPromptListRow } from "@mosaic/api-contract";

export function filterPrompts(
    rows: IPromptListRow[],
    query: string,
): IPromptListRow[] {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return rows;
    return rows.filter((row) =>
        row.name.toLowerCase().includes(normalizedQuery),
    );
}
