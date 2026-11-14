import { afterEach, describe, expect, it, vi } from "vitest";
import {
    logQueueWarning,
    logWorkerEvent,
    safeWorkerError,
} from "./workerObservability";

afterEach(() => vi.restoreAllMocks());

describe("worker observability", () => {
    it("keeps error diagnostics useful without logging messages or stacks", () => {
        const error = Object.assign(
            new Error("API key sk-test-secret in prompt: private text"),
            { code: "ETIMEDOUT" },
        );

        expect(safeWorkerError(error)).toEqual({
            errorName: "Error",
            errorCode: "ETIMEDOUT",
        });
    });

    it("collapses provider-supplied names and codes outside the allowlists", () => {
        const error = Object.assign(
            new Error("request contained private provider data"),
            { name: "ProviderError_sk-live-secret", code: "sk-live-secret" },
        );

        expect(safeWorkerError(error)).toEqual({ errorName: "Error" });
    });

    it("writes correlated structured events without message fields", () => {
        const info = vi.spyOn(console, "info").mockImplementation(() => {});
        logWorkerEvent("info", "job.started", {
            queue: "eval-run",
            runId: "run-1",
            jobId: "job-1",
        });

        const payload = JSON.parse(String(info.mock.calls[0]?.[0])) as Record<
            string,
            unknown
        >;
        expect(payload).toMatchObject({
            service: "flash-evals-worker",
            event: "job.started",
            queue: "eval-run",
            runId: "run-1",
            jobId: "job-1",
        });
        expect(payload).not.toHaveProperty("message");
        expect(payload).not.toHaveProperty("stack");
    });

    it("logs pg-boss warnings by type without their message", () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        logQueueWarning("eval-run", {
            message: "select * from secret_table where prompt = 'private'",
            data: {
                type: "handler_overrun",
                queue: "eval-run",
                jobs: ["job-1"],
                expireInSeconds: 900,
            },
        });
        logQueueWarning("eval-run", {
            message: "x",
            data: { type: "sk-live-secret" },
        });

        const lines = warn.mock.calls.map((call) =>
            JSON.parse(String(call[0])),
        );
        expect(lines[0]).toMatchObject({
            event: "queue.warning",
            queue: "eval-run",
            warningType: "handler_overrun",
            expireInSeconds: 900,
        });
        expect(JSON.stringify(lines)).not.toContain("secret");
        expect(lines[1].warningType).toBe("unknown");
    });
});
