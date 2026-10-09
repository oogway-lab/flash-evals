"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
    IWorkflowEdgeInput,
    IWorkflowNodeInput,
    WorkflowRunTarget,
} from "@mosaic/api-contract";
import { createMultiWorkflowSeed, MosaicApiError } from "@mosaic/api-contract";
import { serverApiClient } from "@/server/api/client";
import { clientErrorMessage, UserFacingError } from "@/server/lib/errors";
import { requireActiveProject } from "@/server/projects/activeProject";
import { actionErrorState } from "./shared";
import type { IActionState } from "./types";

function parseJsonArray<T>(data: FormData, name: string): T[] {
    const parsed: unknown = JSON.parse(String(data.get(name) ?? "[]"));
    if (!Array.isArray(parsed))
        throw new UserFacingError(`${name} must be an array.`);
    return parsed as T[];
}

function parseInputModality(value: unknown): "audio" | "image" | "text" {
    return value === "image" || value === "text" ? value : "audio";
}

export async function createSttEvalAction(
    _state: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const principal = await requireActiveProject();
    const name = String(formData.get("name") ?? "").trim();
    const modelId = String(formData.get("modelId") ?? "").trim();
    const modality = parseInputModality(formData.get("modality"));
    const datasetId = String(formData.get("datasetId") ?? "").trim();
    if (!name) return { fieldErrors: { name: ["Name is required."] } };
    if (modality === "audio" && !modelId) {
        return { formError: "An STT model is required for audio inputs." };
    }
    let workflowId: string;
    try {
        const seed = createMultiWorkflowSeed({
            modality,
            ...(datasetId ? { datasetId } : {}),
            ...(modelId ? { sttModelId: modelId } : {}),
        });
        const workflow = await serverApiClient().createWorkflow({
            teamId: principal.teamId,
            projectId: principal.projectId,
            name,
            kind: "multi",
            nodes: seed.nodes,
            edges: seed.edges,
            createdBy: principal.userId,
        });
        workflowId = workflow.id;
    } catch (err) {
        return actionErrorState(err);
    }
    revalidatePath("/multiworkflow");
    redirect(
        `/multiworkflow/${workflowId}${datasetId ? `?datasetId=${encodeURIComponent(datasetId)}` : ""}`,
    );
}

export async function saveSttEvalAction(
    _state: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const principal = await requireActiveProject();
    try {
        const workflowId = String(formData.get("workflowId") ?? "");
        await serverApiClient().updateWorkflow({
            teamId: principal.teamId,
            projectId: principal.projectId,
            workflowId,
            name: String(formData.get("name") ?? "").trim(),
            description: String(formData.get("description") ?? "").trim(),
            kind: formData.get("kind") === "multi" ? "multi" : "stt",
            nodes: parseJsonArray<IWorkflowNodeInput>(formData, "nodes"),
            edges: parseJsonArray<IWorkflowEdgeInput>(formData, "edges"),
        });
        revalidatePath(`/multiworkflow/${workflowId}`);
        return { ok: true };
    } catch (error) {
        return workflowActionError(error);
    }
}

export async function createSttEvalRunAction(
    _state: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const principal = await requireActiveProject();
    const workflowId = String(formData.get("workflowId") ?? "");
    let workflowRunId: string;
    try {
        const runTarget = String(
            formData.get("runTarget") ?? "dataset",
        ) as WorkflowRunTarget;
        const result = await serverApiClient().createWorkflowRun({
            teamId: principal.teamId,
            projectId: principal.projectId,
            workflowId,
            datasetId: String(formData.get("datasetId") ?? ""),
            runTarget,
            ...(runTarget === "single_item"
                ? { itemId: String(formData.get("itemId") ?? "") }
                : {}),
            idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
            createdBy: principal.userId,
        });
        workflowRunId = result.workflowRunId;
    } catch (error) {
        return workflowActionError(error);
    }
    redirect(`/multiworkflow/${workflowId}/runs/${workflowRunId}`);
}

function workflowActionError(error: unknown): IActionState {
    if (error instanceof MosaicApiError && error.path) {
        const message = [error.message, error.remediation]
            .filter(Boolean)
            .join(" ");
        return {
            formError: message,
            fieldErrors: { [error.path]: [message] },
        };
    }
    return { formError: clientErrorMessage(error) };
}
