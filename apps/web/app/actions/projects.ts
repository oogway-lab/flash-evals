"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { serverApiClient } from "@/server/api/client";
import { requirePrincipal } from "@/server/auth/session";
import { UserFacingError } from "@/server/lib/errors";
import { actionErrorState } from "./shared";
import type { IActionState } from "./types";
import {
    ACTIVE_PROJECT_COOKIE,
    ACTIVE_WORKSPACE_COOKIE,
} from "@/server/projects/activeProject";

export interface ICreateProjectState {
    created?: boolean;
    error?: string;
}

export interface IUpdateProjectState {
    updated?: boolean;
    error?: string;
}

export interface ICreateWorkspaceState {
    created?: boolean;
    error?: string;
}

export interface IUpdateWorkspaceState {
    updated?: boolean;
    error?: string;
}

export async function createWorkspaceAction(
    _state: ICreateWorkspaceState,
    formData: FormData,
): Promise<ICreateWorkspaceState> {
    const principal = await requirePrincipal();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Workspace name is required." };
    try {
        const workspace = await serverApiClient().createWorkspace({
            teamId: principal.teamId,
            name,
            createdBy: principal.userId,
        });
        const project = await serverApiClient().createProject({
            teamId: principal.teamId,
            workspaceId: workspace.id,
            name: "Default",
            createdBy: principal.userId,
        });
        await selectWorkspace(workspace.id);
        await persistProject(project.id);
        return { created: true };
    } catch (error) {
        return {
            error:
                error instanceof Error
                    ? error.message
                    : "Could not create workspace.",
        };
    }
}

export async function createProjectAction(
    _state: ICreateProjectState,
    formData: FormData,
): Promise<ICreateProjectState> {
    const principal = await requirePrincipal();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Project name is required." };

    try {
        const workspaceId = String(formData.get("workspaceId") ?? "");
        const project = await serverApiClient().createProject({
            teamId: principal.teamId,
            workspaceId,
            name,
            createdBy: principal.userId,
        });
        await persistWorkspace(workspaceId);
        await persistProject(project.id);
        return { created: true };
    } catch (error) {
        return {
            error:
                error instanceof Error
                    ? error.message
                    : "Could not create project.",
        };
    }
}

export async function switchProjectAction(
    projectId: string,
): Promise<IActionState> {
    const principal = await requirePrincipal();
    try {
        const workspaceId = String(
            (await cookies()).get(ACTIVE_WORKSPACE_COOKIE)?.value ??
                principal.defaultWorkspaceId ??
                "",
        );
        if (!workspaceId) throw new UserFacingError("Workspace not found.");
        const projects = await serverApiClient().listProjects(
            principal.teamId,
            workspaceId,
        );
        if (!projects.some((project) => project.id === projectId)) {
            throw new UserFacingError("Project not found.");
        }
        await persistProject(projectId);
    } catch (err) {
        return actionErrorState(err);
    }
    return { ok: true };
}

export async function switchWorkspaceAction(
    workspaceId: string,
): Promise<IActionState> {
    const principal = await requirePrincipal();
    try {
        const workspaces = await serverApiClient().listWorkspaces(
            principal.teamId,
        );
        if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
            throw new UserFacingError("Workspace not found.");
        }
        await selectWorkspace(workspaceId);
    } catch (err) {
        return actionErrorState(err);
    }
    return { ok: true };
}

/** Make `workspaceId` active and clear the project, which belonged to the old one. */
async function selectWorkspace(workspaceId: string) {
    const cookieStore = await cookies();
    await persistWorkspace(workspaceId);
    cookieStore.delete(ACTIVE_PROJECT_COOKIE);
    revalidatePath("/", "layout");
}

/** Select a workspace and project together from the workspace browser. */
export async function activateProjectAction(
    workspaceId: string,
    projectId: string,
): Promise<IActionState> {
    const principal = await requirePrincipal();
    try {
        const workspaces = await serverApiClient().listWorkspaces(
            principal.teamId,
        );
        if (!workspaces.some((workspace) => workspace.id === workspaceId)) {
            throw new UserFacingError("Workspace not found.");
        }
        const projects = await serverApiClient().listProjects(
            principal.teamId,
            workspaceId,
        );
        if (!projects.some((project) => project.id === projectId)) {
            throw new UserFacingError("Project not found.");
        }

        await persistWorkspace(workspaceId);
        await persistProject(projectId);
    } catch (err) {
        return actionErrorState(err);
    }
    return { ok: true };
}

export async function updateProjectAction(
    _state: IUpdateProjectState,
    formData: FormData,
): Promise<IUpdateProjectState> {
    const principal = await requirePrincipal();
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return { error: "Project name is required." };
    try {
        await serverApiClient().updateProject({
            teamId: principal.teamId,
            workspaceId: String(formData.get("workspaceId") ?? ""),
            projectId: String(formData.get("projectId") ?? ""),
            name,
            updatedBy: principal.userId,
        });
        revalidatePath("/settings");
        revalidatePath("/", "layout");
        return { updated: true };
    } catch (error) {
        return {
            error:
                error instanceof Error
                    ? error.message
                    : "Could not update project.",
        };
    }
}

export async function updateWorkspaceAction(
    _state: IUpdateWorkspaceState,
    formData: FormData,
): Promise<IUpdateWorkspaceState> {
    const principal = await requirePrincipal();
    const workspaceId = String(formData.get("workspaceId") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    if (!workspaceId) return { error: "Workspace not found." };
    if (!name) return { error: "Workspace name is required." };
    try {
        await serverApiClient().updateWorkspace({
            teamId: principal.teamId,
            workspaceId,
            name,
            updatedBy: principal.userId,
        });
        revalidatePath("/", "layout");
        return { updated: true };
    } catch (error) {
        return {
            error:
                error instanceof Error
                    ? error.message
                    : "Could not rename workspace.",
        };
    }
}

async function persistProject(projectId: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_PROJECT_COOKIE, projectId, cookieOptions());
    revalidatePath("/", "layout");
}

async function persistWorkspace(workspaceId: string): Promise<void> {
    const cookieStore = await cookies();
    cookieStore.set(ACTIVE_WORKSPACE_COOKIE, workspaceId, cookieOptions());
}

function cookieOptions() {
    return {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
    } as const;
}
