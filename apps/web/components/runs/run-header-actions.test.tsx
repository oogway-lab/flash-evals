import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/runs/cancel-run-button", () => ({
    CancelRunButton: (props: { runId: string; workflowId?: string }) => (
        <button type="button">{`Cancel ${props.workflowId ?? "eval"}`}</button>
    ),
}));
vi.mock("@/components/runs/retry-failed-cells-form", () => ({
    RetryFailedCellsForm: (props: {
        runId: string;
        workflowId?: string;
        variant?: string;
        count?: number;
    }) => (
        <button type="button">{`${props.variant ?? "failed"} ${props.workflowId ?? "eval"}${props.count !== undefined ? ` ${props.count}` : ""}`}</button>
    ),
}));

import { RunHeaderActions, runHeaderActionsFor } from "./run-header-actions";

afterEach(cleanup);

describe("RunHeaderActions", () => {
    it("offers cancel on an active pipeline run, without a rerun link", () => {
        render(
            <RunHeaderActions
                runId="run-1"
                workflowId="workflow-1"
                status="running"
            />,
        );
        expect(
            screen.getByRole("button", { name: "Cancel workflow-1" }),
        ).toBeInTheDocument();
        expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });

    it("hides cancel once a stop was asked for", () => {
        render(
            <RunHeaderActions
                runId="run-1"
                workflowId="workflow-1"
                status="running"
                stopReason="cancelled"
            />,
        );
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("resumes a cancelled pipeline run but not one stopped at its spend limit", () => {
        render(
            <RunHeaderActions
                runId="run-1"
                workflowId="workflow-1"
                status="cancelled"
                stopReason="cancelled"
            />,
        );
        expect(
            screen.getByRole("button", { name: "resume workflow-1" }),
        ).toBeInTheDocument();
        cleanup();
        render(
            <RunHeaderActions
                runId="run-1"
                workflowId="workflow-1"
                status="cancelled"
                stopReason="spend_cap"
            />,
        );
        expect(screen.queryByRole("button")).not.toBeInTheDocument();
    });

    it("renders nothing for a finished pipeline run", () => {
        const { container } = render(
            <RunHeaderActions
                runId="run-1"
                workflowId="workflow-1"
                status="completed"
            />,
        );
        expect(container).toBeEmptyDOMElement();
    });

    it("offers a re-judge on a completed pipeline run whose judge failed", () => {
        render(
            <RunHeaderActions
                runId="run-1"
                workflowId="workflow-1"
                status="completed"
                answersToRejudge={3}
            />,
        );
        expect(
            screen.getByRole("button", { name: "rejudge workflow-1 3" }),
        ).toBeInTheDocument();
        expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    it("keeps the eval run's rerun link and failed-cell retry", () => {
        render(
            <RunHeaderActions
                runId="run-1"
                status="partial"
                reRunHref="/runs/new?from=run-1"
            />,
        );
        expect(screen.getByRole("link", { name: "Rerun" })).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "failed eval" }),
        ).toBeInTheDocument();
    });
});

describe("runHeaderActionsFor", () => {
    it("offers a re-judge only on a completed run with answers to judge", () => {
        expect(
            runHeaderActionsFor({ status: "completed", answersToRejudge: 2 }),
        ).toEqual({
            canCancel: false,
            canRetry: false,
            canResume: false,
            rejudge: 2,
        });
        expect(
            runHeaderActionsFor({ status: "completed", answersToRejudge: 0 })
                .rejudge,
        ).toBe(0);
        expect(runHeaderActionsFor({ status: "completed" }).rejudge).toBe(0);
    });

    it("leaves re-judging to the usual retry on unfinished or failed runs", () => {
        for (const status of [
            "partial",
            "failed",
            "running",
            "pending",
            "cancelled",
        ] as const)
            expect(
                runHeaderActionsFor({ status, answersToRejudge: 2 }).rejudge,
            ).toBe(0);
        expect(
            runHeaderActionsFor({ status: "partial", answersToRejudge: 2 })
                .canRetry,
        ).toBe(true);
    });
});
