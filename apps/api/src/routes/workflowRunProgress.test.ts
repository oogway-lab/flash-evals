import { describe, expect, it, vi } from "vitest";
import type { IDb } from "../db.js";
import {
    workflowCellServedBy,
    workflowRunProgressPayload,
} from "./workflowRuns.js";

describe("workflow run progress", () => {
    function progressDb(row: Record<string, unknown>): IDb {
        return {
            query: vi.fn(async () => ({
                rows: [
                    {
                        total: 4,
                        done: 1,
                        failed: 0,
                        pending: 3,
                        enqueueStatus: "queued",
                        stopReason: null,
                        error: null,
                        pendingSince: new Date("2026-11-01T10:00:00.000Z"),
                        ...row,
                    },
                ],
            })) as never,
        };
    }

    it("says when a pending run was queued and whether its publication went through", async () => {
        await expect(
            workflowRunProgressPayload(
                progressDb({ status: "pending" }),
                "team-1",
                "project-1",
                "workflow-1",
                "run-1",
            ),
        ).resolves.toEqual({
            status: "pending",
            total: 4,
            done: 1,
            failed: 0,
            pending: 3,
            enqueueStatus: "queued",
            pendingSince: "2026-11-01T10:00:00.000Z",
        });
    });

    it("reports a stop request and a setup error, and no wait time once running", async () => {
        await expect(
            workflowRunProgressPayload(
                progressDb({
                    status: "cancelled",
                    stopReason: "spend_cap",
                    error: "Worker setup failed.",
                }),
                "team-1",
                "project-1",
                "workflow-1",
                "run-1",
            ),
        ).resolves.toEqual({
            status: "cancelled",
            total: 4,
            done: 1,
            failed: 0,
            pending: 3,
            enqueueStatus: "queued",
            stopReason: "spend_cap",
            error: "Worker setup failed.",
        });
    });

    it("names the host that served a step from its routing evidence", () => {
        expect(
            workflowCellServedBy({
                outputJson: {
                    text: "",
                    executionProvenance: {
                        actual: {
                            status: "resolved",
                            identity: {
                                transport: "openrouter",
                                modelId: "acme/model",
                                upstreamProvider: "together",
                            },
                            evidenceCompleteness: "complete",
                        },
                    },
                } as never,
            }),
        ).toBe("together");
        expect(
            workflowCellServedBy({
                outputJson: {
                    text: "",
                    executionProvenance: {
                        actual: {
                            status: "not_invoked",
                            evidenceCompleteness: "complete",
                        },
                    },
                } as never,
            }),
        ).toBeUndefined();
        expect(workflowCellServedBy({})).toBeUndefined();
    });
});
