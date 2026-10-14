import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../db.js";
import { ApiConflictError, ApiNotFoundError } from "../errors.js";
import { rateLimitCategoryFor } from "../rateLimit.js";
import { retryWorkflowRunPayload } from "./workflowRunRetry.js";

const input = {
    teamId: "team-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    workflowRunId: "run-1",
};

function dbWith(responses: {
    status?: string;
    failedCellIds?: string[];
}): IDb & { query: ReturnType<typeof vi.fn> } {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from workflow_runs"))
                return {
                    rows: responses.status
                        ? [{ status: responses.status }]
                        : [],
                } as never;
            if (sql.includes("select id from workflow_run_cells"))
                return {
                    rows: (responses.failedCellIds ?? []).map((id) => ({ id })),
                } as never;
            return { rows: [] } as never;
        }),
    };
}

describe("retryWorkflowRunPayload", () => {
    it("requeues failed and blocked cells and keeps successful ones", async () => {
        const db = dbWith({
            status: "partial",
            failedCellIds: ["stt-cell", "translate-cell", "summary-cell"],
        });
        await expect(retryWorkflowRunPayload(db, input)).resolves.toEqual({
            retriedCellCount: 3,
        });
        const statements = db.query.mock.calls.map(([sql]) => String(sql));
        expect(statements[0]).toMatch(/from workflow_runs[\s\S]*for update/);
        expect(db.query).toHaveBeenCalledWith(
            expect.stringContaining("delete from workflow_cell_scores"),
            [["stt-cell", "translate-cell", "summary-cell"]],
        );
        const reset = statements.find((sql) =>
            sql.includes("update workflow_run_cells"),
        );
        expect(reset).toContain("status = 'pending'");
        expect(reset).toContain("and status = 'failed'");
        expect(
            statements.some((sql) =>
                sql.includes("preparation_status = 'error'"),
            ),
        ).toBe(true);
        expect(
            statements.some((sql) =>
                sql.includes("insert into workflow_run_enqueue_outbox"),
            ),
        ).toBe(true);
        expect(statements.at(-1)).toContain("set status = 'pending'");
    });

    it("rejects a run that is still in progress, so retries cannot stack", async () => {
        for (const status of ["pending", "running"]) {
            const db = dbWith({ status, failedCellIds: ["cell"] });
            await expect(retryWorkflowRunPayload(db, input)).rejects.toThrow(
                ApiConflictError,
            );
            expect(db.query).toHaveBeenCalledTimes(1);
        }
    });

    it("rejects a run with nothing to retry", async () => {
        await expect(
            retryWorkflowRunPayload(dbWith({ status: "completed" }), input),
        ).rejects.toThrow("no failed cells");
        await expect(
            retryWorkflowRunPayload(
                dbWith({ status: "failed", failedCellIds: [] }),
                input,
            ),
        ).rejects.toThrow("no failed cells");
    });

    it("hides runs outside the caller's team, project, or workflow", async () => {
        const db = dbWith({});
        await expect(retryWorkflowRunPayload(db, input)).rejects.toThrow(
            ApiNotFoundError,
        );
        expect(db.query).toHaveBeenCalledWith(expect.any(String), [
            "run-1",
            "team-1",
            "project-1",
            "workflow-1",
        ]);
    });

    it("is rate limited with run creation", () => {
        expect(
            rateLimitCategoryFor("POST", "/api/workflows/w-1/runs/r-1/retry"),
        ).toBe("runs");
    });
});
