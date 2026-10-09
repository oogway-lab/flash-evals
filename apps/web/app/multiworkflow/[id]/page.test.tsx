import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MosaicApiError } from "@mosaic/api-contract";

const mocks = vi.hoisted(() => ({
    getWorkflow: vi.fn(),
    getRunSetup: vi.fn(),
    listWorkflowRuns: vi.fn(),
    listWorkflowLlmRoutes: vi.fn(),
    getWorkflowLlmProjectDefault: vi.fn(),
    editor: vi.fn(),
    notFound: vi.fn(() => {
        throw new Error("NEXT_NOT_FOUND");
    }),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/actions", () => ({
    createSttEvalRunAction: vi.fn(),
    createWorkflowLlmRouteForNode: vi.fn(),
    loadWorkflowLlmModelsForNode: vi.fn(),
    saveSttEvalAction: vi.fn(),
}));
vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn().mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
    }),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        getWorkflow: mocks.getWorkflow,
        getRunSetup: mocks.getRunSetup,
        listWorkflowRuns: mocks.listWorkflowRuns,
        listWorkflowLlmRoutes: mocks.listWorkflowLlmRoutes,
        getWorkflowLlmProjectDefault: mocks.getWorkflowLlmProjectDefault,
    }),
}));
vi.mock("@/components/layout/page-header", () => ({
    PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
}));
vi.mock("@/components/stt-evals/stt-workflow-editor", () => ({
    SttWorkflowEditor: (props: unknown) => {
        mocks.editor(props);
        return <div>Workflow editor</div>;
    },
}));
vi.mock("@/components/stt-evals/workflow-run-history", () => ({
    WorkflowRunHistory: () => <div>Run history</div>,
}));

import SttEvalCanvasPage from "./page";

function renderPage() {
    return SttEvalCanvasPage({
        params: Promise.resolve({ id: "workflow-1" }),
        searchParams: Promise.resolve({}),
    });
}

describe("Pipeline canvas page", () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getWorkflow.mockResolvedValue({
            id: "workflow-1",
            name: "Canvas",
            kind: "multi",
            nodes: [],
            edges: [],
        });
        mocks.getRunSetup.mockResolvedValue({ datasets: [] });
        mocks.listWorkflowRuns.mockResolvedValue([]);
        mocks.listWorkflowLlmRoutes.mockResolvedValue([]);
        mocks.getWorkflowLlmProjectDefault.mockResolvedValue({
            default: undefined,
        });
    });

    it("shows not found when the API reports a missing workflow", async () => {
        mocks.getWorkflow.mockRejectedValue(
            new MosaicApiError("Not found", 404),
        );

        await expect(renderPage()).rejects.toThrow("NEXT_NOT_FOUND");
    });

    it("throws other API failures to the error boundary", async () => {
        mocks.getWorkflow.mockRejectedValue(new TypeError("fetch failed"));

        await expect(renderPage()).rejects.toThrow("fetch failed");
        expect(mocks.notFound).not.toHaveBeenCalled();
    });

    it("keeps the canvas usable when LLM routing fails to load", async () => {
        mocks.listWorkflowLlmRoutes.mockRejectedValue(
            new MosaicApiError("Unavailable", 503),
        );

        render(await renderPage());

        expect(screen.getByText("Workflow editor")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent(
            /LLM routing is temporarily unavailable/,
        );
        expect(mocks.editor).toHaveBeenCalledWith(
            expect.objectContaining({
                canvas: expect.objectContaining({ llmRoutes: [] }),
            }),
        );
    });
});
