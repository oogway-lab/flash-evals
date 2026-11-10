import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FlashEvalsApiError } from "@flash-evals/api-contract";

const mocks = vi.hoisted(() => ({
    getWorkflowRunDetail: vi.fn(),
    modelInfoFor: vi.fn(),
    notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
    }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn().mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
    }),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        getWorkflowRunDetail: mocks.getWorkflowRunDetail,
    }),
}));
vi.mock("@/components/layout/page-header", () => ({
    PageHeader: ({
        title,
        action,
    }: {
        title: string;
        action?: React.ReactNode;
    }) => (
        <>
            <h1>{title}</h1>
            {action}
        </>
    ),
}));
vi.mock("@/components/runs/run-header-actions", () => ({
    RunHeaderActions: (props: Record<string, unknown>) => (
        <div data-testid="header-actions">{JSON.stringify(props)}</div>
    ),
}));
vi.mock("@/server/runs/modelInfo", () => ({
    modelInfoFor: mocks.modelInfoFor,
}));
vi.mock("@/components/stt-evals/pipeline-comparison", () => ({
    PipelineComparison: (props: Record<string, unknown>) => (
        <div data-testid="pipeline-comparison">{JSON.stringify(props)}</div>
    ),
}));
vi.mock("@/components/stt-evals/stt-run-results", () => ({
    SttRunResults: () => <div>Run results</div>,
}));
vi.mock("@/components/runs/run-progress-card", () => ({
    RunProgressCard: ({
        initial,
        maxCostUsd,
    }: {
        initial: Record<string, unknown>;
        maxCostUsd?: number;
    }) => (
        <div data-testid="run-progress">
            {JSON.stringify({ initial, maxCostUsd })}
        </div>
    ),
}));

import SttEvalRunPage from "./page";

describe("Pipeline run page", () => {
    afterEach(cleanup);

    beforeEach(() => {
        mocks.getWorkflowRunDetail.mockResolvedValue({
            workflowRun: {
                status: "completed",
                workflowSnapshot: { kind: "multi" },
            },
            progress: {},
        });
    });

    it("renders results for a multi workflow run", async () => {
        const page = await SttEvalRunPage({
            params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
        });

        render(page);

        expect(screen.getByText("Run results")).toBeInTheDocument();
        expect(mocks.notFound).not.toHaveBeenCalled();
    });

    it("renders immutable prompt-workflow history after migration", async () => {
        mocks.getWorkflowRunDetail.mockResolvedValue({
            workflowRun: {
                status: "completed",
                workflowSnapshot: { kind: "prompt" },
            },
            progress: {},
        });

        const page = await SttEvalRunPage({
            params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
        });

        render(page);

        expect(screen.getByText("Run results")).toBeInTheDocument();
        expect(mocks.notFound).not.toHaveBeenCalled();
    });

    it("shows not found only when the API reports a missing run", async () => {
        mocks.getWorkflowRunDetail.mockRejectedValue(
            new FlashEvalsApiError("Not found", 404),
        );

        await expect(
            SttEvalRunPage({
                params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
            }),
        ).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("throws other API failures to the error boundary", async () => {
        mocks.getWorkflowRunDetail.mockRejectedValue(
            new TypeError("fetch failed"),
        );

        await expect(
            SttEvalRunPage({
                params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
            }),
        ).rejects.toThrow("fetch failed");
        expect(mocks.notFound).not.toHaveBeenCalled();
    });

    it("offers cancel, stop and setup-error details for an active pipeline run", async () => {
        mocks.getWorkflowRunDetail.mockResolvedValue({
            workflowRun: {
                status: "running",
                stopReason: "cancelled",
                error: "Worker setup failed.",
                configSnapshot: { maxCostUsd: 4 },
                workflowSnapshot: { kind: "prompt" },
            },
            progress: { total: 3, done: 1, failed: 0, pending: 2 },
        });

        render(
            await SttEvalRunPage({
                params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
            }),
        );

        expect(
            JSON.parse(screen.getByTestId("header-actions").textContent!),
        ).toEqual({
            runId: "run-1",
            workflowId: "workflow-1",
            status: "running",
            stopReason: "cancelled",
        });
        expect(
            JSON.parse(screen.getByTestId("run-progress").textContent!),
        ).toEqual({
            initial: {
                total: 3,
                done: 1,
                failed: 0,
                pending: 2,
                status: "running",
                stopReason: "cancelled",
                error: "Worker setup failed.",
            },
            maxCostUsd: 4,
        });
        expect(screen.getByLabelText("Run settings")).toHaveTextContent(
            "$4.00",
        );
    });

    it("hands the header the answers to judge again on a completed run", async () => {
        mocks.getWorkflowRunDetail.mockResolvedValue({
            workflowRun: {
                status: "completed",
                workflowSnapshot: { kind: "multi" },
            },
            progress: {},
            answersToRejudge: 4,
        });

        render(
            await SttEvalRunPage({
                params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
            }),
        );

        expect(
            JSON.parse(screen.getByTestId("header-actions").textContent!),
        ).toEqual({
            runId: "run-1",
            workflowId: "workflow-1",
            status: "completed",
            answersToRejudge: 4,
        });
    });

    it("shows the comparison with the chosen eval run above the item outputs", async () => {
        const comparison = {
            run: { id: "eval-run-1", status: "completed" },
            referenceModelId: "openai/big-model",
            summary: [],
        };
        mocks.modelInfoFor.mockResolvedValue({
            "openai/big-model": { label: "Big Model" },
        });
        mocks.getWorkflowRunDetail.mockResolvedValue({
            workflowRun: {
                status: "completed",
                workflowSnapshot: { kind: "multi", name: "Acme chain" },
            },
            progress: {},
            comparison,
        });

        render(
            await SttEvalRunPage({
                params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
            }),
        );

        const section = screen.getByTestId("pipeline-comparison");
        expect(JSON.parse(section.textContent!)).toEqual({
            comparison,
            pipelineName: "Acme chain",
            referenceName: "Big Model",
            referenceInfo: { label: "Big Model" },
            runStatus: "completed",
        });
        expect(
            section.compareDocumentPosition(screen.getByText("Run results")) &
                Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
    });
});
