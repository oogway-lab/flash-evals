import { WorkspaceBrowser } from "@/components/workspaces/workspace-browser";
import { serverApiClient } from "@/server/api/client";
import { requirePrincipal } from "@/server/auth/session";
import {
    activeWorkspaceCookieValue,
    selectedProject,
} from "@/server/projects/activeProject";

export const dynamic = "force-dynamic";

export const metadata = { title: "Workspaces" };

export default async function WorkspacesPage() {
    const principal = await requirePrincipal();
    const workspaces = await serverApiClient().listWorkspaces(principal.teamId);
    // Counts stream in per card, so the grid renders without waiting on the
    // per-workspace project fan-out.
    const projectCounts = Promise.allSettled(
        workspaces.map((workspace) =>
            serverApiClient().listProjects(principal.teamId, workspace.id),
        ),
    ).then((results) =>
        Object.fromEntries(
            results.map((result, index) => [
                workspaces[index].id,
                result.status === "fulfilled" ? result.value.length : undefined,
            ]),
        ),
    );
    return (
        <WorkspaceBrowser
            workspaces={workspaces}
            projectCounts={projectCounts}
            selectedWorkspaceId={
                // Same fallback as `requireActiveProject`, so "Current" matches the header.
                selectedProject(
                    workspaces,
                    (await activeWorkspaceCookieValue()) ??
                        principal.defaultWorkspaceId,
                )?.id
            }
        />
    );
}
