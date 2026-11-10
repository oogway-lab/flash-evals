import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { describeRunNotice, RunStatusNotice } from "./run-status-notice";

afterEach(cleanup);

const progress = { total: 10, done: 4, failed: 1, pending: 5 };

describe("run status notice", () => {
    it("says a run is stopping after a cancel while calls finish", () => {
        expect(
            describeRunNotice({
                ...progress,
                status: "running",
                stopReason: "cancelled",
            }),
        ).toMatchObject({ title: "Stopping" });
    });

    it("counts the cells a cancelled run did not run", () => {
        render(
            <RunStatusNotice
                data={{
                    ...progress,
                    status: "cancelled",
                    stopReason: "cancelled",
                }}
            />,
        );
        expect(screen.getByRole("status")).toHaveTextContent(
            "5 cells did not run. Resume the run to run them.",
        );
    });

    it("says a run stopped at its spend limit and how many cells did not run", () => {
        render(
            <RunStatusNotice
                data={{
                    ...progress,
                    status: "cancelled",
                    stopReason: "spend_cap",
                }}
                maxCostUsd={60}
            />,
        );
        const notice = screen.getByRole("status");
        expect(notice).toHaveTextContent("Stopped at the spend limit");
        expect(notice).toHaveTextContent("$60");
        expect(notice).toHaveTextContent("5 cells did not run");
    });

    it("says the worker hasn't picked up a run pending for over a minute", () => {
        const pendingSince = "2026-11-01T10:00:00.000Z";
        const start = Date.parse(pendingSince);
        const waiting = {
            total: 10,
            done: 0,
            failed: 0,
            pending: 10,
            status: "pending" as const,
            enqueueStatus: "queued" as const,
            pendingSince,
        };
        expect(
            describeRunNotice(waiting, undefined, start + 30_000),
        ).toBeUndefined();
        expect(
            describeRunNotice(waiting, undefined, start + 61_000),
        ).toMatchObject({
            title: "The worker hasn't picked this run up. Is it running?",
            retry: true,
        });
        expect(
            describeRunNotice(
                { ...waiting, enqueueStatus: "pending_enqueue" },
                undefined,
                start + 61_000,
            ),
        ).toMatchObject({ title: "This run hasn't been queued yet" });
        // Some cells already finished: the run is moving, so no notice.
        expect(
            describeRunNotice(
                { ...waiting, done: 1, pending: 9 },
                undefined,
                start + 61_000,
            ),
        ).toBeUndefined();
    });

    it("shows the page's retry control with the waiting notice", () => {
        render(
            <RunStatusNotice
                data={{
                    total: 2,
                    done: 0,
                    failed: 0,
                    pending: 2,
                    status: "pending",
                    pendingSince: new Date(Date.now() - 120_000).toISOString(),
                }}
                retryAction={<button type="button">Retry run</button>}
            />,
        );
        expect(screen.getByRole("status")).toHaveTextContent(
            "The worker hasn't picked this run up. Is it running?",
        );
        expect(
            screen.getByRole("button", { name: "Retry run" }),
        ).toBeInTheDocument();
    });

    it("shows why a run failed before any cell started", () => {
        render(
            <RunStatusNotice
                data={{
                    ...progress,
                    status: "failed",
                    error: "Please add your OpenRouter API key to run evals.",
                }}
            />,
        );
        expect(screen.getByRole("alert")).toHaveTextContent(
            "Please add your OpenRouter API key to run evals.",
        );
    });

    it("stays out of the way for a normal run", () => {
        expect(
            describeRunNotice({ ...progress, status: "running" }),
        ).toBeUndefined();
        expect(
            describeRunNotice({ ...progress, status: "completed" }),
        ).toBeUndefined();
    });
});
