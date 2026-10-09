import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDashboardStats, getRecentRuns } from "./reads";

const dbMock = vi.hoisted(() => ({
    selectResults: [] as Array<unknown[] | Promise<unknown[]>>,
    select: vi.fn(),
}));

const runsMock = vi.hoisted(() => ({
    getRunCounts: vi.fn(),
    listRecentRuns: vi.fn(),
}));

const listReadsMock = vi.hoisted(() => ({
    enrichRunRows: vi.fn(),
}));

vi.mock("@/server/db/client", () => ({
    db: {
        select: dbMock.select,
    },
}));

vi.mock("@/server/runs/service", () => ({
    getRunCounts: runsMock.getRunCounts,
    listRecentRuns: runsMock.listRecentRuns,
}));

vi.mock("@/server/runs/listReads", () => ({
    enrichRunRows: listReadsMock.enrichRunRows,
}));

function setupDbMock() {
    dbMock.select.mockImplementation(() => {
        const result = Promise.resolve(dbMock.selectResults.shift() ?? []);
        const builder = {
            from: vi.fn(() => builder),
            innerJoin: vi.fn(() => builder),
            where: vi.fn(() => builder),
            groupBy: vi.fn(() => builder),
            then: result.then.bind(result),
            catch: result.catch.bind(result),
            finally: result.finally.bind(result),
        };
        return builder;
    });
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}

describe("dashboard reads", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dbMock.selectResults = [];
        runsMock.getRunCounts.mockResolvedValue({ total: 0, active: 0 });
        runsMock.listRecentRuns.mockResolvedValue([]);
        listReadsMock.enrichRunRows.mockResolvedValue([]);
        setupDbMock();
    });

    it("returns empty dashboard stats when the team has no data", async () => {
        dbMock.selectResults = [
            [{ count: 0 }],
            [{ count: 0 }],
            [],
            [],
        ];

        await expect(getDashboardStats("team-1")).resolves.toEqual({
            datasetCount: 0,
            promptCount: 0,
            runCount: 0,
            runningCount: 0,
            hasDatasetWithSchema: false,
            hasDatasetWithItems: false,
            hasPrompt: false,
        });
    });

    it("combines independent dashboard counts and readiness flags", async () => {
        dbMock.selectResults = [
            [{ count: 2 }],
            [{ count: 3 }],
            [{ datasetId: "dataset-1" }],
            [
                { datasetId: "dataset-1", count: 4 },
                { datasetId: "dataset-2", count: 0 },
            ],
        ];
        runsMock.getRunCounts.mockResolvedValue({ total: 5, active: 1 });

        await expect(getDashboardStats("team-1")).resolves.toEqual({
            datasetCount: 2,
            promptCount: 3,
            runCount: 5,
            runningCount: 1,
            hasDatasetWithSchema: true,
            hasDatasetWithItems: true,
            hasPrompt: true,
        });
        expect(runsMock.getRunCounts).toHaveBeenCalledWith("team-1");
    });

    it("schedules independent dashboard reads before waiting on results", async () => {
        const datasetCount = deferred<Array<{ count: number }>>();
        const promptCount = deferred<Array<{ count: number }>>();
        const schemaRows = deferred<Array<{ datasetId: string }>>();
        const itemRows = deferred<Array<{ datasetId: string; count: number }>>();
        const runCounts = deferred<{ total: number; active: number }>();

        dbMock.selectResults = [
            datasetCount.promise,
            promptCount.promise,
            schemaRows.promise,
            itemRows.promise,
        ];
        runsMock.getRunCounts.mockReturnValue(runCounts.promise);

        const statsPromise = getDashboardStats("team-1");
        await Promise.resolve();

        expect(dbMock.select).toHaveBeenCalledTimes(4);
        expect(runsMock.getRunCounts).toHaveBeenCalledWith("team-1");

        datasetCount.resolve([{ count: 2 }]);
        promptCount.resolve([{ count: 3 }]);
        runCounts.resolve({ total: 5, active: 1 });
        schemaRows.resolve([{ datasetId: "dataset-1" }]);
        itemRows.resolve([{ datasetId: "dataset-1", count: 4 }]);

        await expect(statsPromise).resolves.toEqual({
            datasetCount: 2,
            promptCount: 3,
            runCount: 5,
            runningCount: 1,
            hasDatasetWithSchema: true,
            hasDatasetWithItems: true,
            hasPrompt: true,
        });
    });

    it("enriches recent runs after reading team-scoped rows", async () => {
        const runRows = [{ id: "run-1", datasetId: "dataset-1" }];
        const enrichedRows = [{ id: "run-1", datasetName: "Dataset" }];
        runsMock.listRecentRuns.mockResolvedValue(runRows);
        listReadsMock.enrichRunRows.mockResolvedValue(enrichedRows);

        await expect(getRecentRuns("team-1", 3)).resolves.toBe(enrichedRows);
        expect(runsMock.listRecentRuns).toHaveBeenCalledWith("team-1", 3);
        expect(listReadsMock.enrichRunRows).toHaveBeenCalledWith(runRows);
    });
});
