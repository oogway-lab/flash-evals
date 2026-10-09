import { describe, expect, it, vi } from "vitest";
import { dashboardPayload } from "./dashboard.js";
import type { IDb } from "../db.js";
import { RUN_NOTE_TITLE_SQL } from "./runNoteTitle.js";

function dbWithRows(rows: unknown[][]): IDb {
    return {
        query: vi.fn(async () => ({ rows: rows.shift() ?? [] }) as never),
    };
}

describe("dashboardPayload", () => {
    it("combines dashboard stats and recent runs from team-scoped queries", async () => {
        const db = dbWithRows([
            [{ count: 2 }],
            [{ count: 3 }],
            [{ total: 5, active: 1 }],
            [{ count: 1 }],
            [{ count: 2 }],
            [
                {
                    id: "run-1",
                    status: "running",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Food",
                    models: ["gpt-4o"],
                    total: 4,
                    done: 2,
                    failed: 1,
                    pending: 2,
                    note_title: "Baseline before prompt change",
                },
            ],
        ]);

        await expect(
            dashboardPayload(db, "team-1", "project-1", 3),
        ).resolves.toEqual({
            stats: {
                datasetCount: 2,
                promptCount: 3,
                runCount: 5,
                runningCount: 1,
                hasDatasetWithSchema: true,
                hasDatasetWithItems: true,
                hasPrompt: true,
            },
            recentRuns: [
                {
                    id: "run-1",
                    status: "running",
                    createdAt: "2026-07-06T08:00:00.000Z",
                    datasetId: "dataset-1",
                    datasetName: "Food",
                    models: ["gpt-4o"],
                    progress: {
                        total: 4,
                        done: 2,
                        failed: 1,
                        pending: 2,
                    },
                    noteTitle: "Baseline before prompt change",
                },
            ],
        });
        expect(db.query).toHaveBeenCalledTimes(6);
        expect(vi.mocked(db.query).mock.calls[0]?.[1]).toEqual([
            "team-1",
            "project-1",
        ]);
    });

    it("counts each run cell once even though run_models is joined too", async () => {
        const db = dbWithRows([
            [{ count: 0 }],
            [{ count: 0 }],
            [{ total: 0, active: 0 }],
            [],
            [],
            [],
        ]);

        await dashboardPayload(db, "team-1", "project-1", 3);

        const recentRunsSql = String(vi.mocked(db.query).mock.calls[5]?.[0]);
        expect(recentRunsSql).toContain("left join run_models");
        expect(recentRunsSql).not.toMatch(/count\(rc\.id\)/);
        expect(recentRunsSql.match(/count\(distinct rc\.id\)/g)).toHaveLength(
            4,
        );
    });

    it("omits noteTitle for runs without a note and derives it like the runs list", async () => {
        const db = dbWithRows([
            [{ count: 0 }],
            [{ count: 0 }],
            [{ total: 1, active: 0 }],
            [],
            [],
            [
                {
                    id: "run-2",
                    status: "completed",
                    created_at: new Date("2026-07-06T08:00:00.000Z"),
                    dataset_id: "dataset-1",
                    dataset_name: "Food",
                    models: [],
                    total: 1,
                    done: 1,
                    failed: 0,
                    pending: 0,
                    note_title: null,
                },
            ],
        ]);

        const { recentRuns } = await dashboardPayload(db, "t", "p");

        expect(recentRuns[0]).not.toHaveProperty("noteTitle");
        const sql = String(vi.mocked(db.query).mock.calls[5]?.[0]);
        expect(sql).toContain(RUN_NOTE_TITLE_SQL);
        expect(sql).toContain("as note_title");
    });
});
