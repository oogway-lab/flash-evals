import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    redirect: vi.fn(),
    getRunSetup: vi.fn().mockResolvedValue({ datasets: [], sttModels: [] }),
    getWorkflow: vi.fn().mockResolvedValue({
        id: "workflow-1",
        kind: "multi",
        name: "Workflow",
    }),
    getWorkflowRunDetail: vi.fn().mockResolvedValue({
        workflowRun: { status: "completed" },
        progress: {},
    }),
    listWorkflowRuns: vi.fn().mockResolvedValue([]),
    listWorkflows: vi.fn().mockResolvedValue([]),
}));

vi.mock("next/navigation", () => ({
    notFound: vi.fn(),
    redirect: mocks.redirect,
}));
vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn().mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
    }),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        getRunSetup: mocks.getRunSetup,
        getWorkflow: mocks.getWorkflow,
        getWorkflowRunDetail: mocks.getWorkflowRunDetail,
        listWorkflowRuns: mocks.listWorkflowRuns,
        listWorkflows: mocks.listWorkflows,
    }),
}));

import SttEvalsRedirectPage from "./page";
import NewSttEvalRedirectPage from "./new/page";
import SttEvalRedirectPage from "./[id]/page";
import SttEvalRunRedirectPage from "./[id]/runs/[runId]/page";

describe("legacy STT eval redirects", () => {
    beforeEach(() => mocks.redirect.mockReset());

    it("redirects list and create bookmarks to Multiworkflow", async () => {
        await SttEvalsRedirectPage();
        await NewSttEvalRedirectPage();

        expect(mocks.redirect).toHaveBeenNthCalledWith(1, "/multiworkflow");
        expect(mocks.redirect).toHaveBeenNthCalledWith(2, "/multiworkflow/new");
    });

    it("preserves workflow and run ids", async () => {
        await SttEvalRedirectPage({
            params: Promise.resolve({ id: "workflow-1" }),
            searchParams: Promise.resolve({}),
        });
        await SttEvalRunRedirectPage({
            params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
        });

        expect(mocks.redirect).toHaveBeenNthCalledWith(
            1,
            "/multiworkflow/workflow-1",
        );
        expect(mocks.redirect).toHaveBeenNthCalledWith(
            2,
            "/multiworkflow/workflow-1/runs/run-1",
        );
    });

    it("carries the query string across the redirect", async () => {
        // The canvas reads `datasetId` to preselect a run dataset, so dropping
        // the query silently loses that selection on any legacy link.
        await SttEvalRedirectPage({
            params: Promise.resolve({ id: "workflow-1" }),
            searchParams: Promise.resolve({ datasetId: "dataset-9" }),
        });

        expect(mocks.redirect).toHaveBeenCalledWith(
            "/multiworkflow/workflow-1?datasetId=dataset-9",
        );
    });
});
