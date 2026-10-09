import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorkflowRunHistory } from "./workflow-run-history";

describe("WorkflowRunHistory", () => {
    it("links completed workflow runs from the workflow page", () => {
        render(
            <WorkflowRunHistory
                workflowId="workflow-1"
                runs={[
                    {
                        id: "run-12345678",
                        workflowId: "workflow-1",
                        datasetId: "dataset-1",
                        datasetName: "Calls",
                        status: "completed",
                        runTarget: "dataset",
                        total: 2,
                        done: 2,
                        failed: 0,
                        createdAt: "2026-07-12T00:00:00.000Z",
                    },
                ]}
            />,
        );

        expect(screen.getByText("Run history")).toBeTruthy();
        expect(screen.getByRole("link")).toHaveAttribute(
            "href",
            "/multiworkflow/workflow-1/runs/run-12345678",
        );
        expect(screen.getByText("2/2")).toBeTruthy();
    });
});
