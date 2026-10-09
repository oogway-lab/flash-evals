import { beforeEach, describe, expect, it, vi } from "vitest";

const dbMock = vi.hoisted(() => ({
    selectResults: [] as unknown[][],
    select: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
    db: {
        select: dbMock.select,
    },
}));

function setupDbMock() {
    dbMock.select.mockImplementation(() => {
        const result = Promise.resolve(dbMock.selectResults.shift() ?? []);
        const builder = {
            from: vi.fn(() => builder),
            where: vi.fn(() => builder),
            groupBy: vi.fn(() => builder),
            then: result.then.bind(result),
            catch: result.catch.bind(result),
            finally: result.finally.bind(result),
        };
        return builder;
    });
}

import { enrichRunRows } from "./listReads";

describe("enrichRunRows N+1 guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.selectResults = [];
        setupDbMock();
    });

    it("issues exactly three batched queries for a single run row", async () => {
        dbMock.selectResults = [
            [{ id: "dataset-1", name: "Dataset One" }],
            [{ runId: "run-1", modelId: "gpt-4o" }],
            [{ runId: "run-1", status: "succeeded", count: 3 }],
        ];

        const rows = [{ id: "run-1", datasetId: "dataset-1" }];
        const enriched = await enrichRunRows(rows);

        expect(dbMock.select).toHaveBeenCalledTimes(3);
        expect(enriched).toEqual([
            {
                id: "run-1",
                datasetId: "dataset-1",
                datasetName: "Dataset One",
                models: ["gpt-4o"],
                progress: { total: 3, done: 3, failed: 0, pending: 0 },
            },
        ]);
    });

    it("still issues exactly three batched queries for fifty run rows (no per-row N+1 fan-out)", async () => {
        const rowCount = 50;
        const rows = Array.from({ length: rowCount }, (_, i) => ({
            id: `run-${i}`,
            datasetId: "dataset-1",
        }));
        const modelRows = rows.map((r) => ({ runId: r.id, modelId: "gpt-4o" }));
        const progressRows = rows.map((r) => ({
            runId: r.id,
            status: "succeeded",
            count: 2,
        }));

        dbMock.selectResults = [
            [{ id: "dataset-1", name: "Dataset One" }],
            modelRows,
            progressRows,
        ];

        const enriched = await enrichRunRows(rows);

        // The query count must stay constant (batched via inArray) regardless of
        // how many rows are enriched. A regression that fetches per-row would
        // make this scale with rowCount instead of staying at 3.
        expect(dbMock.select).toHaveBeenCalledTimes(3);
        expect(enriched).toHaveLength(rowCount);
        expect(enriched.every((r) => r.datasetName === "Dataset One")).toBe(
            true,
        );
        expect(enriched.every((r) => r.progress.total === 2)).toBe(true);
    });

    it("skips all database queries for an empty row set", async () => {
        const enriched = await enrichRunRows([]);

        expect(dbMock.select).not.toHaveBeenCalled();
        expect(enriched).toEqual([]);
    });
});
