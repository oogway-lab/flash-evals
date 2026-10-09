import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    listProjects: vi.fn(),
    listWorkspaces: vi.fn(),
    createProject: vi.fn(),
    updateProject: vi.fn(),
    getCookie: vi.fn(),
    setCookie: vi.fn(),
    revalidatePath: vi.fn(),
}));

vi.mock("@/server/auth/session", () => ({
    requirePrincipal: vi.fn(async () => ({
        teamId: "team-1",
        userId: "user-1",
        defaultWorkspaceId: "workspace-1",
    })),
}));
vi.mock("@/server/api/client", () => ({
    serverApiClient: () => ({
        listProjects: mocks.listProjects,
        listWorkspaces: mocks.listWorkspaces,
        createProject: mocks.createProject,
        updateProject: mocks.updateProject,
    }),
}));
vi.mock("next/headers", () => ({
    cookies: vi.fn(async () => ({
        get: mocks.getCookie,
        set: mocks.setCookie,
        delete: vi.fn(),
    })),
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import {
    createProjectAction,
    activateProjectAction,
    switchProjectAction,
    updateProjectAction,
} from "./projects";

describe("switchProjectAction", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getCookie.mockReturnValue({ value: "workspace-1" });
        mocks.listProjects.mockResolvedValue([
            {
                id: "project-a",
                teamId: "team-1",
                workspaceId: "workspace-1",
                name: "A",
                createdAt: "now",
            },
            {
                id: "project-b",
                teamId: "team-1",
                workspaceId: "workspace-1",
                name: "B",
                createdAt: "now",
            },
        ]);
        mocks.listWorkspaces.mockResolvedValue([
            { id: "workspace-1", teamId: "team-1", name: "Workspace" },
        ]);
        mocks.createProject.mockResolvedValue({
            id: "project-new",
            teamId: "team-1",
            name: "New",
            createdAt: "now",
        });
    });

    it("persists a project from the authenticated workspace", async () => {
        await switchProjectAction("project-b");
        expect(mocks.setCookie).toHaveBeenCalledWith(
            "mosaic_active_project",
            "project-b",
            expect.objectContaining({
                httpOnly: true,
                sameSite: "lax",
                path: "/",
            }),
        );
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("activates a project from the workspace browser in one request", async () => {
        await activateProjectAction("workspace-1", "project-b");
        expect(mocks.setCookie).toHaveBeenCalledWith(
            "mosaic_active_workspace",
            "workspace-1",
            expect.any(Object),
        );
        expect(mocks.setCookie).toHaveBeenCalledWith(
            "mosaic_active_project",
            "project-b",
            expect.any(Object),
        );
    });

    it("rejects a project outside the authenticated workspace", async () => {
        await expect(switchProjectAction("project-x")).resolves.toEqual({
            formError: "Project not found.",
        });
        expect(mocks.setCookie).not.toHaveBeenCalled();
    });

    it("creates and selects a project", async () => {
        const formData = new FormData();
        formData.set("name", "  Research  ");
        formData.set("workspaceId", "workspace-1");
        await expect(createProjectAction({}, formData)).resolves.toEqual({
            created: true,
        });
        expect(mocks.createProject).toHaveBeenCalledWith({
            teamId: "team-1",
            workspaceId: "workspace-1",
            name: "Research",
            createdBy: "user-1",
        });
        expect(mocks.setCookie).toHaveBeenCalledWith(
            "mosaic_active_project",
            "project-new",
            expect.any(Object),
        );
    });

    it("rejects a blank project name", async () => {
        const formData = new FormData();
        formData.set("name", "   ");
        await expect(createProjectAction({}, formData)).resolves.toEqual({
            error: "Project name is required.",
        });
        expect(mocks.createProject).not.toHaveBeenCalled();
    });

    it("renames the active project and refreshes navigation", async () => {
        const formData = new FormData();
        formData.set("projectId", "project-a");
        formData.set("workspaceId", "workspace-1");
        formData.set("name", "  Renamed  ");
        mocks.updateProject.mockResolvedValue({
            id: "project-a",
            teamId: "team-1",
            workspaceId: "workspace-1",
            name: "Renamed",
            createdAt: "now",
        });
        await expect(updateProjectAction({}, formData)).resolves.toEqual({
            updated: true,
        });
        expect(mocks.updateProject).toHaveBeenCalledWith({
            teamId: "team-1",
            workspaceId: "workspace-1",
            projectId: "project-a",
            name: "Renamed",
            updatedBy: "user-1",
        });
        expect(mocks.revalidatePath).toHaveBeenCalledWith("/", "layout");
    });

    it("does not send a blank rename", async () => {
        const formData = new FormData();
        formData.set("projectId", "project-a");
        formData.set("name", "   ");
        await expect(updateProjectAction({}, formData)).resolves.toEqual({
            error: "Project name is required.",
        });
        expect(mocks.updateProject).not.toHaveBeenCalled();
    });
});
