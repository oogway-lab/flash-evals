import { afterEach, describe, expect, it, vi } from "vitest";
import { logWorkerEvent, safeWorkerError } from "./workerObservability";

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
            service: "mosaic-worker",
            event: "job.started",
            queue: "eval-run",
            runId: "run-1",
            jobId: "job-1",
        });
        expect(payload).not.toHaveProperty("message");
        expect(payload).not.toHaveProperty("stack");
    });
});
