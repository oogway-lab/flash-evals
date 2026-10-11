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
vi.mock("./dashboard-content", () => ({
    DashboardContent: ({ projectId }: { projectId: string }) => (
        <p>content for {projectId}</p>
    ),
}));

import { UserFacingError } from "@/server/lib/errors";
import { ForbiddenError } from "@/server/auth/session";
import DashboardPage from "./page";

describe("DashboardPage", () => {
    afterEach(cleanup);
    beforeEach(() => vi.clearAllMocks());

    it("renders the active project's dashboard at /dashboard", async () => {
        mocks.requireActiveProject.mockResolvedValue({
            teamId: "team-1",
            projectId: "project-2",
            workspaceId: "ws-1",
            projects: [
                { id: "project-1", name: "Alpha" },
                { id: "project-2", name: "Beta" },
            ],
        });

        render(await DashboardPage());

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

        await expect(DashboardPage()).rejects.toThrow(
            "NEXT_REDIRECT:/workspaces",
        );
    });

    it("does not hide unexpected failures behind the workspace redirect", async () => {
        mocks.requireActiveProject.mockRejectedValue(new Error("API down"));

        await expect(DashboardPage()).rejects.toThrow("API down");
        expect(mocks.redirect).not.toHaveBeenCalled();
    });

    it("sends a signed-in user rejected by company admission to access denied", async () => {
        mocks.requireActiveProject.mockRejectedValue(
            new ForbiddenError("A verified company email is required."),
        );
        await expect(DashboardPage()).rejects.toThrow(
            "NEXT_REDIRECT:/access-denied",
        );
    });
});
