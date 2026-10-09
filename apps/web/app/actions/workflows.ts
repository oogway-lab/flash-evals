"use server";

import { revalidatePath } from "next/cache";
import { serverApiClient } from "@/server/api/client";
import { requireActiveProject } from "@/server/projects/activeProject";
import { actionErrorState } from "./shared";
import type { IActionState } from "./types";

export async function deleteWorkflowAction(
    formData: FormData,
): Promise<IActionState> {
    const principal = await requireActiveProject();
    const workflowId = String(formData.get("workflowId") || "");
    try {
        await serverApiClient().deleteWorkflow({
            teamId: principal.teamId,
            projectId: principal.projectId,
            workflowId,
        });
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/multiworkflow");
    return { ok: true };
}
