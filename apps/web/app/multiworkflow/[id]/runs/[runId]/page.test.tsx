import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";

const mocks = vi.hoisted(() => ({
    getWorkflowRunDetail: vi.fn(),
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
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/stt-evals/stt-run-results", () => ({
    SttRunResults: () => <div>Run results</div>,
}));
vi.mock("@/components/runs/run-progress-card", () => ({
    RunProgressCard: () => <div>Run progress</div>,
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
            new MosaicApiError("Not found", 404),
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
});
