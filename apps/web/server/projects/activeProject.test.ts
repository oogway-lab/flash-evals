import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    cookieValue: undefined as string | undefined,
    workspaceCookieValue: undefined as string | undefined,
    listWorkspaces: vi.fn(),
    listProjects: vi.fn(),
}));

vi.mock("next/headers", () => ({
    cookies: vi.fn(async () => ({
        get: (name: string) => {
            const value =
                name === "mosaic_active_workspace"
                    ? mocks.workspaceCookieValue
                    : mocks.cookieValue;
            return value ? { value } : undefined;
        },
    })),
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
        listWorkspaces: mocks.listWorkspaces,
        listProjects: mocks.listProjects,
    }),
}));

import { requireActiveProject, selectedProject } from "./activeProject";

const projects = [
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
];

describe("requireActiveProject", () => {
    beforeEach(() => {
        mocks.cookieValue = undefined;
        mocks.workspaceCookieValue = undefined;
        mocks.listWorkspaces.mockReset().mockResolvedValue([
            {
                id: "workspace-1",
                teamId: "team-1",
                name: "User workspace",
                createdAt: "now",
            },
        ]);
        mocks.listProjects.mockReset().mockResolvedValue(projects);
    });

    it("uses the persisted project when it belongs to the workspace", async () => {
        mocks.cookieValue = "project-b";
        await expect(requireActiveProject()).resolves.toMatchObject({
            teamId: "team-1",
            projectId: "project-b",
        });
    });

    it("falls back to the first workspace project for a stale cookie", async () => {
        mocks.cookieValue = "project-from-another-workspace";
        await expect(requireActiveProject()).resolves.toMatchObject({
            projectId: "project-a",
        });
    });

    it("allows team settings to handle an empty workspace", () => {
        expect(selectedProject([], undefined)).toBeUndefined();
    });
});
