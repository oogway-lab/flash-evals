import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listWorkflows: vi.fn(),
    listWorkflowRuns: vi.fn(),
}));

vi.mock("@/app/actions", () => ({ deleteWorkflowAction: vi.fn() }));
vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: vi.fn().mockResolvedValue({
        teamId: "team-1",
        projectId: "project-1",
    }),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        listWorkflows: mocks.listWorkflows,
        listWorkflowRuns: mocks.listWorkflowRuns,
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

import MultiworkflowPage from "./page";
import { RecentRuns } from "./recent-runs";

const run = {
    id: "run-1",
    workflowId: "workflow-1",
    datasetName: "Calls",
    status: "completed",
    createdAt: "2026-09-01T00:00:00.000Z",
};

describe("Pipelines list page", () => {
    afterEach(cleanup);

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.listWorkflows.mockResolvedValue([
            {
                id: "workflow-1",
                name: "First",
                description: "",
                nodeCount: 1,
                createdAt: "2026-09-01T00:00:00.000Z",
            },
            {
                id: "workflow-2",
                name: "Second",
                description: "Two inputs",
                nodeCount: 4,
                createdAt: "2026-09-02T00:00:00.000Z",
            },
        ]);
    });

    it("lists pipelines in a table under the Pipelines title", async () => {
        mocks.listWorkflowRuns.mockReturnValue(new Promise(() => {}));

        render(await MultiworkflowPage());

        expect(
            screen.getByRole("heading", { level: 1, name: "Pipelines" }),
        ).toBeInTheDocument();
        expect(screen.queryByText(/multiworkflow/i)).not.toBeInTheDocument();
        // The URL keeps its old name.
        expect(screen.getByRole("link", { name: "First" })).toHaveAttribute(
            "href",
            "/multiworkflow/workflow-1",
        );
        expect(
            screen.getByRole("link", { name: "New pipeline" }),
        ).toHaveAttribute("href", "/multiworkflow/new");
        const row = screen.getByRole("row", { name: /Second/ });
        expect(within(row).getByText("Two inputs")).toBeInTheDocument();
        expect(within(row).getByText("4")).toHaveClass("text-right");
        expect(
            screen.getByRole("button", { name: "More actions for Second" }),
        ).toBeInTheDocument();
    });

    it("keeps one New pipeline action when there are no pipelines", async () => {
        mocks.listWorkflows.mockResolvedValue([]);

        render(await MultiworkflowPage());

        expect(screen.getByText("No pipelines yet")).toBeInTheDocument();
        expect(
            screen.getAllByRole("link", { name: "New pipeline" }),
        ).toHaveLength(1);
        expect(mocks.listWorkflowRuns).not.toHaveBeenCalled();
    });

    it("renders the workflow list without waiting on recent runs", async () => {
        mocks.listWorkflowRuns.mockReturnValue(new Promise(() => {}));

        render(await MultiworkflowPage());

        expect(screen.getByText("First")).toBeInTheDocument();
        expect(screen.getByRole("status")).toHaveTextContent(
            "Loading recent runs",
        );
    });

    const recentRuns = () =>
        RecentRuns({
            teamId: "team-1",
            projectId: "project-1",
            workflowIds: ["workflow-1", "workflow-2"],
        });

    it("lists recent runs without a notice when every workflow loads", async () => {
        mocks.listWorkflowRuns.mockResolvedValue([run]);

        render(await recentRuns());

        expect(screen.getByText("Recent runs")).toBeInTheDocument();
        expect(screen.getAllByText("Calls")).toHaveLength(2);
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("shows a notice when some recent runs fail to load", async () => {
        mocks.listWorkflowRuns
            .mockResolvedValueOnce([run])
            .mockRejectedValueOnce(new TypeError("fetch failed"));

        render(await recentRuns());

        expect(screen.getByText("Calls")).toBeInTheDocument();
        expect(screen.getByRole("alert")).toHaveTextContent(
            /recent runs could not be loaded/i,
        );
    });
});
