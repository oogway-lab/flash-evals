import { notFound } from "next/navigation";
import { WorkspaceDetail } from "@/components/workspaces/workspace-browser";
import { serverApiClient } from "@/server/api/client";
import { requirePrincipal } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({
    params,
}: {
    params: Promise<{ workspaceId: string }>;
}) {
    const principal = await requirePrincipal();
    const { workspaceId } = await params;
    const workspaces = await serverApiClient().listWorkspaces(principal.teamId);
    const workspace = workspaces.find(
        (candidate) => candidate.id === workspaceId,
    );
    if (!workspace) notFound();
    const projects = await serverApiClient().listProjects(
        principal.teamId,
        workspace.id,
    );
    return <WorkspaceDetail workspace={workspace} projects={projects} />;
}
