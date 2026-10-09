import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    requireActiveProject: vi.fn(),
    redirect: vi.fn((path: string) => {
        throw new Error(`NEXT_REDIRECT:${path}`);
    }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/server/projects/activeProject", () => ({
    requireActiveProject: mocks.requireActiveProject,
}));
// The async server body is covered in dashboard-content.test.tsx.
vi.mock("./dashboard/dashboard-content", () => ({
    DashboardContent: ({ projectId }: { projectId: string }) => (
        <p>content for {projectId}</p>
    ),
}));

import { UserFacingError } from "@/server/lib/errors";
import HomePage from "./page";
import DashboardRedirect from "./dashboard/page";

describe("HomePage", () => {
    afterEach(cleanup);
    beforeEach(() => vi.clearAllMocks());

    it("renders the active project's dashboard at /", async () => {
        mocks.requireActiveProject.mockResolvedValue({
            teamId: "team-1",
            projectId: "project-2",
            workspaceId: "ws-1",
            projects: [
                { id: "project-1", name: "Alpha" },
                { id: "project-2", name: "Beta" },
            ],
        });

        render(await HomePage());

        expect(
            screen.getByRole("heading", { level: 1, name: "Dashboard" }),
        ).toBeInTheDocument();
        expect(screen.getByText("Beta")).toBeInTheDocument();
        expect(screen.getByRole("link", { name: "New run" })).toHaveAttribute(
            "href",
            "/runs/new",
        );
        expect(screen.getByText("content for project-2")).toBeInTheDocument();
    });

    it("sends a user with no workspace or project to choose one", async () => {
        mocks.requireActiveProject.mockRejectedValue(
            new UserFacingError("No project is available for this workspace."),
        );

        await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT:/workspaces");
    });

    it("does not hide unexpected failures behind the workspace redirect", async () => {
        mocks.requireActiveProject.mockRejectedValue(new Error("API down"));

        await expect(HomePage()).rejects.toThrow("API down");
        expect(mocks.redirect).not.toHaveBeenCalled();
    });
});

describe("/dashboard", () => {
    it("redirects to /", () => {
        expect(() => DashboardRedirect()).toThrow("NEXT_REDIRECT:/");
    });
});
