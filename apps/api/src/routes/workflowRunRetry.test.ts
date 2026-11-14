import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../db.js";
import { ApiConflictError, ApiNotFoundError } from "../errors.js";
import { rateLimitCategoryFor } from "../rateLimit.js";
import {
    cancelWorkflowRunPayload,
    retryWorkflowRunPayload,
} from "./workflowRunRetry.js";

const input = {
    teamId: "team-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    workflowRunId: "run-1",
};

function dbWith(responses: {
    status?: string;
    stopReason?: string;
    failedCellIds?: string[];
    unfinishedCells?: number;
    answersToRejudge?: number;
    publication?: string;
    liveJob?: boolean;
}): IDb & { query: ReturnType<typeof vi.fn> } {
    return {
        query: vi.fn(async (sql: string) => {
            if (sql.includes("from workflow_runs"))
                return {
                    rows: responses.status
                        ? [
                              {
                                  status: responses.status,
                                  stopReason: responses.stopReason ?? null,
                              },
                          ]
                        : [],
                } as never;
            if (sql.includes("select id from workflow_run_cells"))
                return {
                    rows: (responses.failedCellIds ?? []).map((id) => ({ id })),
                } as never;
            if (sql.includes("as rejudge from workflow_run_answers"))
                return {
                    rows: [{ rejudge: responses.answersToRejudge ?? 0 }],
                } as never;
            if (sql.includes("count(*)::int as count"))
                return {
                    rows: [{ count: responses.unfinishedCells ?? 0 }],
                } as never;
            if (sql.includes("select status from workflow_run_enqueue_outbox"))
                return {
                    rows: responses.publication
                        ? [{ status: responses.publication }]
                        : [],
                } as never;
            if (sql.includes(".job"))
                return {
                    rows: responses.liveJob ? [{ id: "job-1" }] : [],
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
            requeued: true,
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
        expect(reset).not.toContain("cost_usd = null");
        expect(reset).toContain("'{providerMetadata,transcriptionSpend}'");
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
        expect(statements.at(-1)).toContain("stop_reason = null");
        expect(statements.at(-1)).toContain("error = null");
    });

    it("rejects a running run, so retries cannot stack", async () => {
        const db = dbWith({ status: "running", failedCellIds: ["cell"] });
        await expect(retryWorkflowRunPayload(db, input)).rejects.toThrow(
            ApiConflictError,
        );
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("leaves a pending run alone while its job still waits in the queue", async () => {
        for (const responses of [
            { publication: "pending_enqueue" },
            { publication: "publishing" },
            { publication: "queued", liveJob: true },
        ]) {
            const db = dbWith({ status: "pending", ...responses });
            await expect(retryWorkflowRunPayload(db, input)).resolves.toEqual({
                retriedCellCount: 0,
                requeued: false,
            });
            const statements = db.query.mock.calls.map(([sql]) => String(sql));
            expect(
                statements.some((sql) =>
                    sql.includes("insert into workflow_run_enqueue_outbox"),
                ),
            ).toBe(false);
        }
    });

    it("queues a pending run again once its job is gone", async () => {
        const db = dbWith({ status: "pending", publication: "queued" });
        await expect(retryWorkflowRunPayload(db, input)).resolves.toEqual({
            retriedCellCount: 0,
            requeued: true,
        });
        const statements = db.query.mock.calls.map(([sql]) => String(sql));
        expect(statements.find((sql) => sql.includes(".job"))).toContain(
            "singleton_key = $2",
        );
        expect(
            statements.some((sql) =>
                sql.includes("insert into workflow_run_enqueue_outbox"),
            ),
        ).toBe(true);
        expect(
            statements.some((sql) => sql.includes("update workflow_run_cells")),
        ).toBe(false);
    });

    it("resumes a cancelled run: steps that did not run go back to the queue", async () => {
        const db = dbWith({
            status: "cancelled",
            stopReason: "cancelled",
            unfinishedCells: 4,
        });
        await expect(retryWorkflowRunPayload(db, input)).resolves.toEqual({
            retriedCellCount: 0,
            requeued: true,
        });
        const statements = db.query.mock.calls.map(([sql]) => String(sql));
        expect(
            statements.some(
                (sql) =>
                    sql.includes("update workflow_run_cells") &&
                    sql.includes("status = 'running'"),
            ),
        ).toBe(true);
        expect(statements.at(-1)).toContain("cancel_requested_at = null");
    });

    it("runs again a run that failed before any step started", async () => {
        const db = dbWith({ status: "failed", unfinishedCells: 2 });
        await expect(retryWorkflowRunPayload(db, input)).resolves.toEqual({
            retriedCellCount: 0,
            requeued: true,
        });
    });

    it("queues a completed run again when a benchmark judge failed on an answer", async () => {
        const db = dbWith({ status: "completed", answersToRejudge: 2 });
        await expect(retryWorkflowRunPayload(db, input)).resolves.toEqual({
            retriedCellCount: 0,
            requeued: true,
        });
        const statements = db.query.mock.calls.map(([sql]) => String(sql));
        expect(statements.find((sql) => sql.includes("as rejudge"))).toContain(
            "exists(@.error)",
        );
        expect(
            statements.some((sql) =>
                sql.includes("insert into workflow_run_enqueue_outbox"),
            ),
        ).toBe(true);
        expect(statements.at(-1)).toContain("set status = 'pending'");
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

describe("cancelWorkflowRunPayload", () => {
    it("cancels a pending run at once", async () => {
        const db = dbWith({ status: "pending" });
        await expect(cancelWorkflowRunPayload(db, input)).resolves.toEqual({
            workflowRunId: "run-1",
            status: "cancelled",
            stopReason: "cancelled",
        });
        const update = db.query.mock.calls.at(-1)!;
        expect(String(update[0])).toContain("cancel_requested_at");
        expect(update[1]).toEqual(["run-1", "cancelled"]);
    });

    it("asks a running run to stop and leaves it running until the worker stops", async () => {
        const db = dbWith({ status: "running", unfinishedCells: 2 });
        await expect(cancelWorkflowRunPayload(db, input)).resolves.toEqual({
            workflowRunId: "run-1",
            status: "running",
            stopReason: "cancelled",
        });
        expect(db.query.mock.calls.at(-1)![1]).toEqual(["run-1", "running"]);
    });

    it("cancels at once a run whose steps finished and only waits for its eval run", async () => {
        const db = dbWith({ status: "running", publication: "queued" });
        await expect(cancelWorkflowRunPayload(db, input)).resolves.toEqual({
            workflowRunId: "run-1",
            status: "cancelled",
            stopReason: "cancelled",
        });
        expect(db.query.mock.calls.at(-1)![1]).toEqual(["run-1", "cancelled"]);
    });

    it("leaves a finished-steps run running while a worker still holds it", async () => {
        const db = dbWith({
            status: "running",
            publication: "queued",
            liveJob: true,
        });
        await expect(
            cancelWorkflowRunPayload(db, input),
        ).resolves.toMatchObject({ status: "running" });
        expect(db.query.mock.calls.at(-1)![1]).toEqual(["run-1", "running"]);
    });

    it("leaves a finished run as it is", async () => {
        const db = dbWith({ status: "cancelled", stopReason: "spend_cap" });
        await expect(cancelWorkflowRunPayload(db, input)).resolves.toEqual({
            workflowRunId: "run-1",
            status: "cancelled",
            stopReason: "spend_cap",
        });
        expect(db.query).toHaveBeenCalledTimes(1);
    });

    it("hides runs outside the caller's team, project, or workflow", async () => {
        await expect(
            cancelWorkflowRunPayload(dbWith({}), input),
        ).rejects.toThrow(ApiNotFoundError);
    });
});
