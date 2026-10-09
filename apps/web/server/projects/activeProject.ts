import { cache } from "react";
import { cookies } from "next/headers";
import { serverApiClient } from "@/server/api/client";
import { requirePrincipal } from "@/server/auth/session";
import { UserFacingError } from "@/server/lib/errors";

export const ACTIVE_PROJECT_COOKIE = "mosaic_active_project";
export const ACTIVE_WORKSPACE_COOKIE = "mosaic_active_workspace";

export async function activeProjectCookieValue(): Promise<string | undefined> {
    return (await cookies()).get(ACTIVE_PROJECT_COOKIE)?.value;
}

export async function activeWorkspaceCookieValue(): Promise<
    string | undefined
> {
    return (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value;
}

export function selectedProject<T extends { id: string }>(
    projects: T[],
    requestedId: string | undefined,
): T | undefined {
    return (
        projects.find((project) => project.id === requestedId) ?? projects[0]
    );
}

export const requireActiveProject = cache(
    async function requireActiveProject() {
        const principal = await requirePrincipal();
        const workspaces = await serverApiClient().listWorkspaces(
            principal.teamId,
        );
        const activeWorkspace = selectedProject(
            workspaces,
            (await activeWorkspaceCookieValue()) ??
                principal.defaultWorkspaceId,
        );
        if (!activeWorkspace) {
            throw new UserFacingError(
                "No workspace is available for this tenant.",
            );
        }
        const projects = await serverApiClient().listProjects(
            principal.teamId,
            activeWorkspace.id,
        );
        const activeProject = selectedProject(
            projects,
            await activeProjectCookieValue(),
        );

        if (!activeProject) {
            throw new UserFacingError(
                "No project is available for this workspace.",
            );
        }

        return {
            ...principal,
            workspaceId: activeWorkspace.id,
            workspaces,
            projectId: activeProject.id,
            projects,
        };
    },
);
