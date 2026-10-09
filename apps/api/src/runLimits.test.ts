import { describe, expect, it, vi } from "vitest";
import type { IDb } from "./db.js";
import { ApiBadRequestError, ApiConflictError } from "./errors.js";
import { assertRunCellLimit, assertTeamSpendUnderCap } from "./runLimits.js";

describe("assertRunCellLimit", () => {
    it("allows runs at the limit", () => {
        expect(() =>
            assertRunCellLimit({
                itemCount: 100,
                perItemCount: 100,
                perItemLabel: "models",
                maxRunCells: 10_000,
            }),
        ).not.toThrow();
    });

    it("rejects runs over the limit with the cell math", () => {
        expect(() =>
            assertRunCellLimit({
                itemCount: 5001,
                perItemCount: 2,
                perItemLabel: "models",
                maxRunCells: 10_000,
            }),
        ).toThrowError(
            new ApiBadRequestError(
                "This run would create 10,002 cells (5,001 items x 2 models); the limit is 10,000. Use a smaller dataset or fewer models.",
            ),
        );
    });

    it("defaults to 10,000 cells when no limit is configured", () => {
        expect(() =>
            assertRunCellLimit({
                itemCount: 10_001,
                perItemCount: 1,
                perItemLabel: "workflow nodes",
            }),
        ).toThrow(
            "the limit is 10,000. Use a smaller dataset or fewer workflow nodes.",
        );
    });
});

describe("assertTeamSpendUnderCap", () => {
    it("skips the query when no cap is configured", async () => {
        const db = { query: vi.fn() } as unknown as IDb;

        await assertTeamSpendUnderCap(db, "team-1", undefined);

        expect(db.query).not.toHaveBeenCalled();
    });

    it("allows runs while spend is under the cap", async () => {
        const db = dbWithSpend(9.99);

        await expect(
            assertTeamSpendUnderCap(db, "team-1", 10),
        ).resolves.toBeUndefined();
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("interval '24 hours'"),
            ["team-1"],
        );
    });

    it("refuses runs once spend reaches the cap", async () => {
        await expect(
            assertTeamSpendUnderCap(dbWithSpend(10), "team-1", 10),
        ).rejects.toThrowError(
            new ApiConflictError(
                "This team has spent $10.00 in the last 24 hours, reaching its $10.00 daily cap. New runs are blocked until spend falls below the cap.",
            ),
        );
    });

    it("counts eval cells, workflow cells, and workflow STT spend", async () => {
        const db = dbWithSpend(0);

        await assertTeamSpendUnderCap(db, "team-1", 10);

        const sql = vi.mocked(db.query).mock.calls[0]![0] as string;
        expect(sql).toContain("from run_cells");
        expect(sql).toContain("from workflow_run_cells");
        expect(sql).toContain("incurred_cost_usd");
    });
});

function dbWithSpend(spentUsd: number): IDb {
    return {
        query: vi.fn(async () => ({ rows: [{ spentUsd }] })),
    } as unknown as IDb;
}
