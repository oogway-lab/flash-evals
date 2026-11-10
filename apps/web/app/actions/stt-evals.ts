"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type {
    IPipelineFinalAnswer,
    IWorkflowEdgeInput,
    IWorkflowNodeInput,
    WorkflowRunTarget,
} from "@flash-evals/api-contract";
import {
    createMultiWorkflowSeed,
    FlashEvalsApiError,
} from "@flash-evals/api-contract";
import { serverApiClient } from "@/server/api/client";
import { clientErrorMessage, UserFacingError } from "@/server/lib/errors";
import { requireActiveProject } from "@/server/projects/activeProject";
import {
    actionErrorState,
    INVALID_SPEND_LIMIT_MESSAGE,
    parseRunDataPolicy,
    parseRunMaxCostUsd,
} from "./shared";
import type { IActionState } from "./types";

function parseJsonArray<T>(data: FormData, name: string): T[] {
    const parsed: unknown = JSON.parse(String(data.get(name) ?? "[]"));
    if (!Array.isArray(parsed))
        throw new UserFacingError(`${name} must be an array.`);
    return parsed as T[];
}

/** The canvas's final answer: an object, or null to remove it. */
function parseFinalAnswer(data: FormData): IPipelineFinalAnswer | null {
    const parsed: unknown = JSON.parse(
        String(data.get("finalAnswer") ?? "null"),
    );
    if (parsed === null) return null;
    if (typeof parsed !== "object" || Array.isArray(parsed))
        throw new UserFacingError("The final answer must be an object.");
    return parsed as IPipelineFinalAnswer;
}

/** The saved kind is kept; anything unknown is treated as speech to text. */
function parseWorkflowKind(value: unknown): "multi" | "prompt" | "stt" {
    return value === "multi" || value === "prompt" ? value : "stt";
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
            kind: parseWorkflowKind(formData.get("kind")),
            nodes: parseJsonArray<IWorkflowNodeInput>(formData, "nodes"),
            edges: parseJsonArray<IWorkflowEdgeInput>(formData, "edges"),
            ...(formData.has("finalAnswer")
                ? { finalAnswer: parseFinalAnswer(formData) }
                : {}),
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
    const maxCostUsd = parseRunMaxCostUsd(formData);
    if (maxCostUsd === "invalid")
        return {
            formError: INVALID_SPEND_LIMIT_MESSAGE,
            fieldErrors: { maxCostUsd: [INVALID_SPEND_LIMIT_MESSAGE] },
        };
    let workflowRunId: string;
    try {
        const runTarget = String(
            formData.get("runTarget") ?? "dataset",
        ) as WorkflowRunTarget;
        const dataPolicy = parseRunDataPolicy(formData);
        const compareWithRunId = String(
            formData.get("compareWithRunId") ?? "",
        ).trim();
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
            ...(maxCostUsd !== undefined ? { maxCostUsd } : {}),
            ...(dataPolicy ? { dataPolicy } : {}),
            ...(compareWithRunId ? { compareWithRunId } : {}),
        });
        workflowRunId = result.workflowRunId;
    } catch (error) {
        return workflowActionError(error);
    }
    redirect(`/multiworkflow/${workflowId}/runs/${workflowRunId}`);
}

export async function retryWorkflowRunAction(
    _state: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const principal = await requireActiveProject();
    const workflowId = String(formData.get("workflowId") ?? "");
    const workflowRunId = String(formData.get("runId") ?? "");
    try {
        const result = await serverApiClient().retryWorkflowRun({
            teamId: principal.teamId,
            projectId: principal.projectId,
            workflowId,
            workflowRunId,
        });
        if (result?.requeued === false)
            return {
                formError:
                    "Nothing to retry: the run is still waiting in the queue. If it stays pending, check that the worker is running.",
            };
    } catch (error) {
        return workflowActionError(error);
    }
    revalidatePath(`/multiworkflow/${workflowId}/runs/${workflowRunId}`);
    return { ok: true };
}

/**
 * Asks the worker to stop a pending or running pipeline run. Calls already
 * sent finish; steps not started are not run.
 */
export async function cancelWorkflowRunAction(
    _state: IActionState,
    formData: FormData,
): Promise<IActionState> {
    const principal = await requireActiveProject();
    const workflowId = String(formData.get("workflowId") ?? "");
    const workflowRunId = String(formData.get("runId") ?? "");
    try {
        await serverApiClient().cancelWorkflowRun({
            teamId: principal.teamId,
            projectId: principal.projectId,
            workflowId,
            workflowRunId,
        });
    } catch (error) {
        return workflowActionError(error);
    }
    revalidatePath(`/multiworkflow/${workflowId}/runs/${workflowRunId}`);
    return { ok: true };
}

function workflowActionError(error: unknown): IActionState {
    if (error instanceof FlashEvalsApiError && error.path) {
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
