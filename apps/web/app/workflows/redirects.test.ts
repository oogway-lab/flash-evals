import { beforeEach, describe, expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ redirect }));

import WorkflowsRedirectPage from "./page";
import NewWorkflowRedirectPage from "./new/page";
import WorkflowRedirectPage from "./[id]/page";
import WorkflowCanvasRedirectPage from "./[id]/canvas/page";
import WorkflowRunRedirectPage from "./[id]/runs/[runId]/page";

describe("legacy workflow redirects", () => {
    beforeEach(() => redirect.mockReset());

    it("redirects the list and create pages to Multiworkflow", () => {
        WorkflowsRedirectPage();
        NewWorkflowRedirectPage();

        expect(redirect).toHaveBeenNthCalledWith(1, "/multiworkflow");
        expect(redirect).toHaveBeenNthCalledWith(2, "/multiworkflow/new");
    });

    it("preserves workflow and run ids in legacy bookmarks", async () => {
        await WorkflowRedirectPage({
            params: Promise.resolve({ id: "workflow-1" }),
            searchParams: Promise.resolve({}),
        });
        await WorkflowCanvasRedirectPage({
            params: Promise.resolve({ id: "workflow-1" }),
        });
        await WorkflowRunRedirectPage({
            params: Promise.resolve({ id: "workflow-1", runId: "run-1" }),
        });

        expect(redirect).toHaveBeenNthCalledWith(
            1,
            "/multiworkflow/workflow-1",
        );
        expect(redirect).toHaveBeenNthCalledWith(
            2,
            "/multiworkflow/workflow-1",
        );
        expect(redirect).toHaveBeenNthCalledWith(
            3,
            "/multiworkflow/workflow-1/runs/run-1",
        );
    });
});
