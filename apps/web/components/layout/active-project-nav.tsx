import { unstable_rethrow } from "next/navigation";
import { ProjectSwitcher } from "@/components/project-switcher";
import { ForbiddenError, UnauthorizedError } from "@/server/auth/session";
import { UserFacingError } from "@/server/lib/errors";
import { requireActiveProject } from "@/server/projects/activeProject";

/**
 * The active workspace and project in the header. It is context, not
 * content: when the user is signed out, has no workspace or project yet, or
 * the lookup fails, the header simply renders without it instead of taking the
 * whole app down (this runs in the root layout).
 */
export async function ActiveProjectNav() {
    let active: Awaited<ReturnType<typeof requireActiveProject>>;
    try {
        active = await requireActiveProject();
    } catch (error) {
        // Let Next's own control-flow errors (dynamic rendering, redirects) through.
        unstable_rethrow(error);
        if (
            error instanceof UnauthorizedError ||
            error instanceof ForbiddenError ||
            error instanceof UserFacingError
        ) {
            return null;
        }
        console.error(
            "Could not load the active project for the header",
            error,
        );
        return null;
    }
    return (
        <ProjectSwitcher
            projects={active.projects}
            projectId={active.projectId}
            workspaces={active.workspaces}
            workspaceId={active.workspaceId}
        />
    );
}
